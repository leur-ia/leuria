/**
 * In-process WebMCP relay for the bridge daemon.
 *
 * Two surfaces, one server:
 *
 *   - **Browser → bridge (WebSocket)**: the browser console connects to
 *     `ws://127.0.0.1:<port>/webmcp/register`, exchanges its registration
 *     token for a channel WS at `/webmcp/channel/:id?token=…`, then
 *     declares the tools / resources / prompts it wants to expose.
 *
 *   - **Agent → bridge (HTTP MCP)**: the spawned ACP agent calls JSON-RPC
 *     2.0 against `POST /webmcp/mcp` with `Authorization: Bearer
 *     <channelToken>`. `tools/list` and friends read the channel's
 *     registry; `tools/call` etc. forward the request to the browser via
 *     the channel WS and await the response.
 *
 * Long-blocking calls (`tools/call`, `resources/read`, `prompts/get`)
 * switch to chunked HTTP encoding and emit periodic newline keep-alives
 * so the agent's HTTP client doesn't abort while the user is interacting
 * in the browser.
 *
 * Origin checks happen in `server.ts` before requests reach this class.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

import { parseBody } from "./http-utils.js";
import type { Logger } from "./logger.js";
import { READ_SKILL, readSkill, readSkillTool, type SkillContent } from "./skills.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ToolDescriptor {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
	annotations?: Record<string, unknown>;
}

interface ResourceDescriptor {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
}

interface PromptDescriptor {
	name: string;
	description?: string;
	arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

// ---------------------------------------------------------------------------
// Internal shapes
// ---------------------------------------------------------------------------

interface PendingRequest {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
}

interface WebMcpChannel {
	id: string;
	sessionId: string;
	token: string;
	browserWs: WebSocket | null;
	tools: Map<string, ToolDescriptor>;
	resources: Map<string, ResourceDescriptor>;
	prompts: Map<string, PromptDescriptor>;
	/** The site's skills, served by the engine itself as `read_skill`. */
	skills: SkillContent[];
	pendingRequests: Map<string, PendingRequest>;
	pingTimer: ReturnType<typeof setInterval> | null;
}

interface RegistrationEntry {
	channelId: string;
	sessionId: string;
}

interface JsonRpcRequest {
	jsonrpc?: string;
	id?: string | number | null;
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: string | number | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Browser-forwarded request timeout. Blocking UI tools may wait for user
 * interaction, so this is generous (10 minutes).
 */
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
/** HTTP keepalive cadence for blocking MCP calls. */
const HTTP_KEEPALIVE_INTERVAL_MS = 20_000;
/** Browser WebSocket ping cadence. */
const PING_INTERVAL_MS = 15_000;

const SERVER_NAME = "leuria-webmcp";
/** MCP revisions this relay speaks; the client's choice wins when listed. */
const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"];
const SERVER_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// WebMcpServer
// ---------------------------------------------------------------------------

export class WebMcpServer {
	private readonly channels = new Map<string, WebMcpChannel>();
	private readonly registrationTokens = new Map<string, RegistrationEntry>();
	private readonly sessionChannels = new Map<string, string>();
	private readonly tokenToChannel = new Map<string, string>();
	private readonly registerWss: WebSocketServer;
	private readonly channelWss: WebSocketServer;

	constructor(
		private readonly logger: Logger,
		private readonly port: number,
	) {
		this.registerWss = new WebSocketServer({ noServer: true });
		this.channelWss = new WebSocketServer({ noServer: true });
	}

	// ── Channel lifecycle ────────────────────────────────────────────────

	/**
	 * Allocate a channel for an ACP session. Returns:
	 *   - `registrationToken` — base64-encoded `{ server, token }` blob the
	 *     browser presents on the `/webmcp/register` WS to claim the channel.
	 *   - `channelToken` — Bearer credential the agent presents on the
	 *     `/webmcp/mcp` HTTP endpoint.
	 *   - `channelId` — server-side handle (used in the channel WS path).
	 */
	createChannel(sessionId: string): {
		registrationToken: string;
		channelToken: string;
		channelId: string;
	} {
		const channelId = randomUUID();
		const channelToken = randomUUID();
		const regTokenRaw = randomUUID();

		const channel: WebMcpChannel = {
			id: channelId,
			sessionId,
			token: channelToken,
			browserWs: null,
			tools: new Map(),
			resources: new Map(),
			prompts: new Map(),
			skills: [],
			pendingRequests: new Map(),
			pingTimer: null,
		};

		this.channels.set(channelId, channel);
		this.sessionChannels.set(sessionId, channelId);
		this.tokenToChannel.set(channelToken, channelId);
		this.registrationTokens.set(regTokenRaw, { channelId, sessionId });

		this.logger.info("WebMCP channel created", { channelId, sessionId });

		const registrationPayload = {
			server: `ws://127.0.0.1:${this.port}`,
			token: regTokenRaw,
		};
		const registrationToken = Buffer.from(
			JSON.stringify(registrationPayload),
		).toString("base64");

		return { registrationToken, channelToken, channelId };
	}

