/**
 * Persistent multi-turn ACP client session.
 *
 * No one-shot runs, no usage accounting, no interactive permission UI.
 * Permission requests go through the harness policy
 * (deny unless WebMCP tool), and session options come from
 * `buildSessionMeta`.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

import {
	type PermissionDecision,
	type SessionConfig,
	buildSessionMeta,
	decidePermission,
} from "../policy.js";
import { VERSION } from "../version.js";

type AcpSdk = typeof import("@agentclientprotocol/sdk");
import type {
	AuthMethod,
	ContentBlock,
	InitializeResponse,
	McpCapabilities,
	McpServer,
	NewSessionResponse,
} from "@agentclientprotocol/sdk";

/** Keep raw params so adapter extension fields reach our handlers. */
const rawParams = {
	// biome-ignore lint/suspicious/noExplicitAny: ACP payloads are untyped here
	parse: (value: unknown) => value as any,
};

export interface ToolCallEvent {
	toolCallId: string;
	title?: string;
	kind?: string;
	status?: string;
	toolName?: string;
}

/** A file sent with a prompt. Images are base64; other files are text. */
export type PromptAttachment =
	| { type: "image"; mimeType: string; data: string; name?: string }
	| { type: "text"; text: string; name?: string; mimeType?: string };

export interface AcpLiveSessionOptions {
	command: string;
	args: string[];
	cwd: string;
	envVars?: Record<string, string>;
	/**
	 * MCP servers for `session/new`. A function receives the agent's
	 * `mcpCapabilities` (e.g. `{ http: true }`) to pick a transport.
	 */
	mcpServers?: McpServer[] | ((mcpCapabilities: McpCapabilities) => McpServer[]);
	sessionConfig?: SessionConfig;
	/**
	 * Advertise `auth.terminal` so the agent may offer terminal sign-in
	 * methods. Only when the client can run one in a real terminal.
	 */
	terminalAuth?: boolean;
	/** `_meta` for `session/new`; defaults to the Claude policy built from `sessionConfig`. */
	sessionMeta?: Record<string, unknown>;
	/** Model to switch to after `session/new`, when the agent offers it. */
	model?: string;
	onChunk?: (text: string) => void;
	/** Agent reasoning ("thought") text. */
	onThought?: (text: string) => void;
	onToolCall?: (event: ToolCallEvent) => void;
	onPermission?: (decision: PermissionDecision) => void;
	onStderr?: (text: string) => void;
	onSpawnError?: (error: Error) => void;
	onExit?: (code: number | null, signal: string | null) => void;
}

/** What the agent said about itself in `initialize`. */
export interface AgentInfo {
	authMethods: AuthMethod[];
	agentCapabilities: NonNullable<InitializeResponse["agentCapabilities"]>;
	agentInfo?: InitializeResponse["agentInfo"];
}

/** The models an agent offers in `session/new`, and how to pick one. */
export interface AgentModels {
	current?: string;
	options: Array<{ id: string; name: string; description?: string }>;
	/** ACP v1 config option id (category "model"); absent for the older `models` field. */
	configId?: string;
}

/**
 * Read the model choice from a `session/new` response or a
 * `config_option_update`: an ACP v1 config
 * option with category "model" first, then the older `models` field.
 */
// biome-ignore lint/suspicious/noExplicitAny: raw agent payloads vary
export function readModels(source: any): AgentModels | null {
	const configOptions: unknown[] = Array.isArray(source?.configOptions) ? source.configOptions : [];
	// biome-ignore lint/suspicious/noExplicitAny: raw agent payloads vary
	const option = configOptions.find((o: any) => o?.category === "model" && o?.type !== "boolean" && Array.isArray(o?.options)) as any;
	if (option) {
		// Options may be grouped.
		// biome-ignore lint/suspicious/noExplicitAny: raw agent payloads vary
		const flat = option.options.flatMap((o: any) => (Array.isArray(o?.options) ? o.options : [o]));
		return {
			configId: String(option.id),
			current: typeof option.currentValue === "string" ? option.currentValue : undefined,
			options: flat
				// biome-ignore lint/suspicious/noExplicitAny: raw agent payloads vary
				.filter((o: any) => typeof o?.value === "string")
				// biome-ignore lint/suspicious/noExplicitAny: raw agent payloads vary
				.map((o: any) => ({ id: o.value, name: String(o.name ?? o.value), ...(o.description ? { description: String(o.description) } : {}) })),
		};
	}
	const legacy = source?.models;
	if (Array.isArray(legacy?.availableModels) && legacy.availableModels.length) {
		return {
			current: typeof legacy.currentModelId === "string" ? legacy.currentModelId : undefined,
			options: legacy.availableModels
				// biome-ignore lint/suspicious/noExplicitAny: raw agent payloads vary
				.filter((m: any) => typeof m?.modelId === "string")
				// biome-ignore lint/suspicious/noExplicitAny: raw agent payloads vary
				.map((m: any) => ({ id: m.modelId, name: String(m.name ?? m.modelId), ...(m.description ? { description: String(m.description) } : {}) })),
		};
	}
	return null;
}

