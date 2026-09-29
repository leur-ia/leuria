/**
 * Low-level client for the Leuria engine protocol (docs/protocol.md):
 * detection, pairing, agent sessions and the WebMCP tool channel.
 *
 * Most sites use `createLeuria()` with the `bridge()` provider instead;
 * this class is what that provider is built on.
 */

export const DEFAULT_URL = "http://127.0.0.1:19570";

export type BridgeStatus = "offline" | "unpaired" | "ready";

export interface Detection {
	/**
	 * - `ready`: this site is connected and Leuria answered;
	 * - `unpaired`: this site isn't connected. Leuria answers no site it
	 *   doesn't know, so whether it is installed is only learned by `connect()`;
	 * - `offline`: this site is connected, but Leuria didn't answer (not running).
	 */
	status: BridgeStatus;
	/** Engine version, when it answered. */
	version?: string;
	/** Plain-language name of the visitor's agent, e.g. "Claude Code". */
	agent?: string;
	/** The embedding model this site would get (connected sites only), if the visitor has one. */
	embed?: string;
}

export type BridgeEvent =
	/** The agent is up and idle (a session started without a prompt). */
	| { type: "ready" }
	| { type: "turn_start" }
	| { type: "chunk"; text: string }
	/** Agent reasoning text. */
	| { type: "thought"; text: string }
	| {
			type: "tool_call";
			toolCallId: string;
			title?: string;
			kind?: string;
			status?: string;
			toolName?: string;
	  }
	| { type: "permission"; toolName: string; allow: boolean }
	| { type: "log"; text: string }
	| { type: "turn_completed"; text: string; durationMs: number }
	| { type: "completed" }
	| { type: "cancelled" }
	| { type: "failed"; error: string };