	/**
	 * Tear everything down — remove every channel (ping timers, pending
	 * requests, browser WS), then close the two WebSocketServers. Called on
	 * shutdown so the process can exit on Ctrl-C; without it the WS servers
	 * keep the event loop alive indefinitely.
	 */
	close(): void {
		for (const sessionId of [...this.sessionChannels.keys()]) this.removeChannel(sessionId);
		try {
			this.registerWss.close();
		} catch {
			// already closed
		}
		try {
			this.channelWss.close();
		} catch {
			// already closed
		}
	}

	removeChannel(sessionId: string): void {
		const channelId = this.sessionChannels.get(sessionId);
		if (!channelId) return;

		const channel = this.channels.get(channelId);
		if (channel) {
			if (channel.pingTimer) {
				clearInterval(channel.pingTimer);
				channel.pingTimer = null;
			}
			for (const [, pending] of channel.pendingRequests) {
				clearTimeout(pending.timeout);
				pending.reject(new Error("WebMCP channel removed"));
			}
			channel.pendingRequests.clear();
			if (
				channel.browserWs &&
				channel.browserWs.readyState === WebSocket.OPEN
			) {
				channel.browserWs.close(1000, "channel removed");
			}
			this.tokenToChannel.delete(channel.token);
			this.channels.delete(channelId);
		}

		for (const [token, entry] of this.registrationTokens) {
			if (entry.channelId === channelId) {
				this.registrationTokens.delete(token);
			}
		}

		this.sessionChannels.delete(sessionId);
		this.logger.info("WebMCP channel removed", { sessionId, channelId });
	}

	// ── In-process access (the engine's own agent loop for LLM providers) ──

	/** Give a session its site's skills: the agent then also gets `read_skill`. */
	setSkills(sessionId: string, skills: SkillContent[]): void {
		const channelId = this.sessionChannels.get(sessionId);
		const channel = channelId ? this.channels.get(channelId) : undefined;
		if (channel) channel.skills = skills;
	}

	/** The tools a session's agent gets: the page's, and `read_skill` when the site has skills. */
	listTools(sessionId: string): ToolDescriptor[] {
		const channelId = this.sessionChannels.get(sessionId);
		const channel = channelId ? this.channels.get(channelId) : undefined;
		return channel ? this.toolsOf(channel) : [];
	}

	/** Run a page tool in the browser (or `read_skill` here); resolves with its JSON result. Throws on tool errors. */
	async callTool(sessionId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
		const channelId = this.sessionChannels.get(sessionId);
		const channel = channelId ? this.channels.get(channelId) : undefined;
		if (!channel) throw new Error("The page is not connected");
		if (name === READ_SKILL && channel.skills.length) return readSkill(channel.skills, args);
		if (!channel.tools.has(name)) throw new Error(`Unknown tool: ${name}`);
		return this.forwardToBrowser(channel, "callTool", { tool: name, arguments: args });
	}

	/** The page's tools, and the engine's `read_skill` in place of a page tool of that name. */
	private toolsOf(channel: WebMcpChannel): ToolDescriptor[] {
		const page = Array.from(channel.tools.values());
		if (!channel.skills.length) return page;
		return [...page.filter((t) => t.name !== READ_SKILL), readSkillTool(channel.skills)];
	}

	// ── HTTP / WS dispatch (called from daemon) ──────────────────────────

	/** Returns true when the request path belongs to WebMCP. */
	matches(pathname: string): boolean {
		return pathname.startsWith("/webmcp/");
	}

	handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
		const url = new URL(
			req.url ?? "/",
			`http://${req.headers.host ?? "127.0.0.1"}`,
		);