/** Env vars never passed to the agent process. */
const REMOVED_ENV_VARS = ["CLAUDECODE"];

/** ACP error code for `session/new` before sign-in. */
const AUTH_REQUIRED = -32000;

function errorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
	return String(error);
}

export class AcpLiveSession {
	private child: ChildProcess | null = null;
	// biome-ignore lint/suspicious/noExplicitAny: SDK connection type is internal
	private connection: any = null;
	private acpSessionId: string | null = null;
	private alive = false;
	private imagesSupported = false;
	/** `initialize` result, once connected. */
	info: AgentInfo | null = null;
	/** Models the agent offers, from `session/new` (and later updates). */
	models: AgentModels | null = null;

	constructor(private readonly options: AcpLiveSessionOptions) {}

	get isAlive(): boolean {
		return this.alive && this.child !== null && !this.child.killed;
	}

	/** Spawn the agent, initialize ACP and create a session. */
	async start(): Promise<{ error?: string }> {
		const connected = await this.connect();
		if (connected.error) return connected;
		return this.newSession();
	}

	/** Spawn the agent and run `initialize`. */
	async connect(): Promise<{ error?: string }> {
		const sdk = await import("@agentclientprotocol/sdk");

		const env: Record<string, string | undefined> = { ...process.env, ...this.options.envVars };
		for (const key of REMOVED_ENV_VARS) delete env[key];
		// A compiled Bun engine runs JavaScript agents as plain Bun.
		if (process.versions.bun) env.BUN_BE_BUN = "1";

		const child = spawn(this.options.command, this.options.args, {
			stdio: ["pipe", "pipe", "pipe"],
			env,
			cwd: this.options.cwd,
			shell: process.platform === "win32",
			// Its own process group, so close() also stops what the agent starts
			// (Gemini relaunches itself as a child process).
			detached: process.platform !== "win32",
		});
		this.child = child;

		child.on("error", (err) => this.options.onSpawnError?.(err));
		child.stdin?.on("error", (err: NodeJS.ErrnoException) => {
			if (err.code !== "EPIPE" && err.code !== "ERR_STREAM_DESTROYED") {
				this.options.onSpawnError?.(err);
			}
		});
		child.on("exit", (code, signal) => {
			this.alive = false;
			this.options.onExit?.(code, signal);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString().trim();
			if (text) this.options.onStderr?.(text);
		});

		try {
			const stream = sdk.ndJsonStream(
				Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
				Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
			);
			this.connection = this.buildClientApp(sdk).connect(stream);

			const init: InitializeResponse = await this.connection.agent.request("initialize", {
				protocolVersion: sdk.PROTOCOL_VERSION,
				clientInfo: { name: "leuria", version: VERSION },
				clientCapabilities: {
					fs: { readTextFile: false, writeTextFile: false },
					terminal: false,
					auth: { terminal: this.options.terminalAuth === true },
				},
			});

			this.imagesSupported = init?.agentCapabilities?.promptCapabilities?.image === true;
			this.info = {
				authMethods: init.authMethods ?? [],
				agentCapabilities: init.agentCapabilities ?? {},
				agentInfo: init.agentInfo,
			};
			return {};
		} catch (error) {
			this.close();
			return { error: error instanceof Error ? error.message : String(error) };
		}
	}

	/** ACP `authenticate` with one of the advertised methods (the agent runs its own flow). */
	async authenticate(methodId: string): Promise<{ error?: string }> {
		if (!this.connection) return { error: "Not connected" };
		try {
			await this.connection.agent.request("authenticate", { methodId });
			return {};
		} catch (error) {
			return { error: errorText(error) };
		}
	}

	/** ACP `session/new`. An `auth_required` error means the visitor must sign in. */
	async newSession(): Promise<{ error?: string; authRequired?: boolean }> {
		if (!this.connection) return { error: "Not connected" };
		try {
			const mcp = this.options.mcpServers;
			const mcpCapabilities: McpCapabilities = this.info?.agentCapabilities.mcpCapabilities ?? {};
			const session: NewSessionResponse = await this.connection.agent.request("session/new", {
				cwd: this.options.cwd,
				mcpServers: typeof mcp === "function" ? mcp(mcpCapabilities) : (mcp ?? []),
				_meta: this.options.sessionMeta ?? buildSessionMeta(this.options.sessionConfig),
			});
			this.acpSessionId = session.sessionId;
			this.alive = true;
			this.models = readModels(session) ?? this.models;
			const wanted = this.options.model;
			if (wanted && wanted !== this.models?.current && this.models?.options.some((m) => m.id === wanted)) {
				// A model that cannot be set is not fatal: the agent's default answers.
				const set = await this.setModel(wanted);
				if (set.error) this.options.onStderr?.(`could not switch to model ${wanted}: ${set.error}`);
			}
			return {};
		} catch (error) {
			const code = (error as { code?: unknown })?.code;
			const text = errorText(error);
			this.close();
			// Some agents also use -32000 for other refusals (Gemini: "This client is no longer
			// supported…"): only a message about signing in means "sign in", the rest is shown as is.
			const aboutSignIn = /auth|sign.?in|log.?in|api.?key|credential|unauthori[sz]ed/i.test(text);
			return { error: text, authRequired: aboutSignIn || (code === AUTH_REQUIRED && !text.trim()) };
		}
	}

