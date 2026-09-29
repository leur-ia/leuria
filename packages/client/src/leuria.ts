/**
 * `createLeuria()`: one API for AI features, served by the best provider
 * available to this visitor.
 *
 *   const ai = createLeuria({ providers: [bridge(), browserAI(), server({ url: "/api/ai" })] })
 *   const text = await ai.chat({ prompt: "Summarize this page", system }).text()
 *
 * Providers are tried in the order given. A request goes to the first
 * provider that is ready and has the capabilities it needs (tools,
 * structured output). The page never needs to know which one answered,
 * but can: every run starts with a `start` event naming it.
 */

import {
	Conversation,
	type ConversationHooks,
	type ConversationOptions,
	type Requirements,
	type RoutingOptions,
	type SendOptions,
} from "./conversation.js";
import { NoProviderError } from "./errors.js";
import { toMessage } from "./messages.js";
import type { ChatRun } from "./run.js";
import type {
	Capability,
	ChatEvent,
	EmbedResult,
	MessageInput,
	Provider,
	ProviderInfo,
	ProviderState,
	Service,
	ToolMiddleware,
} from "./types.js";

export interface LeuriaOptions {
	/** Providers in order of preference. */
	providers: Provider[];
	/**
	 * Detect providers at creation, again when the page regains focus (the
	 * visitor may have started the engine meanwhile), and every `watchMs`
	 * while the page is visible. Default true.
	 */
	autoDetect?: boolean;
	/**
	 * While the page is visible, look again this often (ms) so it follows
	 * what the visitor does in Leuria: disconnecting the site, changing its
	 * AI or model. Cheap: one local request per provider. 0 turns it off.
	 * Default 5000.
	 */
	watchMs?: number;
	/**
	 * Wrap every tool call of every conversation: observe, redact, block.
	 * Runs before each conversation's own middleware.
	 */
	middleware?: ToolMiddleware[];
	/** End provider sessions when the page goes away. Default true. */
	closeOnUnload?: boolean;
	/**
	 * When the visitor's own AI (`bridge()`) isn't ready: `ask` (default)
	 * proposes it first, and the providers after it answer only once the
	 * visitor picks one (`ai.chooseInstead(id)`, for this page only); `auto`
	 * uses them at once. A site that doesn't want to propose Leuria doesn't
	 * declare `bridge()`.
	 */
	fallback?: "ask" | "auto";
}

export interface ChatRequest<T = unknown>
	extends Omit<ConversationOptions<T>, "messages">,
		Omit<SendOptions, "timeoutMs"> {
	/** The conversation so far; the last message must be the user's. */
	messages?: MessageInput[];
	/** Shorthand for a single user message. */
	prompt?: string;
}

export type ProviderSnapshot = ProviderInfo & ProviderState & { offers: readonly Service[] };

export interface LeuriaState {
	providers: ProviderSnapshot[];
	/** The provider a plain chat request would use now. */
	active?: ProviderInfo;
	/**
	 * A provider that needs a visitor action (connect, download) and is
	 * preferred over the active one (or none is ready): offer it, even
	 * while a fallback answers, so the visitor can bring their own AI back.
	 */
	pending?: ProviderSnapshot;
	/** The provider and model `embed()` would use now. An index built with another model must be rebuilt. */
	embedder?: ProviderInfo & { model: string };
	/** Like `pending`, for embeddings: an embedder ahead of the current one that needs a visitor action. */
	embedPending?: ProviderSnapshot;
	/**
	 * Chat providers waiting for the visitor to pick them instead of their
	 * own AI (see `fallback`), in order: ready ones, and ones a click would
	 * make ready (a download). Offer them as secondary choices.
	 */
	alternatives: ProviderSnapshot[];
	/**
	 * What the page's open conversations need from an AI for full answers
	 * (`tools`). An AI without it answers with less, or not at all: compare
	 * with a provider's `capabilities` to say so.
	 */
	needs: Capability[];
}