		if (url.pathname === "/webmcp/register") {
			this.registerWss.handleUpgrade(req, socket, head, (ws) =>
				this.handleRegistrationConnection(ws),
			);
			return;
		}

		const channelMatch = url.pathname.match(/^\/webmcp\/channel\/([^/]+)$/);
		if (channelMatch) {
			const channelId = channelMatch[1]!;
			const token = url.searchParams.get("token");
			const channel = this.channels.get(channelId);
			if (!channel || channel.token !== token) {
				this.logger.warn("WebMCP channel auth failed", { channelId });
				socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
				socket.destroy();
				return;
			}
			this.channelWss.handleUpgrade(req, socket, head, (ws) =>
				this.handleChannelConnection(channel, ws),
			);
			return;
		}

		socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
		socket.destroy();
	}

	async handleHttp(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		// Only `/webmcp/mcp` is exposed over HTTP today; everything else is WS.
		const url = new URL(
			req.url ?? "/",
			`http://${req.headers.host ?? "127.0.0.1"}`,
		);
		if (url.pathname !== "/webmcp/mcp") {
			this.sendJsonRpcError(res, null, -32601, "Not found", 404);
			return;
		}
		if (req.method !== "POST") {
			this.sendJsonRpcError(res, null, -32600, "Method not allowed", 405);
			return;
		}

		const authHeader = req.headers.authorization;
		if (!authHeader?.startsWith("Bearer ")) {
			this.sendJsonRpcError(res, null, -32000, "Unauthorized", 401);
			return;
		}
		const channelToken = authHeader.slice(7);
		const channelId = this.tokenToChannel.get(channelToken);
		if (!channelId) {
			this.sendJsonRpcError(res, null, -32000, "Invalid token", 401);
			return;
		}
		const channel = this.channels.get(channelId);
		if (!channel) {
			this.sendJsonRpcError(res, null, -32000, "Channel not found", 404);
			return;
		}

		let body: JsonRpcRequest;
		try {
			body = (await parseBody(req)) as JsonRpcRequest;
		} catch {
			this.sendJsonRpcError(res, null, -32700, "Parse error", 400);
			return;
		}
		if (!body.method) {
			this.sendJsonRpcError(
				res,
				body.id ?? null,
				-32600,
				"Invalid request",
				400,
			);
			return;
		}

		// Log every MCP request the agent makes — vital for diagnosing
		// "no tool calls" complaints. `tools/list` lets us confirm the
		// agent saw the tool catalogue; `tools/call` proves the agent
		// chose to use it.
		this.logger.info("WebMCP MCP request", {
			channelId,
			method: body.method,
			toolName:
				body.method === "tools/call"
					? (body.params?.name as string | undefined)
					: undefined,
			toolCount:
				body.method === "tools/list" ? channel.tools.size : undefined,
		});

		// A notification (no id) gets 202 and no body, per MCP Streamable
		// HTTP; strict clients (Codex's rmcp) abort the handshake otherwise.
		if (body.id === undefined || body.id === null) {
			await this.dispatch(channel, body).catch(() => undefined);
			res.writeHead(202);
			res.end();
			return;
		}

		const blocking =
			body.method === "tools/call" ||
			body.method === "resources/read" ||
			body.method === "prompts/get";

		if (blocking) {
			// No explicit Transfer-Encoding: without a Content-Length the
			// runtime chunks the body itself (setting the header by hand
			// breaks the framing under Bun).
			res.writeHead(200, {
				"Content-Type": "application/json",
				"Cache-Control": "no-cache",
			});
			res.flushHeaders();
			const keepAlive = setInterval(() => {
				if (!res.destroyed) res.write("\n");
			}, HTTP_KEEPALIVE_INTERVAL_MS);
			try {
				const result = await this.dispatch(channel, body);
				clearInterval(keepAlive);
				this.logger.info("WebMCP MCP response", {
					channelId,
					method: body.method,
					ok: true,
				});
				const payload: JsonRpcResponse = {
					jsonrpc: "2.0",
					id: body.id ?? null,
					result,
				};
				res.end(JSON.stringify(payload));
			} catch (err) {
				clearInterval(keepAlive);
				const payload: JsonRpcResponse = {
					jsonrpc: "2.0",
					id: body.id ?? null,
					error: this.rpcError(channelId, body.method, err),
				};
				res.end(JSON.stringify(payload));
			}
			return;
		}

		try {
			const result = await this.dispatch(channel, body);
			this.sendJsonRpcResult(res, body.id ?? null, result);
		} catch (err) {
			const { code, message } = this.rpcError(channelId, body.method, err);
			this.sendJsonRpcError(res, body.id ?? null, code, message, 500);
		}
	}