export interface BridgeTool {
	name: string;
	description: string;
	/** JSON Schema of the arguments. */
	inputSchema: Record<string, unknown>;
	/** Runs in the page. The result is sent to the agent as JSON. */
	handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

/** A file for the agent: images as base64, other files as text. */
export type BridgeAttachment =
	| { type: "image"; mimeType: string; data: string; name?: string }
	| { type: "text"; text: string; name?: string; mimeType?: string };

export interface BridgeSessionOptions {
	/**
	 * First prompt, sent as soon as the agent is up. Without it the agent
	 * starts and waits (a `ready` event follows): a warm session.
	 */
	prompt?: string;
	attachments?: BridgeAttachment[];
	/** Replaces the agent's default (coding) system prompt. */
	systemPrompt?: string;
	maxTurns?: number;
	tools?: BridgeTool[];
	/** Subscribed before the agent starts, so no event is missed. */
	onEvent?: (event: BridgeEvent) => void;
}

/**
 * What the site's features need, so Leuria can guide the visitor to an AI
 * and model that fit, and no bigger (bigger costs them more). Guidance
 * only: the visitor decides. Never model names.
 */
export interface SiteNeeds {
	/** The features use page tools. */
	tools?: boolean;
	/** The features send images. */
	images?: boolean;
	/** How hard the tasks are: `light` (answer, extract, summarize), `standard` (several steps with tools), `deep` (long reasoning, agentic work). */
	effort?: "light" | "standard" | "deep";
	/** About how much text one turn sends, in tokens. */
	context?: number;
}

export interface BridgeClientOptions {
	/** Engine URL. Default {@link DEFAULT_URL}. */
	url?: string;
	/** Name shown to the visitor in the approval window. */
	app?: string;
	/** What the site's features need: Leuria recommends an AI and model that fit. */
	needs?: SiteNeeds;
	/**
	 * Skills that guide the visitor's AI on this site, in the `npx skills`
	 * syntax: `owner/repo`, `owner/repo@skill`, `owner/repo/path#commit`, a
	 * GitHub URL, or a path on this site (`/` for its
	 * `.well-known/agent-skills`). Leuria fetches them, shows them to the
	 * visitor, and gives them to the AI in this site's conversations only.
	 */
	skills?: string[];
	/** Where the site's token is kept. Default: `localStorage`, else memory. */
	storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

export interface ConnectOptions {
	/** Give up waiting for the visitor's answer after this long. Default 5 minutes. */
	timeoutMs?: number;
	/** Leuria must answer within this long, or it isn't running (or installed). Default 4 s. */
	reachMs?: number;
	/**
	 * Called when Leuria hasn't answered within `reachMs`; the attempt then
	 * goes on in the background (the app may still be starting, or be
	 * installed meanwhile) until `timeoutMs`. Without it, `connect()`
	 * rejects with {@link LeuriaNotRunningError} at `reachMs`.
	 */
	onUnreached?: () => void;
	/** Stop waiting (a newer attempt replaces this one). */
	signal?: AbortSignal;
	/**
	 * Hand the `leuria://connect` link to the system, which opens the Leuria
	 * app (and starts it if needed). Default: follow the link in this page;
	 * `false` opens nothing (tests, or a CLI engine that asks by itself).
	 */
	openLink?: ((url: string) => void) | false;
}

/** The visitor has not connected this site, or disconnected it. */
export class LeuriaNotConnectedError extends Error {
	constructor(message = "This site is not connected to Leuria.") {
		super(message);
		this.name = "LeuriaNotConnectedError";
	}
}

/** `connect()` got no answer from Leuria: it isn't running, or isn't installed. */
export class LeuriaNotRunningError extends LeuriaNotConnectedError {
	constructor(message = "Leuria didn't answer: it isn't running on this computer, or isn't installed.") {
		super(message);
		this.name = "LeuriaNotRunningError";
	}
}

/** A secret for one pairing attempt: only the page that made it can collect the answer. */
function newNonce(): string {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Needs as link parameters: `tools=1&images=1&effort=light&context=8000`. */
function needsQuery(needs: SiteNeeds | undefined): Record<string, string> {
	if (!needs) return {};
	return {
		...(needs.tools ? { tools: "1" } : {}),
		...(needs.images ? { images: "1" } : {}),
		...(needs.effort ? { effort: needs.effort } : {}),
		...(needs.context ? { context: String(needs.context) } : {}),
	};
}

/** Follow a `leuria://` link from this page, as a click on a link would: the system opens the app. */
function followLink(url: string): void {
	if (typeof document === "undefined") return;
	const link = document.createElement("a");
	link.href = url;
	link.rel = "noopener";
	link.style.display = "none";
	document.body.append(link);
	link.click();
	link.remove();
}


export class BridgeClient {
	readonly url: string;
	private readonly app?: string;
	private readonly needs?: SiteNeeds;
	private readonly skills?: string[];
	private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
	private readonly tokenKey: string;

	constructor(options: BridgeClientOptions = {}) {
		this.url = (options.url ?? DEFAULT_URL).replace(/\/+$/, "");
		this.app = options.app;
		this.needs = options.needs;
		this.skills = options.skills;
		this.storage = options.storage ?? defaultStorage();
		this.tokenKey = `leuria:token:${this.url}`;
	}

	/**
	 * Is this site connected, and is Leuria running? Without a token, nothing
	 * is asked: Leuria doesn't answer sites it doesn't know (and a request to
	 * the computer would make the browser ask about local network access).
	 */
	async detect(timeoutMs = 1500): Promise<Detection> {
		const token = this.token();
		if (!token) return { status: "unpaired" };
		const res = await fetch(`${this.url}/health`, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(timeoutMs),
		}).catch(() => null);
		if (!res?.ok) return { status: "offline" };
		const body = (await res.json().catch(() => ({}))) as {
			leuria?: string;
			agent?: string;
			paired?: boolean;
			embed?: string;
		};
		if (!body.leuria) return { status: "offline" };
		// `paired` is only reported to web pages; without an Origin
		// (e.g. in tests) trust the stored token.
		const paired = body.paired ?? true;
		if (!paired) this.forget();
		return {
			status: paired ? "ready" : "unpaired",
			version: body.leuria,
			agent: body.agent,
			...(paired && body.embed ? { embed: body.embed } : {}),
		};
	}

	/**
	 * Ask the visitor to connect this site. Call it from a click handler:
	 * it opens the Leuria app with a `leuria://connect` link, and the
	 * visitor answers in Leuria's own window. Resolves once allowed; rejects
	 * with {@link LeuriaNotRunningError} when Leuria never answered, and
	 * {@link LeuriaNotConnectedError} when the visitor said no.
	 */
	async connect(options: ConnectOptions = {}): Promise<void> {
		const nonce = newNonce();
		const origin = typeof location === "undefined" ? undefined : location.origin;
		if (options.openLink !== false && origin) {
			const query = new URLSearchParams({ origin, nonce, ...(this.app ? { app: this.app } : {}), ...needsQuery(this.needs) });
			for (const skill of this.skills ?? []) query.append("skill", skill);
			(options.openLink ?? followLink)(`leuria://connect?${query}`);
		}
		const started = Date.now();
		const deadline = started + (options.timeoutMs ?? 5 * 60_000);
		const reachBy = started + (options.reachMs ?? 4_000);
		let reached = false;
		let told = false;
		while (Date.now() < deadline) {
			if (options.signal?.aborted) throw new LeuriaNotConnectedError("A newer attempt replaced this one.");
			// No answer a page can read: Leuria isn't there, or the link hasn't reached it yet.
			const res = await fetch(`${this.url}/connect/claim`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ nonce, app: this.app, needs: this.needs, skills: this.skills }),
				signal: options.signal,
			}).catch(() => null);
			if (!res || res.status === 404) {
				if (Date.now() > reachBy && !told) {
					if (!options.onUnreached) throw reached ? new LeuriaNotConnectedError("Leuria didn't get the request. Try again.") : new LeuriaNotRunningError();
					told = true;
					options.onUnreached();
				}
				await sleep(750);
				continue;
			}
			reached = true;
			const body = (await res.json().catch(() => ({}))) as { status?: string; token?: string; error?: string };
			if (res.status === 429) throw new LeuriaNotConnectedError("The visitor just said no to this site.");
			if (!res.ok) throw new LeuriaNotConnectedError(body.error ?? `Leuria refused the request (${res.status}).`);
			if (body.status === "allowed" && body.token) {
				this.storage.setItem(this.tokenKey, body.token);
				return;
			}
			if (body.status === "denied") throw new LeuriaNotConnectedError("The visitor did not allow this site.");
			// Still pending: ask again (the engine holds each request up to 25 s).
		}
		throw reached ? new LeuriaNotConnectedError("No decision was made.") : new LeuriaNotRunningError();
	}

	/**
	 * Open Leuria on this site's settings, where the visitor changes its AI
	 * and model. Call it from a click. The link carries nothing secret and
	 * changes nothing by itself.
	 */
	manage(options: { openLink?: (url: string) => void } = {}): void {
		if (typeof location === "undefined") return;
		(options.openLink ?? followLink)(`leuria://site?${new URLSearchParams({ origin: location.origin })}`);
	}

	/** Forget this site's token in this browser. */
	forget(): void {
		this.storage.removeItem(this.tokenKey);
	}

	/**
	 * Start an agent session: registers the page tools, then starts the
	 * visitor's agent with the first prompt.
	 */
	async startSession(options: BridgeSessionOptions): Promise<BridgeSession> {
		const prepared = await this.post<{ sessionId: string; registrationToken: string }>(
			"/session/prepare",
			{
				prompt: options.prompt,
				attachments: options.attachments,
				systemPrompt: options.systemPrompt,
				maxTurns: options.maxTurns,
				// The site's current list: Leuria picks up skills it added or removed.
				...(this.skills ? { skills: this.skills } : {}),
			},
		);
		const session = new BridgeSession(this, prepared.sessionId);
		try {
			await session.connectTools(prepared.registrationToken, options.tools ?? []);
			if (options.onEvent) session.onEvent(options.onEvent);
			await session.subscribe();
			await this.post(`/session/${session.id}/approve`, {});
			session.status = options.prompt ? "running" : "starting";
			return session;
		} catch (error) {
			session.close();
			throw error;
		}
	}

	/** @internal */
	token(): string | null {
		try {
			return this.storage.getItem(this.tokenKey);
		} catch {
			return null;
		}
	}

	/** @internal */
	headers(json = true): Record<string, string> {
		const headers: Record<string, string> = json ? { "Content-Type": "application/json" } : {};
		const token = this.token();
		if (token) headers.Authorization = `Bearer ${token}`;
		return headers;
	}

	/** @internal */
	/** Embed texts with the visitor's embedding model (see `Detection.embed`). */
	embed(texts: string[], kind: "query" | "document", signal?: AbortSignal): Promise<{ model: string; vectors: number[][] }> {
		return this.post("/embed", { texts, kind }, { signal });
	}

	async post<T = unknown>(path: string, body: unknown, init: RequestInit = {}): Promise<T> {
		const res = await fetch(`${this.url}${path}`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify(body),
			...init,
		});
		const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
		if (res.status === 401 && json.code === "not_paired") {
			this.forget();
			throw new LeuriaNotConnectedError();
		}
		if (!res.ok) throw new Error(json.error ?? `Leuria request failed: ${res.status}`);
		return json;
	}
}