export interface EmbedOptions {
	/** `query` for what the visitor searches, `document` (default) for what is searched. */
	kind?: "query" | "document";
	/** Only providers that keep data on this device. */
	localOnly?: boolean;
	/** Only this provider (or these, in order). */
	provider?: string | string[];
	signal?: AbortSignal;
}

export interface EmbedResponse extends EmbedResult {
	provider: ProviderInfo;
}

const offersOf = (p: Provider): readonly Service[] => p.offers ?? ["chat"];

export class Leuria {
	readonly providers: Provider[];
	private state: LeuriaState;
	private readonly listeners = new Set<() => void>();
	private readonly cleanups: Array<() => void> = [];
	private readonly eventListeners = new Set<(event: ChatEvent) => void>();
	private readonly conversations = new Set<Conversation<never>>();
	private readonly hooks: ConversationHooks;
	private readonly fallback: "ask" | "auto";
	/** Providers the visitor picked instead of their own AI, for this page only. */
	private readonly chosen = new Set<string>();

	constructor(options: LeuriaOptions) {
		const ids = new Set<string>();
		for (const p of options.providers) {
			if (ids.has(p.id)) throw new Error(`Duplicate provider id: ${p.id}`);
			ids.add(p.id);
		}
		this.providers = options.providers;
		this.fallback = options.fallback ?? "ask";
		this.hooks = {
			middleware: options.middleware,
			onEvent: (event) => {
				for (const listener of this.eventListeners) {
					try {
						listener(event);
					} catch (error) {
						console.error("[leuria] event listener failed", error);
					}
				}
			},
			onClose: (conversation) => {
				this.conversations.delete(conversation);
				this.refresh();
			},
		};
		this.state = this.snapshot();
		for (const provider of this.providers) {
			this.cleanups.push(provider.onChange(() => this.refresh()));
		}
		if (options.autoDetect !== false) {
			void this.detect();
			if (typeof window !== "undefined") {
				const onFocus = () => void this.detect();
				window.addEventListener("focus", onFocus);
				this.cleanups.push(() => window.removeEventListener("focus", onFocus));
				const watchMs = options.watchMs ?? 5000;
				if (watchMs > 0 && typeof document !== "undefined") {
					const timer = setInterval(() => {
						if (document.visibilityState === "visible") void this.detect();
					}, watchMs);
					const onVisible = () => {
						if (document.visibilityState === "visible") void this.detect();
					};
					document.addEventListener("visibilitychange", onVisible);
					this.cleanups.push(() => {
						clearInterval(timer);
						document.removeEventListener("visibilitychange", onVisible);
					});
				}
			}
		}
		if (options.closeOnUnload !== false && typeof window !== "undefined") {
			const onHide = () => this.closeAll();
			window.addEventListener("pagehide", onHide);
			this.cleanups.push(() => window.removeEventListener("pagehide", onHide));
		}
	}