	/** Map a dispatch failure to a JSON-RPC error, and log it. */
	private rpcError(channelId: string, method: string, err: unknown): { code: number; message: string } {
		const message = err instanceof Error ? err.message : String(err);
		const unsupported = message.startsWith("Unsupported method");
		const code = unsupported ? -32601 : message.includes("not connected") ? -32001 : -32603;
		// Newer MCP clients probe optional methods; that is not an error.
		this.logger[unsupported ? "info" : "warn"]("WebMCP MCP error", { channelId, method, message });
		return { code, message };
	}

	// ── Browser registration WS ─────────────────────────────────────────

	private handleRegistrationConnection(ws: WebSocket): void {
		ws.on("message", (data) => {
			let msg: Record<string, unknown>;
			try {
				msg = JSON.parse(data.toString()) as Record<string, unknown>;
			} catch {
				ws.send(
					JSON.stringify({ type: "error", message: "Invalid JSON" }),
				);
				return;
			}
			if (msg.type !== "register" || typeof msg.token !== "string") {
				ws.send(
					JSON.stringify({
						type: "error",
						message: "Expected register message",
					}),
				);
				return;
			}

			// The token may arrive raw or as the base64 blob `createChannel`
			// returns. Try the blob first, fall back to raw.
			let regToken = msg.token as string;
			try {
				const decoded = JSON.parse(
					Buffer.from(regToken, "base64").toString("utf-8"),
				) as { token?: string };
				if (typeof decoded.token === "string") regToken = decoded.token;
			} catch {
				// not a blob; use raw
			}

			const entry = this.registrationTokens.get(regToken);
			if (!entry) {
				ws.send(
					JSON.stringify({
						type: "error",
						message: "Invalid registration token",
					}),
				);
				return;
			}
			const channel = this.channels.get(entry.channelId);
			if (!channel) {
				ws.send(
					JSON.stringify({ type: "error", message: "Channel not found" }),
				);
				return;
			}
			// One-shot: consume the registration token.
			this.registrationTokens.delete(regToken);

			ws.send(
				JSON.stringify({
					type: "registerSuccess",
					channel: `/webmcp/channel/${channel.id}`,
					token: channel.token,
				}),
			);
			this.logger.info("WebMCP registration success", {
				channelId: channel.id,
			});
		});
	}

	// ── Browser channel WS ──────────────────────────────────────────────

	private handleChannelConnection(channel: WebMcpChannel, ws: WebSocket): void {
		if (channel.pingTimer) {
			clearInterval(channel.pingTimer);
			channel.pingTimer = null;
		}
		channel.browserWs = ws;
		this.logger.info("WebMCP browser connected", { channelId: channel.id });

		channel.pingTimer = setInterval(() => {
			if (ws.readyState === WebSocket.OPEN) {
				try {
					ws.send(JSON.stringify({ type: "ping" }));
				} catch {
					// closed mid-ping; close handler will reset
				}
			}
		}, PING_INTERVAL_MS);

		ws.on("message", (data) => {
			let msg: Record<string, unknown>;
			try {
				msg = JSON.parse(data.toString()) as Record<string, unknown>;
			} catch {
				return;
			}
			this.handleChannelMessage(channel, msg);
		});

		ws.on("close", () => {
			if (channel.pingTimer) {
				clearInterval(channel.pingTimer);
				channel.pingTimer = null;
			}
			channel.browserWs = null;
			this.logger.info("WebMCP browser disconnected", {
				channelId: channel.id,
			});
		});

		ws.on("error", (err) => {
			this.logger.error("WebMCP channel WS error", {
				channelId: channel.id,
				err: err.message,
			});
		});
	}