export class BridgeSession {
	/** `starting` until the agent is up; `idle` between turns. */
	status: "starting" | "idle" | "running" | "ended" = "starting";
	private readonly listeners = new Set<(event: BridgeEvent) => void>();
	private channel: WebSocket | null = null;
	private stream: AbortController | null = null;
	/** Chunks of the current turn already delivered, to skip them on replay. */
	private turnChunks = 0;
	private replaySkip = 0;

	/** @internal */
	constructor(
		private readonly client: BridgeClient,
		readonly id: string,
	) {}

	/** Subscribe to session events; returns the unsubscribe function. */
	onEvent(listener: (event: BridgeEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.off(listener);
	}

	off(listener: (event: BridgeEvent) => void): void {
		this.listeners.delete(listener);
	}

	/** Follow-up prompt on an idle session; the agent keeps its context. */
	async prompt(text: string, attachments?: BridgeAttachment[]): Promise<void> {
		this.status = "running";
		await this.client.post(`/session/${this.id}/prompt`, { prompt: text, attachments });
	}

	/** Stop the current turn and keep the session. */
	async cancelTurn(): Promise<void> {
		await this.client.post(`/session/${this.id}/cancel-turn`, {});
	}

	/** End the session and stop the agent. Safe during page unload. */
	close(): void {
		if (this.status === "ended") return;
		this.status = "ended";
		this.stream?.abort();
		this.channel?.close();
		void fetch(`${this.client.url}/session/${this.id}/close`, {
			method: "POST",
			headers: this.client.headers(),
			body: "{}",
			keepalive: true,
		}).catch(() => undefined);
	}

	/** Read through a getter: `status` changes while we await. Also true once the engine ended it. */
	get ended(): boolean {
		return this.status === "ended";
	}

	/** @internal Open the event stream; resolves once it is connected. */
	async subscribe(): Promise<void> {
		const body = await this.openStream();
		void this.read(body);
	}

	private async openStream(): Promise<ReadableStream<Uint8Array>> {
		const controller = new AbortController();
		this.stream = controller;
		const res = await fetch(`${this.client.url}/session/${this.id}/stream`, {
			headers: this.client.headers(false),
			signal: controller.signal,
		});
		if (!res.ok || !res.body) throw new Error(`Could not open the event stream: ${res.status}`);
		return res.body;
	}

	private async read(body: ReadableStream<Uint8Array>): Promise<void> {
		for (let attempt = 0; ; attempt++) {
			try {
				await this.consume(body);
			} catch {
				// dropped; reconnect below
			}
			if (this.status === "ended") return;
			// The stream dropped without a terminal event: reconnect. The engine
			// replays the current turn's chunks, which we skip.
			if (attempt >= RECONNECT_ATTEMPTS) break;
			await sleep(Math.min(500 * 2 ** attempt, 8000));
			if (this.ended) return;
			try {
				this.replaySkip = this.turnChunks;
				body = await this.openStream();
				attempt = -1;
			} catch {
				// engine unreachable; try again
			}
		}
		this.status = "ended";
		this.emit({ type: "failed", error: "Lost the connection to Leuria." });
	}

	private async consume(body: ReadableStream<Uint8Array>): Promise<void> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		for (;;) {
			const { value, done } = await reader.read();
			if (done) return;
			buffer += decoder.decode(value, { stream: true });
			let index: number;
			while ((index = buffer.indexOf("\n\n")) >= 0) {
				const block = buffer.slice(0, index);
				buffer = buffer.slice(index + 2);
				const name = /^event: (.*)$/m.exec(block)?.[1];
				const data = /^data: (.*)$/m.exec(block)?.[1];
				if (name) this.dispatch(name, data ? (JSON.parse(data) as unknown) : null);
			}
		}
	}

