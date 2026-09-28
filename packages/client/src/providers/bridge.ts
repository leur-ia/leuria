/**
 * The visitor's Leuria engine: their own agent (Claude Code today),
 * running page tools over WebMCP. The agent keeps the conversation's
 * context between turns, so each turn only sends the new message.
 */

import {
	type BridgeAttachment,
	BridgeClient,
	type BridgeClientOptions,
	type BridgeEvent,
	type BridgeSession,
	LeuriaNotRunningError,
} from "../bridge/transport.js";
import { AbortError } from "../errors.js";
import { fileText, messageFiles, messageText, parseDataUrl, transcript } from "../messages.js";
import type { EmbedRequest, EmbedResult, Message, ProviderSession, SessionOptions, TurnContext } from "../types.js";
import { BaseProvider } from "./base.js";

export interface BridgeProviderOptions extends BridgeClientOptions {
	/** Provider id, default `bridge`. */
	id?: string;
}

/** How long a cancelled turn may take to wind down before the session is dropped. */
const CANCEL_GRACE_MS = 10_000;
const CAPABILITIES = ["chat", "tools", "agent", "images"] as const;
/** The engine takes at most this many texts per request. */
const EMBED_BATCH = 256;

export class BridgeProvider extends BaseProvider {
	readonly client: BridgeClient;
	readonly offers = ["chat", "embed"] as const;
	/** The visitor's own AI: proposed first (see `LeuriaOptions.fallback`). */
	readonly asksFirst = true;
	/** The last connect got no answer from Leuria (yet): say it isn't running until it does. */
	private unreached = false;
	private attempt?: AbortController;

	constructor(options: BridgeProviderOptions = {}) {
		super(options.id ?? "bridge", "Your AI (Leuria)", "device", { status: "unknown", capabilities: [] });
		this.client = new BridgeClient(options);
	}

	async detect(): Promise<void> {
		const { status, agent, embed } = await this.client.detect();
		if (status === "offline" || (status === "unpaired" && this.unreached)) {
			this.setState({ status: "unavailable", capabilities: [], model: undefined, embedModel: undefined, action: undefined, detail: "Leuria is not running" });
		} else if (status === "unpaired") {
			// Maybe Leuria is here, maybe not: only a connect can tell.
			this.setState({
				status: "needs-action",
				action: "connect",
				capabilities: [...CAPABILITIES],
				model: undefined,
				embedModel: undefined,
				detail: "This site is not connected to Leuria",
			});
		} else {
			this.setState({
				status: "ready",
				action: undefined,
				capabilities: embed ? [...CAPABILITIES, "embed"] : [...CAPABILITIES],
				model: agent,
				embedModel: embed,
				detail: undefined,
			});
		}
	}

	/**
	 * Open Leuria and wait for the visitor's answer. When Leuria doesn't
	 * answer within a few seconds, the provider says it isn't running (the
	 * UI offers to get it) and keeps waiting: an app that starts late, or
	 * is installed meanwhile, still connects. A new call replaces the last.
	 */
	async connect(): Promise<void> {
		this.attempt?.abort();
		const attempt = new AbortController();
		this.attempt = attempt;
		this.unreached = false;
		// Leuria didn't answer last time: this attempt may reach it, so stop saying it isn't running.
		if (this.getState().status === "unavailable") {
			this.setState({ status: "needs-action", action: "connect", capabilities: [...CAPABILITIES], detail: "This site is not connected to Leuria" });
		}
		try {
			await this.client.connect({
				signal: attempt.signal,
				onUnreached: () => {
					this.unreached = true;
					void this.detect();
				},
			});
			this.unreached = false;
		} catch (error) {
			if (this.attempt === attempt) this.unreached = error instanceof LeuriaNotRunningError;
			throw error;
		} finally {
			if (this.attempt === attempt) this.attempt = undefined;
			await this.detect();
		}
	}

	disconnect(): void {
		this.client.forget();
		void this.detect();
	}

	/** Open Leuria on this site's settings: the visitor changes its AI and model there. */
	manage(): void {
		this.client.manage();
	}

	async embed({ texts, kind, signal }: EmbedRequest): Promise<EmbedResult> {
		const vectors: number[][] = [];
		let model = this.getState().embedModel ?? "";
		try {
			for (let i = 0; i < texts.length; i += EMBED_BATCH) {
				const result = await this.client.embed(texts.slice(i, i + EMBED_BATCH), kind, signal);
				// A model switched mid-way would mix vectors that can't be compared.
				if (i > 0 && result.model !== model) throw new Error("The embedding model changed; embed again.");
				model = result.model;
				vectors.push(...result.vectors);
			}
		} catch (error) {
			// The model may have been unloaded, or the site disconnected: look again.
			void this.detect();
			throw error;
		}
		return { vectors, model };
	}

	async createSession(options: SessionOptions): Promise<ProviderSession> {
		return new BridgeProviderSession(this, options);
	}

	/** @internal The engine said this site is not connected. */
	lostConnection(): void {
		void this.detect();
	}
}

interface PendingTurn {
	resolve: (value: { text: string }) => void;
	reject: (error: Error) => void;
	text: string;
}

