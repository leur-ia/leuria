/**
 * Agent sessions opened by websites.
 *
 * Every session belongs to the origin that prepared it,
 * has a WebMCP channel, and runs the visitor's agent in an empty sandbox
 * directory under the harness policy. The page chooses the prompts; the
 * visitor's config chooses the agent.
 *
 *   prepare    -> `pending_approval`, WebMCP channel allocated, nothing spawned
 *   approve    -> spawn the ACP agent, send the first prompt if any
 *                 (without one the session goes `idle` and emits `ready`,
 *                 which lets a page warm the agent up ahead of time)
 *   promptTurn -> follow-up prompt on an idle session (same agent context)
 *   cancelTurn -> stop the current turn, keep the session
 *   close      -> kill the agent; terminal `completed`
 *
 * SSE events: `webmcp_ready`, `ready`, `turn_start`, `chunk`, `thought`, `tool_call`,
 * `permission`, `log`, `turn_completed`, `completed`, `failed`,
 * `cancelled`.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { McpServer } from "@agentclientprotocol/sdk";

import { AcpLiveSession, type AgentModels, type PromptAttachment } from "./acp/acp-client.js";
import { LlmSession } from "./llm/llm-session.js";
import type { LlmProvider } from "./llm/providers.js";
import type { Logger } from "./logger.js";
import { WEBMCP_SERVER_NAME } from "./policy.js";
import type { WebMcpServer } from "./webmcp-server.js";

export type SessionStatus =
	| "pending_approval"
	| "running"
	| "idle"
	| "completed"
	| "failed"
	| "cancelled";

export interface PrepareParams {
	/** First turn. Without it, `approve` only starts the agent. */
	prompt?: string;
	attachments?: PromptAttachment[];
	systemPrompt?: string;
	maxTurns?: number;
	/** Origin that owns the session; `local` for requests without `Origin`. */
	origin: string;
}

export interface SessionInfo {
	id: string;
	status: SessionStatus;
	origin: string;
	createdAt: string;
	error?: string;
	registrationToken: string;
	webmcpUrl: string;
}

export type SessionListener = (event: string, data: unknown) => void;

/** What an agent profile needs to set up one session. */
export interface SessionSetup {
	/** The session's empty sandbox directory (also the agent's cwd). */
	sandbox: string;
	/** MCP endpoint and bearer token for the page tools. */
	mcpUrl: string;
	mcpToken: string;
	systemPrompt?: string;
	maxTurns?: number;
}

/** What the session manager needs from a running agent, ACP or LLM. */
interface LiveAgent {
	readonly isAlive: boolean;
	/** `authRequired`: the agent is signed out (ACP `auth_required`). */
	start(): Promise<{ error?: string; authRequired?: boolean }>;
	/** Models the agent offered in `session/new` (ACP agents). */
	readonly models?: AgentModels | null;
	prompt(text: string, attachments: PromptAttachment[]): Promise<{ error?: string }>;
	cancelTurn(): Promise<void>;
	close(): void;
}

export interface AgentLaunch {
	/** Registry or LLM id, so the engine can remember whether this AI works. */
	id?: string;
	/**
	 * An LLM provider instead of an ACP agent: the engine runs the tool
	 * loop itself (`LlmSession`); `command` and `args` are unused.
	 */
	llm?: { provider: LlmProvider; model: string };
	command: string;
	args: string[];
	/** Environment from the agent's registry entry. */
	env?: Record<string, string>;
	/** The model the visitor chose for this agent; the agent's default otherwise. */
	model?: string;
	/**
	 * Agent-specific session setup (environment, MCP servers, `_meta`).
	 * Without it, the Claude policy applies: page tools as an ACP MCP
	 * server and `buildSessionMeta`.
	 */
	configure?: (setup: SessionSetup) => {
		env?: Record<string, string>;
		mcpServers?: McpServer[];
		meta?: Record<string, unknown>;
	};
}

interface Session {
	id: string;
	status: SessionStatus;
	params: PrepareParams;
	cwd: string;
	createdAt: Date;
	error?: string;
	/** Text of the current turn, replayed to late SSE subscribers. */
	turnChunks: string[];
	listeners: Set<SessionListener>;
	live?: LiveAgent;
	registrationToken: string;
	channelToken: string;
}