	private dispatch(name: string, data: unknown): void {
		let event: BridgeEvent | null = null;
		switch (name) {
			case "ready":
				if (this.status === "starting") this.status = "idle";
				event = { type: "ready" };
				break;
			case "turn_start":
				this.turnChunks = 0;
				this.replaySkip = 0;
				event = { type: "turn_start" };
				break;
			case "chunk":
				if (this.replaySkip > 0) {
					this.replaySkip--;
					return;
				}
				this.turnChunks++;
				event = { type: "chunk", text: String(data) };
				break;
			case "thought":
				event = { type: "thought", text: String(data) };
				break;
			case "tool_call":
				event = { type: "tool_call", ...(data as Omit<Extract<BridgeEvent, { type: "tool_call" }>, "type">) };
				break;
			case "permission":
				event = { type: "permission", ...(data as { toolName: string; allow: boolean }) };
				break;
			case "log":
				event = { type: "log", text: String(data) };
				break;
			case "turn_completed":
				this.status = "idle";
				this.turnChunks = 0;
				event = { type: "turn_completed", ...(data as { text: string; durationMs: number }) };
				break;
			case "completed":
			case "cancelled":
				event = { type: name };
				break;
			case "failed":
				event = { type: "failed", error: String(data) };
				break;
		}
		if (!event) return;
		if (event.type === "completed" || event.type === "cancelled" || event.type === "failed") {
			this.status = "ended";
			this.stream?.abort();
			this.channel?.close();
		}
		this.emit(event);
	}