class BridgeProviderSession implements ProviderSession {
	private session: BridgeSession | null = null;
	private starting: Promise<BridgeSession> | null = null;
	/** Resolves when a warm (prompt-less) session reports `ready`. */
	private ready: Promise<void> | null = null;
	private context: TurnContext | null = null;
	private turn: PendingTurn | null = null;
	/** The history has been handed to the agent. */
	private primed = false;

	constructor(
		private readonly provider: BridgeProvider,
		private readonly options: SessionOptions,
	) {}

	async warm(): Promise<void> {
		await this.start();
		await this.ready;
	}

	/** The engine ended the session (the AI or model changed, the site was disconnected). */
	get closed(): boolean {
		return this.session?.ended ?? false;
	}

	async send(message: Message, context: TurnContext): Promise<{ text: string }> {
		this.context = context;
		const done = new Promise<{ text: string }>((resolve, reject) => {
			this.turn = { resolve, reject, text: "" };
		});
		let cancelTimer: ReturnType<typeof setTimeout> | undefined;
		const onAbort = () => {
			void this.session?.cancelTurn().catch(() => undefined);
			// An agent that ignores the cancel loses its session.
			cancelTimer = setTimeout(() => {
				this.turn?.reject(new AbortError());
				this.close();
			}, CANCEL_GRACE_MS);
		};
		context.signal.addEventListener("abort", onAbort, { once: true });
		try {
			const text = this.primed ? messageText(message) : this.firstPrompt(message);
			const attachments = toAttachments(message);
			if (!this.session && !this.starting) {
				context.status(`Starting ${this.provider.getState().model ?? "your agent"}…`);
				this.primed = true;
				await this.start(text, attachments);
			} else {
				const session = await this.start();
				await this.ready;
				this.primed = true;
				if (context.signal.aborted) throw new AbortError();
				await session.prompt(text, attachments);
			}
			return await done;
		} finally {
			clearTimeout(cancelTimer);
			context.signal.removeEventListener("abort", onAbort);
			this.turn = null;
		}
	}

	close(): void {
		this.session?.close();
		this.session = null;
		this.starting = null;
	}

	/** Start the agent session once; with `prompt`, its first turn starts at once. */
	private start(prompt?: string, attachments?: BridgeAttachment[]): Promise<BridgeSession> {
		if (this.session) return Promise.resolve(this.session);
		if (this.starting) return this.starting;
		let markReady: () => void = () => undefined;
		this.ready = prompt ? Promise.resolve() : new Promise<void>((resolve) => (markReady = resolve));
		this.starting = this.provider.client
			.startSession({
				prompt,
				attachments,
				systemPrompt: this.options.system,
				maxTurns: this.options.maxSteps + 2,
				tools: this.options.tools.map((tool) => ({
					...tool,
					handler: async (args) => {
						if (!this.context) throw new Error("No turn is running.");
						const outcome = await this.context.runTool({ name: tool.name, args });
						if (!outcome.ok) throw new Error(outcome.error);
						return outcome.result;
					},
				})),
				onEvent: (event) => {
					if (event.type === "ready") markReady();
					this.onEvent(event);
				},
			})
			.then(
				(session) => {
					this.session = session;
					return session;
				},
				(error: unknown) => {
					this.starting = null;
					markReady();
					if (error instanceof Error && error.name === "LeuriaNotConnectedError") this.provider.lostConnection();
					throw error;
				},
			);
		return this.starting;
	}

	/** A new agent session starts with the conversation so far. */
	private firstPrompt(message: Message): string {
		const text = messageText(message);
		return this.options.history.length ? `${transcript(this.options.history)}\n\nUser: ${text}` : text;
	}

	private onEvent(event: BridgeEvent): void {
		const turn = this.turn;
		switch (event.type) {
			case "chunk":
				if (turn) turn.text += event.text;
				this.context?.text(event.text);
				break;
			case "thought":
				this.context?.reasoning(event.text);
				break;
			case "turn_completed":
				turn?.resolve({ text: turn.text });
				break;
			case "failed":
				this.session = null;
				this.starting = null;
				turn?.reject(new Error(event.error));
				break;
			case "completed":
			case "cancelled":
				this.session = null;
				this.starting = null;
				if (this.context?.signal.aborted) turn?.reject(new AbortError());
				else turn?.reject(new Error("The agent session ended."));
				break;
		}
	}
}

/** Files of a user message, in the engine's attachment format. */
function toAttachments(message: Message): BridgeAttachment[] {
	const attachments: BridgeAttachment[] = [];
	for (const file of messageFiles(message)) {
		const parsed = parseDataUrl(file.url);
		if (file.mediaType.startsWith("image/") && parsed) {
			attachments.push({ type: "image", mimeType: file.mediaType, data: parsed.base64, name: file.filename });
			continue;
		}
		const text = fileText(file);
		if (text !== null) attachments.push({ type: "text", text, name: file.filename, mimeType: file.mediaType });
	}
	return attachments;
}

export function bridge(options: BridgeProviderOptions = {}): BridgeProvider {
	return new BridgeProvider(options);
}