export interface SessionManagerOptions {
	webMcpServer: WebMcpServer;
	port: number;
	logger: Logger;
	/** Command for the agent serving `origin`: its own choice, or the default AI. */
	resolveAgent: (origin: string) => Promise<AgentLaunch>;
	/** ACP handshake timeout. */
	startTimeoutMs?: number;
	/**
	 * What a real session learned about an AI: it started (with the models it
	 * offers), or it is signed out. Startup trusts this instead of checking.
	 */
	onAgentState?: (id: string, state: { ok: boolean; models?: AgentModels | null }) => void;
	/**
	 * Command that relays MCP over stdio to the engine (`leuria mcp-stdio`),
	 * for agents without HTTP MCP support. ACP requires every agent to
	 * support stdio MCP servers; HTTP is optional.
	 */
	stdioMcpCommand?: { command: string; args: string[] };
}

/** Live (non-terminal) sessions one origin may hold at once. */
export const MAX_SESSIONS_PER_ORIGIN = 4;
export const MAX_TURNS_LIMIT = 50;
/** How long an ended session stays readable. */
const FORGET_AFTER_MS = 5 * 60_000;

const TERMINAL: ReadonlySet<SessionStatus> = new Set([
	"completed",
	"failed",
	"cancelled",
]);

export class SessionManager {
	private readonly sessions = new Map<string, Session>();

	constructor(private readonly options: SessionManagerOptions) {}

	// ── Lifecycle ───────────────────────────────────────────────────────

	prepare(params: PrepareParams): SessionInfo {
		const live = [...this.sessions.values()].filter(
			(s) => s.params.origin === params.origin && !TERMINAL.has(s.status),
		);
		if (live.length >= MAX_SESSIONS_PER_ORIGIN) {
			throw new Error(
				`Too many open sessions for this site (${MAX_SESSIONS_PER_ORIGIN}). Close one first.`,
			);
		}
		if (params.maxTurns !== undefined) {
			params.maxTurns = Math.min(Math.max(1, Math.floor(params.maxTurns)), MAX_TURNS_LIMIT);
		}

		const id = randomUUID();
		const channel = this.options.webMcpServer.createChannel(id);
		const session: Session = {
			id,
			status: "pending_approval",
			params,
			cwd: this.allocateSandbox(id),
			createdAt: new Date(),
			turnChunks: [],
			listeners: new Set(),
			registrationToken: channel.registrationToken,
			channelToken: channel.channelToken,
		};
		this.sessions.set(id, session);
		this.options.logger.info("session prepared", { sessionId: id, origin: params.origin });
		return this.toInfo(session);
	}

	approve(sessionId: string): SessionInfo {
		const session = this.require(sessionId);
		if (session.status !== "pending_approval") {
			throw new Error(`Session is ${session.status}, expected pending_approval`);
		}
		session.status = "running";
		// The browser needs the registration token before the agent starts
		// calling tools.
		this.notify(session, "webmcp_ready", this.webmcpReady(session));
		void this.execute(session);
		return this.toInfo(session);
	}

	promptTurn(sessionId: string, prompt: string, attachments: PromptAttachment[] = []): SessionInfo {
		const session = this.require(sessionId);
		if (!session.live?.isAlive) {
			throw new Error("Agent session has ended. Start a new session.");
		}
		if (session.status !== "idle") {
			throw new Error(`Session is ${session.status}, expected idle`);
		}
		void this.runTurn(session, prompt, attachments);
		return this.toInfo(session);
	}

	async cancelTurn(sessionId: string): Promise<SessionInfo> {
		const session = this.require(sessionId);
		if (session.status === "running") await session.live?.cancelTurn();
		return this.toInfo(session);
	}

	cancel(sessionId: string): SessionInfo {
		const session = this.require(sessionId);
		if (!TERMINAL.has(session.status)) {
			session.status = "cancelled";
			this.teardown(session);
			this.notify(session, "cancelled", null);
		}
		return this.toInfo(session);
	}

	close(sessionId: string): SessionInfo {
		const session = this.require(sessionId);
		if (!TERMINAL.has(session.status)) {
			session.status = "completed";
			this.teardown(session);
			this.notify(session, "completed", null);
		}
		return this.toInfo(session);
	}

	get(sessionId: string): SessionInfo | null {
		const session = this.sessions.get(sessionId);
		return session ? this.toInfo(session) : null;
	}

