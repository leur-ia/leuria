/**
 * Loopback HTTP + WebSocket server: the engine's only door.
 *
 *   - Binds to 127.0.0.1 and rejects any `Host` other than
 *     127.0.0.1/localhost on our port (blocks DNS rebinding).
 *   - Requests without `Origin` come from local processes (the agent
 *     calling `/webmcp/mcp`, the CLI, curl) and are trusted: they already
 *     run as the visitor.
 *   - Silent (the desktop app): a web origin the visitor never connected,
 *     and that no `leuria://connect` link named, gets nothing it can read,
 *     on any route. It can't tell that Leuria is here.
 *   - A web origin claims its token with `/connect/claim`; everything else
 *     needs the origin's grant token in `Authorization: Bearer`, and
 *     WebSocket upgrades need a grant.
 *   - The engine's own origin may only use `/connect` (the CLI's approval page).
 */

import { timingSafeEqual } from "node:crypto";
import * as http from "node:http";
import type { Duplex } from "node:stream";

import type { GrantStore } from "./grants.js";
import { normalizeOrigin } from "./grants.js";
import { DEFAULT_PORT } from "./home.js";
import { parseBody, sendJson } from "./http-utils.js";
import { type Embeddings, localEmbeddings, NoEmbedderError, parseEmbedBody } from "./llm/embeddings.js";
import type { Logger } from "./logger.js";
import { Pairing, type PairingRequestInfo } from "./pairing.js";
import { handleSessionRequest } from "./routes.js";
import { type AgentLaunch, SessionManager, type SessionManagerOptions } from "./session-manager.js";
import { SkillService } from "./skills.js";
import { VERSION } from "./version.js";
import { WebMcpServer } from "./webmcp-server.js";

export { DEFAULT_PORT, VERSION };

export interface EngineOptions {
	port?: number;
	grants: GrantStore;
	logger: Logger;
	/** Plain-language agent name, e.g. "Claude Code"; a function when it can change. */
	agentName: string | (() => string);
	/** What a connected site uses, for its status line ("Claude · Sonnet 5"); the default AI's name otherwise. */
	siteAgentName?: (origin: string) => string;
	/** Command for the agent serving `origin` (a site's own choice or the default); called once per session. */
	resolveAgent: (origin: string) => Promise<AgentLaunch>;
	/** Called when a site asks to connect. */
	onPairingRequest?: (request: PairingRequestInfo) => void;
	onPairingDecided?: (request: { requestId: string; origin: string; allowed: boolean }) => void;
	/**
	 * Silent to sites the visitor didn't connect: no answer they can read,
	 * so they can't tell that Leuria is here. Pairing then starts from a
	 * `leuria://connect` link. Default: on with the desktop app (`admin`).
	 */
	silent?: boolean;
	/**
	 * Admin API for the desktop app, under `/admin/`. Every request must
	 * carry `Authorization: Bearer <token>`, and come from the app's webview
	 * (`tauri://` origin) or a local process.
	 */
	admin?: {
		token: string;
		handle: (
			req: http.IncomingMessage,
			res: http.ServerResponse,
			pathname: string,
			pairing: Pairing,
			sessions: Pick<SessionManager, "closeWhere">,
		) => Promise<boolean>;
	};
	startTimeoutMs?: number;
	/** See `SessionManagerOptions.stdioMcpCommand`. */
	stdioMcpCommand?: { command: string; args: string[] };
	/** See `SessionManagerOptions.onAgentState`. */
	onAgentState?: SessionManagerOptions["onAgentState"];
	/** Embeddings for connected sites. Default: an embedding model in LM Studio or Ollama on this computer. */
	embeddings?: Embeddings;
	/** The skills sites give their AI. Default: fetched from GitHub or the site, cached in `~/.leuria/skills`. */
	skills?: SkillService;
}

export interface EngineHandle {
	port: number;
	pairing: Pairing;
	sessions: SessionManager;
	/** Revoke an origin's grant and end its sessions. */
	revoke: (origin: string) => boolean;
	close: () => Promise<void>;
}