	/** Every event of every conversation and chat, e.g. for tracing or evals. */
	on(listener: (event: ChatEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	/** End every provider session (agents stop); histories are kept. */
	closeAll(): void {
		for (const conversation of [...this.conversations]) conversation.close();
	}

	getState = (): LeuriaState => this.state;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/** Re-check every provider. */
	async detect(): Promise<LeuriaState> {
		await Promise.all(this.providers.map((p) => p.detect().catch(() => undefined)));
		return this.state;
	}

	/**
	 * The visitor picked this provider instead of their own AI (see
	 * `fallback`). Kept for this page only: their own AI is proposed again
	 * next time. A provider that needs a download is then downloaded with
	 * `connect(id)`, from the same click.
	 */
	chooseInstead(providerId: string): void {
		if (!this.providers.some((p) => p.id === providerId)) throw new Error(`Unknown provider: ${providerId}`);
		this.chosen.add(providerId);
		this.refresh();
	}

	/**
	 * Chat providers that wait for the visitor's pick: those after the first
	 * `asksFirst` provider while it isn't ready.
	 */
	private waiting(): Set<string> {
		const waiting = new Set<string>();
		if (this.fallback === "auto") return waiting;
		const chat = this.providers.filter((p) => offersOf(p).includes("chat"));
		const first = chat.findIndex((p) => p.asksFirst);
		if (first < 0 || chat[first]!.getState().status === "ready") return waiting;
		for (const p of chat.slice(first + 1)) if (!this.chosen.has(p.id)) waiting.add(p.id);
		return waiting;
	}

	/**
	 * Resolve the visitor action of a provider (default: the first one
	 * that needs one). Call from a click: it may open a window.
	 */
	async connect(providerId?: string): Promise<void> {
		const provider = providerId
			? this.providers.find((p) => p.id === providerId)
			: this.providers.find((p) => offersOf(p).includes("chat") && p.getState().status === "needs-action" && p.connect);
		if (!provider?.connect) throw new Error(providerId ? `Provider ${providerId} has nothing to connect.` : "Nothing to connect.");
		await provider.connect();
	}

	/** Forget the visitor's grants in this browser. */
	disconnect(providerId?: string): void {
		for (const provider of this.providers) {
			if (!providerId || provider.id === providerId) provider.disconnect?.();
		}
	}

	/** One request. Iterate the run for events, or await `.text()` / `.object()`. */
	chat<T = unknown>(request: ChatRequest<T>): ChatRun<T> {
		const { messages = [], prompt, signal, context, ...options } = request;
		const inputs = [...messages, ...(prompt !== undefined ? [prompt] : [])];
		const lastInput = inputs[inputs.length - 1];
		if (lastInput === undefined || toMessage(lastInput).role !== "user") {
			throw new Error("chat() needs a prompt or a last message from the user.");
		}
		const conversation = this.conversation<T>({ ...options, messages: inputs.slice(0, -1) });
		const run = conversation.send(lastInput, { signal, context, timeoutMs: options.timeoutMs });
		// A one-shot request does not keep its provider session.
		void run.result().finally(() => conversation.close()).catch(() => undefined);
		return run;
	}

	/**
	 * Embed texts with the first ready provider that can (the visitor's
	 * own model through Leuria, then a model in the page…). Vectors from
	 * different models can't be compared: keep `model` with them.
	 */
	async embed(texts: string[], options: EmbedOptions = {}): Promise<EmbedResponse> {
		const allowed = options.provider === undefined ? undefined : [options.provider].flat();
		const candidates = allowed
			? allowed.map((id) => this.providers.find((p) => p.id === id)).filter((p): p is Provider => Boolean(p))
			: this.providers.filter((p) => offersOf(p).includes("embed"));
		const reasons: NoProviderError["reasons"] = [];
		for (const provider of candidates) {
			const state = provider.getState();
			let reason: string | null = null;
			if (options.localOnly && provider.locality !== "device") reason = "does not keep data on this device";
			else if (state.status !== "ready") reason = state.detail ?? state.status;
			else if (!provider.embed || !state.capabilities.includes("embed")) reason = "cannot embed";
			if (reason) {
				reasons.push({ id: provider.id, label: provider.label, state, reason });
				continue;
			}
			const result = await provider.embed!({ texts, kind: options.kind ?? "document", signal: options.signal });
			return { ...result, provider: { id: provider.id, label: provider.label, locality: provider.locality } };
		}
		throw new NoProviderError(["embed"], reasons);
	}

	/** A multi-turn conversation that keeps its history and follows the cascade. */
	conversation<T = unknown>(options: ConversationOptions<T> = {}): Conversation<T> {
		const conversation = new Conversation<T>(this.select, options, this.hooks);
		this.conversations.add(conversation as unknown as Conversation<never>);
		// Later, not now: a conversation is often created while a UI renders.
		if (conversation.needs.length) queueMicrotask(() => this.refresh());
		return conversation;
	}

	/**
	 * The provider that would serve a request with these needs, or a
	 * {@link NoProviderError} explaining why none can.
	 */
	select = (requirements: Requirements, routing: RoutingOptions = {}): Provider => {
		const needs: Capability[] = ["chat"];
		if (requirements.tools) needs.push("tools");
		if (requirements.images) needs.push("images");
		const allowed = routing.provider === undefined ? undefined : [routing.provider].flat();
		const candidates = allowed
			? allowed.map((id) => this.providers.find((p) => p.id === id)).filter((p): p is Provider => Boolean(p))
			: this.providers.filter((p) => offersOf(p).includes("chat"));

		const reasons: NoProviderError["reasons"] = [];
		// Only the cascade waits for the visitor's pick: a provider named in `routing.provider` is the site's own choice.
		const waiting = allowed ? new Set<string>() : this.waiting();
		const choices: string[] = [];
		for (const provider of candidates) {
			const state = provider.getState();
			const caps = new Set(state.capabilities);
			let reason: string | null = null;
			if (waiting.has(provider.id)) {
				reason = "waits for the visitor to choose it";
				choices.push(provider.id);
			} else if (routing.localOnly && provider.locality !== "device") reason = "does not keep data on this device";
			else if (state.status !== "ready") reason = state.detail ?? state.status;
			else if (!needs.every((n) => caps.has(n))) reason = `cannot ${needs.filter((n) => !caps.has(n)).join(", ")}`;
			else if (requirements.schema && !caps.has("structured") && !caps.has("tools")) reason = "cannot return structured output";
			if (!reason) return provider;
			reasons.push({ id: provider.id, label: provider.label, state, reason });
		}
		throw new NoProviderError(requirements.schema ? [...needs, "structured"] : needs, reasons, choices);
	};

	/** Stop watching providers. */
	destroy(): void {
		this.closeAll();
		for (const cleanup of this.cleanups.splice(0)) cleanup();
		this.listeners.clear();
		this.eventListeners.clear();
	}

	private refresh(): void {
		this.state = this.snapshot();
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (error) {
				console.error("[leuria] state listener failed", error);
			}
		}
	}

	private snapshot(): LeuriaState {
		const providers = this.providers.map((p) => ({ id: p.id, label: p.label, locality: p.locality, offers: offersOf(p), ...p.getState() }));
		const waiting = this.waiting();
		// Providers are in order of preference: only one ahead of the one in use is worth an action.
		const pick = (serves: Service, ready: (p: ProviderSnapshot) => boolean) => {
			const candidates = providers.filter((p) => p.offers.includes(serves));
			const index = candidates.findIndex(ready);
			const found = index >= 0 ? candidates[index] : undefined;
			const ahead = found ? candidates.slice(0, index) : candidates;
			return { found, pending: ahead.find((p) => p.status === "needs-action") };
		};
		const chat = pick("chat", (p) => p.status === "ready" && !waiting.has(p.id));
		const embed = pick("embed", (p) => p.status === "ready" && p.capabilities.includes("embed") && Boolean(p.embedModel));
		const info = (p: ProviderSnapshot): ProviderInfo => ({ id: p.id, label: p.label, locality: p.locality });
		return {
			providers,
			active: chat.found ? info(chat.found) : undefined,
			pending: chat.pending,
			embedder: embed.found ? { ...info(embed.found), model: embed.found.embedModel! } : undefined,
			embedPending: embed.pending,
			alternatives: providers.filter((p) => waiting.has(p.id) && (p.status === "ready" || (p.status === "needs-action" && p.action === "download"))),
			needs: [...new Set([...(this.conversations ?? [])].flatMap((c) => c.needs))],
		};
	}
}

export function createLeuria(options: LeuriaOptions): Leuria {
	return new Leuria(options);
}