	/** Current-turn text, for SSE replay. */
	turnChunks(sessionId: string): string[] {
		return this.sessions.get(sessionId)?.turnChunks ?? [];
	}

	webmcpReady(session: Session | string): {
		registrationToken: string;
		webmcpUrl: string;
	} {
		const s = typeof session === "string" ? this.require(session) : session;
		return {
			registrationToken: s.registrationToken,
			webmcpUrl: `http://127.0.0.1:${this.options.port}`,
		};
	}

	addListener(sessionId: string, listener: SessionListener): void {
		this.sessions.get(sessionId)?.listeners.add(listener);
	}

	removeListener(sessionId: string, listener: SessionListener): void {
		this.sessions.get(sessionId)?.listeners.delete(listener);
	}

	/** End every session of an origin, e.g. when its grant is revoked. */
	/** End the sessions of the origins that match (their AI or model changed): the next message starts a new one. */
	closeWhere(match: (origin: string) => boolean): void {
		for (const session of this.sessions.values()) {
			if (match(session.params.origin)) this.cancel(session.id);
		}
	}

	closeOrigin(origin: string): void {
		for (const session of this.sessions.values()) {
			if (session.params.origin === origin) this.cancel(session.id);
		}
	}

	shutdown(): void {
		for (const session of this.sessions.values()) {
			this.teardown(session);
			session.listeners.clear();
		}
		this.sessions.clear();
	}

	// ── Internals ───────────────────────────────────────────────────────

	private async execute(session: Session): Promise<void> {
		const { logger } = this.options;
		let launch: AgentLaunch;
		try {
			launch = await this.options.resolveAgent(session.params.origin);
		} catch (err) {
			this.fail(session, err instanceof Error ? err.message : String(err));
			return;
		}
		if (TERMINAL.has(session.status)) return;

		const live = launch.llm ? this.llmSession(session, launch.llm) : this.acpSession(session, launch);
		session.live = live;

		const timeoutMs = this.options.startTimeoutMs ?? 60_000;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const started = await Promise.race([
			live.start(),
			new Promise<{ error: string }>((resolve) => {
				timer = setTimeout(
					() => resolve({ error: `The AI did not start within ${Math.round(timeoutMs / 1000)} s` }),
					timeoutMs,
				);
			}),
		]);
		clearTimeout(timer);
		if (started.error) {
			if (launch.id && "authRequired" in started && started.authRequired) this.options.onAgentState?.(launch.id, { ok: false });
			this.fail(session, started.error);
			return;
		}
		if (launch.id) this.options.onAgentState?.(launch.id, { ok: true, models: live.models });
		logger.info("agent started", { sessionId: session.id, llm: Boolean(launch.llm) });
		if (session.params.prompt) {
			await this.runTurn(session, session.params.prompt, session.params.attachments ?? []);
		} else if (session.status === "running") {
			session.status = "idle";
			this.notify(session, "ready", null);
		}
	}

	/** An LLM provider, driven by the engine with the page's tools. */
	private llmSession(session: Session, llm: NonNullable<AgentLaunch["llm"]>): LiveAgent {
		const { webMcpServer } = this.options;
		return new LlmSession({
			provider: llm.provider,
			model: llm.model,
			systemPrompt: session.params.systemPrompt,
			maxSteps: session.params.maxTurns,
			tools: {
				list: () => webMcpServer.listTools(session.id),
				call: (name, args) => webMcpServer.callTool(session.id, name, args),
			},
			onChunk: (text) => {
				session.turnChunks.push(text);
				this.notify(session, "chunk", text);
			},
			onThought: (text) => this.notify(session, "thought", text),
			onToolCall: (event) => this.notify(session, "tool_call", event),
		});
	}