	private handleChannelMessage(
		channel: WebMcpChannel,
		msg: Record<string, unknown>,
	): void {
		const type = msg.type as string | undefined;
		switch (type) {
			case "registerTool": {
				const tool = this.parseTool(msg);
				if (tool) {
					channel.tools.set(tool.name, tool);
					this.logger.info("WebMCP tool registered", {
						channelId: channel.id,
						name: tool.name,
						toolCount: channel.tools.size,
					});
					this.sendAck(channel, "registerTool", tool.name);
				}
				return;
			}
			case "registerResource": {
				const resource = this.parseResource(msg);
				if (resource) {
					channel.resources.set(resource.uri, resource);
					this.sendAck(channel, "registerResource", resource.uri);
				}
				return;
			}
			case "registerPrompt": {
				const prompt = this.parsePrompt(msg);
				if (prompt) {
					channel.prompts.set(prompt.name, prompt);
					this.sendAck(channel, "registerPrompt", prompt.name);
				}
				return;
			}
			case "deregisterTool": {
				const name = msg.name as string | undefined;
				if (name) channel.tools.delete(name);
				return;
			}
			case "toolResponse":
			case "resourceResponse":
			case "promptResponse": {
				const id = msg.id as string | undefined;
				if (id) {
					this.resolveRequest(
						channel,
						id,
						msg.result,
						msg.error as Record<string, unknown> | string | undefined,
					);
				}
				return;
			}
			case "ping":
				if (channel.browserWs?.readyState === WebSocket.OPEN) {
					try {
						channel.browserWs.send(JSON.stringify({ type: "pong" }));
					} catch {
						// closed mid-pong
					}
				}
				return;
			case "pong":
				return;
			default:
				return;
		}
	}

	private parseTool(msg: Record<string, unknown>): ToolDescriptor | null {
		const nested = msg.tool as Record<string, unknown> | undefined;
		const src = nested && typeof nested.name === "string" ? nested : msg;
		if (typeof src.name !== "string") {
			this.logger.warn("WebMCP registerTool missing name", {});
			return null;
		}
		return {
			name: src.name,
			description: src.description as string | undefined,
			inputSchema:
				(src.inputSchema as Record<string, unknown> | undefined) ?? {
					type: "object",
					properties: {},
				},
			annotations: src.annotations as Record<string, unknown> | undefined,
		};
	}

	private parseResource(
		msg: Record<string, unknown>,
	): ResourceDescriptor | null {
		const nested = msg.resource as Record<string, unknown> | undefined;
		const src = nested && typeof nested.uri === "string" ? nested : msg;
		if (typeof src.uri !== "string") {
			this.logger.warn("WebMCP registerResource missing uri", {});
			return null;
		}
		return {
			uri: src.uri,
			name: (src.name as string | undefined) ?? src.uri,
			description: src.description as string | undefined,
			mimeType: src.mimeType as string | undefined,
		};
	}

	private parsePrompt(msg: Record<string, unknown>): PromptDescriptor | null {
		const nested = msg.prompt as Record<string, unknown> | undefined;
		const src = nested && typeof nested.name === "string" ? nested : msg;
		if (typeof src.name !== "string") {
			this.logger.warn("WebMCP registerPrompt missing name", {});
			return null;
		}
		return {
			name: src.name,
			description: src.description as string | undefined,
			arguments: src.arguments as PromptDescriptor["arguments"],
		};
	}

	private sendAck(
		channel: WebMcpChannel,
		registration: string,
		name: string,
	): void {
		if (channel.browserWs?.readyState !== WebSocket.OPEN) return;
		try {
			channel.browserWs.send(
				JSON.stringify({ type: "ack", registration, name }),
			);
		} catch {
			// closed mid-ack
		}
	}

	private resolveRequest(
		channel: WebMcpChannel,
		id: string,
		result: unknown,
		error?: Record<string, unknown> | string,
	): void {
		const pending = channel.pendingRequests.get(id);
		if (!pending) return;
		clearTimeout(pending.timeout);
		channel.pendingRequests.delete(id);
		if (error) {
			const message =
				typeof error === "string"
					? error
					: ((error.message as string) ?? "Browser returned error");
			pending.reject(new Error(message));
		} else {
			pending.resolve(result);
		}
	}

	// ── MCP JSON-RPC dispatch ───────────────────────────────────────────