	/** Switch the session's model: ACP v1 `session/set_config_option`, or the older `session/set_model`. */
	async setModel(modelId: string): Promise<{ error?: string }> {
		if (!this.connection || !this.acpSessionId) return { error: "No session" };
		try {
			if (this.models?.configId) {
				const res = await this.connection.agent.request("session/set_config_option", {
					sessionId: this.acpSessionId,
					configId: this.models.configId,
					value: modelId,
				});
				this.models = readModels(res) ?? { ...this.models, current: modelId };
			} else {
				await this.connection.agent.request("session/set_model", { sessionId: this.acpSessionId, modelId });
				if (this.models) this.models = { ...this.models, current: modelId };
			}
			return {};
		} catch (error) {
			return { error: errorText(error) };
		}
	}

	/** Send one prompt turn; resolves when the agent ends the turn. */
	async prompt(text: string, attachments: PromptAttachment[] = []): Promise<{ error?: string }> {
		if (!this.isAlive || !this.connection || !this.acpSessionId) {
			return { error: "Session is not alive" };
		}
		try {
			await this.connection.agent.request("session/prompt", {
				sessionId: this.acpSessionId,
				prompt: this.promptBlocks(text, attachments),
			});
			return {};
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
	}

	/** ACP content blocks: the text, then each attachment. */
	private promptBlocks(text: string, attachments: PromptAttachment[]): ContentBlock[] {
		const blocks: ContentBlock[] = [];
		if (text) blocks.push({ type: "text", text });
		for (const file of attachments) {
			if (file.type === "image" && this.imagesSupported) {
				blocks.push({ type: "image", mimeType: file.mimeType, data: file.data });
			} else if (file.type === "image") {
				blocks.push({ type: "text", text: `[Image ${file.name ?? ""} omitted: this agent does not accept images]` });
			} else {
				blocks.push({ type: "text", text: `<file name="${file.name ?? "attachment"}">\n${file.text}\n</file>` });
			}
		}
		return blocks;
	}

	/** Ask the agent to stop the current turn, keeping the session. */
	async cancelTurn(): Promise<void> {
		if (!this.connection || !this.acpSessionId) return;
		try {
			await this.connection.agent.notify("session/cancel", {
				sessionId: this.acpSessionId,
			});
		} catch {
			// agent gone
		}
	}

	close(): void {
		this.alive = false;
		try {
			this.connection?.close();
		} catch {
			// ignore
		}
		if (this.child && !this.child.killed) killTree(this.child);
		this.child = null;
		this.connection = null;
		this.acpSessionId = null;
	}

	private buildClientApp(sdk: AcpSdk) {
		const { onChunk, onThought, onToolCall, onPermission } = this.options;

		// biome-ignore lint/suspicious/noExplicitAny: untyped ACP update
		const handleSessionUpdate = (params: any): void => {
			const update = params?.update;
			if (!update) return;
			const type = update.sessionUpdate;

			if (type === "config_option_update") {
				this.models = readModels(update) ?? this.models;
				return;
			}

			if (type === "agent_message_chunk" && update.content?.type === "text") {
				const text = update.content.text ?? "";
				if (text) onChunk?.(text);
				return;
			}
			if (type === "agent_thought_chunk" && update.content?.type === "text") {
				const text = update.content.text ?? "";
				if (text) onThought?.(text);
				return;
			}
			if (type === "tool_call" || type === "tool_call_update") {
				onToolCall?.({
					toolCallId: String(update.toolCallId ?? ""),
					title: typeof update.title === "string" ? update.title : undefined,
					kind: typeof update.kind === "string" ? update.kind : undefined,
					status: typeof update.status === "string" ? update.status : undefined,
					toolName:
						typeof update._meta?.claudeCode?.toolName === "string"
							? update._meta.claudeCode.toolName
							: undefined,
				});
			}
		};

		return sdk
			.client({ name: "leuria" })
			.onNotification("session/update", rawParams, (ctx) =>
				handleSessionUpdate(ctx.params),
			)
			.onRequest("session/request_permission", rawParams, (ctx) => {
				const decision = decidePermission(ctx.params);
				onPermission?.(decision);
				return decision.response;
			})
			// Legacy reverse prompt from some adapters: never answered by a
			// human here, so the turn is cancelled.
			.onRequest("session/prompt", rawParams, () => ({
				stopReason: "cancelled",
			}));
	}
}

/** Stop the agent and every process it started. */
function killTree(child: ChildProcess): void {
	try {
		if (process.platform === "win32" && child.pid) {
			spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
		} else if (child.pid) {
			process.kill(-child.pid, "SIGTERM");
		} else {
			child.kill();
		}
	} catch {
		try {
			child.kill();
		} catch {
			// already gone
		}
	}
}