	/** An ACP agent process under its policy. */
	private acpSession(session: Session, launch: AgentLaunch): LiveAgent {
		const { logger, port } = this.options;
		const mcpUrl = `http://127.0.0.1:${port}/webmcp/mcp`;
		const custom = launch.configure?.({
			sandbox: session.cwd,
			mcpUrl,
			mcpToken: session.channelToken,
			systemPrompt: session.params.systemPrompt,
			maxTurns: session.params.maxTurns,
		});
		const live = new AcpLiveSession({
			command: launch.command,
			args: launch.args,
			cwd: session.cwd,
			envVars: { ...launch.env, ...custom?.env },
			model: launch.model,
			mcpServers:
				custom?.mcpServers ??
				((caps) => {
					const stdio = this.options.stdioMcpCommand;
					if (caps.http === false && stdio) {
						return [
							{
								name: WEBMCP_SERVER_NAME,
								command: stdio.command,
								args: [...stdio.args, mcpUrl],
								env: [{ name: "LEURIA_MCP_TOKEN", value: session.channelToken }],
							},
						];
					}
					return [
						{
							type: "http",
							name: WEBMCP_SERVER_NAME,
							url: mcpUrl,
							headers: [{ name: "Authorization", value: `Bearer ${session.channelToken}` }],
						},
					];
				}),
			sessionConfig: {
				systemPrompt: session.params.systemPrompt,
				maxTurns: session.params.maxTurns,
			},
			sessionMeta: custom?.meta,
			onChunk: (text) => {
				session.turnChunks.push(text);
				this.notify(session, "chunk", text);
			},
			onThought: (text) => this.notify(session, "thought", text),
			onToolCall: (event) => this.notify(session, "tool_call", event),
			onPermission: (decision) => {
				const level = decision.allow ? "info" : "warn";
				logger[level]("permission", {
					sessionId: session.id,
					tool: decision.toolName,
					allow: decision.allow,
				});
				this.notify(session, "permission", {
					toolName: decision.toolName,
					allow: decision.allow,
				});
			},
			onStderr: (text) => this.notify(session, "log", text),
			onSpawnError: (err) =>
				this.fail(session, `Failed to start the agent: ${err.message}`),
			onExit: (code, signal) => {
				if (TERMINAL.has(session.status)) return;
				if (code !== 0 && code !== null) {
					this.fail(session, `Agent exited with code ${code}${signal ? ` (${signal})` : ""}`);
				} else {
					session.status = "completed";
					this.teardown(session);
					this.notify(session, "completed", null);
				}
			},
		});
		return live;
	}

	private async runTurn(session: Session, prompt: string, attachments: PromptAttachment[]): Promise<void> {
		session.status = "running";
		session.turnChunks = [];
		this.notify(session, "turn_start", null);
		const startedAt = Date.now();
		const result = await session.live!.prompt(prompt, attachments);
		if (session.status !== "running") return;
		if (result.error) {
			this.fail(session, result.error);
			return;
		}
		session.status = "idle";
		this.options.logger.info("turn completed", {
			sessionId: session.id,
			durationMs: Date.now() - startedAt,
		});
		this.notify(session, "turn_completed", {
			text: session.turnChunks.join(""),
			durationMs: Date.now() - startedAt,
		});
	}

	private fail(session: Session, detail: string): void {
		if (TERMINAL.has(session.status)) return;
		session.status = "failed";
		session.error = detail;
		this.options.logger.error("session failed", { sessionId: session.id, detail });
		this.teardown(session);
		this.notify(session, "failed", detail);
	}

	/**
	 * Fresh empty directory per session, so the agent finds no project
	 * files (CLAUDE.md, repo) to act on.
	 */
	private allocateSandbox(sessionId: string): string {
		const dir = join(tmpdir(), `leuria-${sessionId}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	private teardown(session: Session): void {
		try {
			session.live?.close();
		} catch {
			// already closed
		}
		session.live = undefined;
		this.options.webMcpServer.removeChannel(session.id);
		// Keep the final status readable for a while, then forget it.
		setTimeout(() => this.sessions.delete(session.id), FORGET_AFTER_MS).unref();
		try {
			rmSync(session.cwd, { recursive: true, force: true });
		} catch (err) {
			this.options.logger.warn("failed to remove sandbox", {
				cwd: session.cwd,
				err: err instanceof Error ? err.message : String(err),
			});
		}
	}

	private notify(session: Session, event: string, data: unknown): void {
		for (const listener of session.listeners) {
			try {
				listener(event, data);
			} catch {
				// listener gone; SSE handler removes it on close
			}
		}
	}

	private require(sessionId: string): Session {
		const session = this.sessions.get(sessionId);
		if (!session) throw new Error(`Session not found: ${sessionId}`);
		return session;
	}

	private toInfo(session: Session): SessionInfo {
		return {
			id: session.id,
			status: session.status,
			origin: session.params.origin,
			createdAt: session.createdAt.toISOString(),
			error: session.error,
			...this.webmcpReady(session),
		};
	}
}