/** The desktop app's webview: `tauri://localhost`, `http(s)://tauri.localhost`, and its dev server on localhost. */
const ADMIN_ORIGINS = /^(tauri:\/\/localhost|https?:\/\/tauri\.localhost|http:\/\/(localhost|127\.0\.0\.1):\d+)$/;

type Caller =
	| { kind: "local" }
	| { kind: "self" }
	| { kind: "site"; origin: string; authorized: boolean };

export async function startEngine(options: EngineOptions): Promise<EngineHandle> {
	const port = options.port ?? DEFAULT_PORT;
	const { logger, grants } = options;
	const embeddings = options.embeddings ?? localEmbeddings();
	const selfOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
	const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
	const silent = options.silent ?? Boolean(options.admin);

	const skills = options.skills ?? new SkillService({ grants, logger });
	const webMcpServer = new WebMcpServer(logger, port);
	const sessions = new SessionManager({
		webMcpServer,
		port,
		logger,
		resolveAgent: options.resolveAgent,
		loadSkills: (origin) => skills.forSession(origin),
		startTimeoutMs: options.startTimeoutMs,
		stdioMcpCommand: options.stdioMcpCommand,
		onAgentState: options.onAgentState,
	});
	// A revoked site loses its running agents too.
	grants.onRemoved((origin) => sessions.closeOrigin(origin));
	// A site's AI or model changed: its open conversation ends, the next message uses the new one.
	grants.onChanged((origin) => sessions.closeOrigin(origin));
	const pairing = new Pairing({
		grants,
		logger,
		selfOrigins,
		port,
		linksOnly: silent,
		agentName: () => agentName(),
		resolveSkills: (origin, refs) => skills.resolve(origin, refs),
		onRequest: options.onPairingRequest,
		onDecided: options.onPairingDecided,
	});

	const agentName = typeof options.agentName === "function" ? options.agentName : () => options.agentName as string;

	const handleAdmin = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
		const admin = options.admin!;
		const origin = req.headers.origin;
		if (origin) {
			// Only the app's own webview reads the admin API; a website hears nothing.
			if (!ADMIN_ORIGINS.test(origin)) {
				res.statusCode = 403;
				res.end();
				return;
			}
			res.setHeader("Access-Control-Allow-Origin", origin);
			res.setHeader("Vary", "Origin");
		}
		if (req.method === "OPTIONS") {
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
			res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
			res.statusCode = 204;
			res.end();
			return;
		}
		const auth = req.headers.authorization ?? "";
		const given = Buffer.from(auth.startsWith("Bearer ") ? auth.slice(7) : "");
		const expected = Buffer.from(admin.token);
		if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
			sendJson(res, 401, { error: "Unauthorized" });
			return;
		}
		const { pathname } = new URL(req.url ?? "/", "http://127.0.0.1");
		try {
			if (!(await admin.handle(req, res, pathname, pairing, sessions))) sendJson(res, 404, { error: "Not found" });
		} catch (err) {
			logger.error("admin request failed", { url: req.url, err: err instanceof Error ? err.message : String(err) });
			if (!res.headersSent) sendJson(res, 500, { error: err instanceof Error ? err.message : "Internal error" });
		}
	};

	const identify = (req: http.IncomingMessage): Caller | null => {
		const origin = req.headers.origin;
		if (!origin) return { kind: "local" };
		if (selfOrigins.has(origin)) return { kind: "self" };
		let normalized: string;
		try {
			normalized = normalizeOrigin(origin);
		} catch {
			return null;
		}
		const auth = req.headers.authorization;
		const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
		return { kind: "site", origin: normalized, authorized: grants.verify(normalized, token) };
	};

	const server = http.createServer(async (req, res) => {
		if (!allowedHosts.has(req.headers.host ?? "")) {
			sendJson(res, 403, { error: "host not allowed" });
			return;
		}
		if (options.admin && (req.url ?? "").startsWith("/admin/")) {
			await handleAdmin(req, res);
			return;
		}
		const caller = identify(req);
		if (!caller) {
			sendJson(res, 403, { error: "origin not allowed" });
			return;
		}
		const { pathname } = new URL(req.url ?? "/", "http://127.0.0.1");

		if (caller.kind === "site") {
			// Silent: a site the visitor never connected, and didn't just ask
			// about through a link, gets no answer it can read, so it can't
			// tell that Leuria is here.
			if (silent && !grants.has(caller.origin) && !pairing.hasRequest(caller.origin)) {
				res.statusCode = 403;
				res.end();
				return;
			}
			res.setHeader("Access-Control-Allow-Origin", req.headers.origin!);
			res.setHeader("Access-Control-Allow-Private-Network", "true");
			res.setHeader("Vary", "Origin");
		}
		if (req.method === "OPTIONS") {
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
			res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
			res.setHeader("Access-Control-Max-Age", "600");
			res.statusCode = 204;
			res.end();
			return;
		}

		try {
			if (pathname === "/health" && req.method === "GET") {
				sendJson(res, 200, {
					leuria: VERSION,
					ok: true,
					// A connected site hears about its own AI and model.
					agent: caller.kind === "site" && caller.authorized && options.siteAgentName ? options.siteAgentName(caller.origin) : agentName(),
					// "app": the desktop app asks the visitor natively; "page": the engine's approval page.
					approvals: options.admin ? "app" : "page",
					...(caller.kind === "site" ? { paired: caller.authorized } : {}),
					// A connected site hears which embedding model it would get.
					...(caller.kind !== "site" || caller.authorized ? { embed: (await embeddings.find())?.model } : {}),
				});
				return;
			}
			if (await pairing.handle(req, res, pathname)) return;

			if (caller.kind === "self") {
				sendJson(res, 403, { error: "Forbidden" });
				return;
			}
			if (caller.kind === "site" && !caller.authorized) {
				sendJson(res, 401, { error: "This site is not connected to Leuria", code: "not_paired" });
				return;
			}
			if (webMcpServer.matches(pathname)) {
				// The agent's MCP endpoint takes no browser traffic.
				if (caller.kind === "site") {
					sendJson(res, 403, { error: "Forbidden" });
					return;
				}
				await webMcpServer.handleHttp(req, res);
				return;
			}
			if (pathname === "/embed" && req.method === "POST") {
				let request: ReturnType<typeof parseEmbedBody>;
				try {
					request = parseEmbedBody(await parseBody(req));
				} catch (error) {
					sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
					return;
				}
				try {
					sendJson(res, 200, await embeddings.embed(request.texts, request.kind));
				} catch (error) {
					const none = error instanceof NoEmbedderError;
					sendJson(res, none ? 503 : 502, { error: error instanceof Error ? error.message : String(error), ...(none ? { code: "no_embedder" } : {}) });
				}
				return;
			}
			const requester = caller.kind === "site" ? caller.origin : "local";
			const onSkills = caller.kind === "site" ? (origin: string, refs: string[] | undefined) => skills.refresh(origin, refs) : undefined;
			if (await handleSessionRequest(req, res, pathname, sessions, requester, onSkills)) return;
			sendJson(res, 404, { error: "Not found" });
		} catch (err) {
			logger.error("request failed", {
				url: req.url,
				err: err instanceof Error ? err.message : String(err),
			});
			if (!res.headersSent) sendJson(res, 500, { error: "Internal error" });
		}
	});

	server.on("upgrade", (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
		const { pathname } = new URL(req.url ?? "/", "http://127.0.0.1");
		const caller = allowedHosts.has(req.headers.host ?? "") ? identify(req) : null;
		// Browsers cannot set headers on WebSockets: a grant for the origin
		// is required, and the one-time registration token does the rest.
		const allowed =
			caller !== null &&
			(caller.kind === "local" || (caller.kind === "site" && grants.has(caller.origin)));
		if (!allowed || !webMcpServer.matches(pathname)) {
			logger.warn("upgrade rejected", { origin: req.headers.origin, url: pathname });
			socket.write(`HTTP/1.1 ${allowed ? "404 Not Found" : "403 Forbidden"}\r\n\r\n`);
			socket.destroy();
			return;
		}
		webMcpServer.handleUpgrade(req, socket, head);
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => resolve());
	});
	const boundPort = (server.address() as { port: number }).port;

	return {
		port: boundPort,
		pairing,
		sessions,
		revoke: (origin) => grants.revoke(origin),
		close: async () => {
			sessions.shutdown();
			webMcpServer.close();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