	private async dispatch(
		channel: WebMcpChannel,
		req: JsonRpcRequest,
	): Promise<unknown> {
		switch (req.method) {
			case "initialize": {
				const requested = (req.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
				return {
					protocolVersion:
						typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
							? requested
							: SUPPORTED_PROTOCOL_VERSIONS[SUPPORTED_PROTOCOL_VERSIONS.length - 1],
					serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
					capabilities: {
						tools: { listChanged: false },
						resources: { subscribe: false, listChanged: false },
						prompts: { listChanged: false },
					},
				};
			}

			case "tools/list":
				return {
					tools: this.toolsOf(channel).map((t) => ({
						name: t.name,
						description: t.description,
						inputSchema: t.inputSchema,
						annotations: t.annotations,
					})),
				};

			case "tools/call": {
				const name = req.params?.name as string | undefined;
				const args = req.params?.arguments as
					| Record<string, unknown>
					| undefined;
				if (!name) throw new Error("Missing tool name");
				if (name === READ_SKILL && channel.skills.length) {
					return { content: [{ type: "text", text: readSkill(channel.skills, args ?? {}) }] };
				}
				if (!channel.tools.has(name)) {
					throw new Error(`Unknown tool: ${name}`);
				}
				const raw = await this.forwardToBrowser(channel, "callTool", {
					tool: name,
					arguments: args,
				});
				const text =
					typeof raw === "string" ? raw : JSON.stringify(raw);
				return { content: [{ type: "text", text }] };
			}

			case "resources/list":
				return {
					resources: Array.from(channel.resources.values()).map((r) => ({
						uri: r.uri,
						name: r.name,
						description: r.description,
						mimeType: r.mimeType,
					})),
				};

			case "resources/read": {
				const uri = req.params?.uri as string | undefined;
				if (!uri) throw new Error("Missing resource URI");
				if (!channel.resources.has(uri)) {
					throw new Error(`Unknown resource: ${uri}`);
				}
				const raw = (await this.forwardToBrowser(channel, "readResource", {
					uri,
				})) as
					| { content?: string; mimeType?: string }
					| undefined
					| string;
				const text =
					typeof raw === "string"
						? raw
						: (raw?.content ?? JSON.stringify(raw));
				const mimeType =
					typeof raw === "object" && raw && "mimeType" in raw
						? raw.mimeType ?? "text/plain"
						: "text/plain";
				return { contents: [{ uri, text, mimeType }] };
			}

			case "prompts/list":
				return {
					prompts: Array.from(channel.prompts.values()).map((p) => ({
						name: p.name,
						description: p.description,
						arguments: p.arguments,
					})),
				};

			case "prompts/get": {
				const name = req.params?.name as string | undefined;
				const args = req.params?.arguments as
					| Record<string, unknown>
					| undefined;
				if (!name) throw new Error("Missing prompt name");
				if (!channel.prompts.has(name)) {
					throw new Error(`Unknown prompt: ${name}`);
				}
				return await this.forwardToBrowser(channel, "getPrompt", {
					name,
					arguments: args,
				});
			}

			case "notifications/initialized":
				return undefined;

			default:
				throw new Error(`Unsupported method: ${req.method}`);
		}
	}

	// ── Forwarding agent → browser ──────────────────────────────────────

	private forwardToBrowser(
		channel: WebMcpChannel,
		type: string,
		payload: Record<string, unknown>,
	): Promise<unknown> {
		if (
			!channel.browserWs ||
			channel.browserWs.readyState !== WebSocket.OPEN
		) {
			return Promise.reject(
				new Error("Browser WebSocket not connected to channel"),
			);
		}
		const id = randomUUID();
		return new Promise<unknown>((resolve, reject) => {
			const timeout = setTimeout(() => {
				channel.pendingRequests.delete(id);
				reject(
					new Error(
						`WebMCP request timed out after ${REQUEST_TIMEOUT_MS}ms (type=${type})`,
					),
				);
			}, REQUEST_TIMEOUT_MS);
			channel.pendingRequests.set(id, { resolve, reject, timeout });
			try {
				channel.browserWs!.send(
					JSON.stringify({ type, id, ...payload }),
				);
			} catch (err) {
				clearTimeout(timeout);
				channel.pendingRequests.delete(id);
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
	}

	// ── HTTP helpers ────────────────────────────────────────────────────

	private sendJsonRpcResult(
		res: ServerResponse,
		id: string | number | null,
		result: unknown,
	): void {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ jsonrpc: "2.0", id, result } satisfies JsonRpcResponse));
	}

	private sendJsonRpcError(
		res: ServerResponse,
		id: string | number | null,
		code: number,
		message: string,
		httpStatus = 500,
	): void {
		res.writeHead(httpStatus, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({
				jsonrpc: "2.0",
				id,
				error: { code, message },
			} satisfies JsonRpcResponse),
		);
	}
}