	private emit(event: BridgeEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (error) {
				console.error("[leuria] event listener failed", error);
			}
		}
	}

	/**
	 * @internal Two-step WebMCP handshake, then answer the agent's tool
	 * calls. If the channel drops mid-session, it reconnects with the same
	 * channel token and declares the tools again.
	 */
	async connectTools(registrationToken: string, tools: BridgeTool[]): Promise<void> {
		const { server } = JSON.parse(atob(registrationToken)) as { server: string };
		const channel = await register(server, registrationToken);
		const url = `${server}${channel.path}?token=${encodeURIComponent(channel.token)}`;
		await this.openChannel(url, tools);
	}

	private openChannel(url: string, tools: BridgeTool[], attempt = 0): Promise<void> {
		const byName = new Map(tools.map((t) => [t.name, t]));
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(url);
			let opened = false;
			this.channel = socket;
			socket.onerror = () => {
				if (!opened) reject(new Error("Leuria's tool channel failed."));
			};
			socket.onclose = () => {
				if (!opened || this.status === "ended" || attempt >= RECONNECT_ATTEMPTS) return;
				void sleep(Math.min(500 * 2 ** attempt, 8000)).then(() => {
					if (this.status !== "ended") this.openChannel(url, tools, attempt + 1).catch(() => undefined);
				});
			};
			socket.onopen = () => {
				opened = true;
				attempt = 0;
				for (const tool of tools) {
					socket.send(
						JSON.stringify({
							type: "registerTool",
							name: tool.name,
							description: tool.description,
							inputSchema: tool.inputSchema,
						}),
					);
				}
				resolve();
			};
			socket.onmessage = (event) => {
				const call = JSON.parse(String(event.data)) as {
					type: string;
					id?: string;
					tool?: string;
					arguments?: Record<string, unknown>;
				};
				if (call.type === "ping") {
					socket.send(JSON.stringify({ type: "pong" }));
					return;
				}
				if (call.type !== "callTool" || !call.id) return;
				const respond = (body: { result?: unknown; error?: string }) => {
					// The answer goes on the current socket, which may have been replaced.
					const current = this.channel ?? socket;
					if (current.readyState === WebSocket.OPEN) {
						current.send(JSON.stringify({ type: "toolResponse", id: call.id, ...body }));
					}
				};
				const tool = call.tool ? byName.get(call.tool) : undefined;
				if (!tool) {
					respond({ error: `Unknown tool: ${String(call.tool)}` });
					return;
				}
				Promise.resolve()
					.then(() => tool.handler(call.arguments ?? {}))
					.then((result) => respond({ result: result ?? null }))
					.catch((error: unknown) => respond({ error: error instanceof Error ? error.message : String(error) }));
			};
		});
	}
}

const RECONNECT_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exchange the one-time registration token for a channel path and token. */
function register(server: string, registrationToken: string): Promise<{ path: string; token: string }> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(`${server}/webmcp/register`);
		socket.onerror = () => reject(new Error("Could not reach Leuria's tool relay."));
		socket.onopen = () => socket.send(JSON.stringify({ type: "register", token: registrationToken }));
		socket.onmessage = (e) => {
			const msg = JSON.parse(String(e.data)) as { type: string; channel?: string; token?: string; message?: string };
			socket.close();
			if (msg.type !== "registerSuccess" || !msg.channel || !msg.token) {
				reject(new Error(msg.message ?? "Tool registration failed."));
				return;
			}
			resolve({ path: msg.channel, token: msg.token });
		};
	});
}

function defaultStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
	try {
		if (typeof localStorage !== "undefined") {
			const probe = "leuria:probe";
			localStorage.setItem(probe, "1");
			localStorage.removeItem(probe);
			return localStorage;
		}
	} catch {
		// blocked storage (private mode, sandboxed iframe)
	}
	const memory = new Map<string, string>();
	return {
		getItem: (key) => memory.get(key) ?? null,
		setItem: (key, value) => void memory.set(key, value),
		removeItem: (key) => void memory.delete(key),
	};
}
