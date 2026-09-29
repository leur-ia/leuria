/**
 * A conversation: the message history, the page tools, and a provider
 * session that follows the cascade. The history belongs to the page, so
 * the conversation survives a provider switch (the engine connects mid-
 * chat, the browser model finishes downloading…).
 *
 * Turns are queued: `send()` while a turn runs starts the next one when
 * it ends. Each turn has an id carried by all its events, may carry a
 * context the model never sets, may time out on its own, and may be
 * ended by a tool (`ctx.endTurn()`).
 *
 * `getState()` returns an immutable snapshot and `subscribe()` notifies
 * on every change: exactly what `useSyncExternalStore` and the
 * assistant-ui external store runtime expect.
 */

import { AbortError, NoProviderError, TimeoutError, toError } from "./errors.js";
import {
	type ContextFormatter,
	defaultFormatContext,
	messageText,
	newId,
	resolveFiles,
	toMessage,
	withRenderedContext,
} from "./messages.js";
import { ChatRun } from "./run.js";
import { StructuredCollector, SUBMIT_INSTRUCTION, SUBMIT_TOOL } from "./structured.js";
import type {
	Capability,
	ChatEvent,
	ChatEventBody,
	ChatResult,
	JsonSchema,
	Message,
	MessageInput,
	MessagePart,
	Provider,
	ProviderInfo,
	ProviderSession,
	ToolCall,
	ToolDefinition,
	ToolMiddleware,
	ToolOutcome,
	TurnContext,
} from "./types.js";

export interface Requirements {
	tools: boolean;
	schema: boolean;
	images?: boolean;
}

export interface RoutingOptions {
	/** Only these providers, in this order of preference. */
	provider?: string | string[];
	/** Only providers that keep data on the visitor's device. */
	localOnly?: boolean;
}

export interface ConversationOptions<T = unknown> extends RoutingOptions {
	system?: string;
	tools?: ToolDefinition[];
	/** JSON Schema for structured output on every turn. */
	schema?: JsonSchema;
	/** Validate (and type) the structured output; throw to reject it. */
	validate?: (value: unknown) => T;
	/** Most tool calls per turn. Default 10. */
	maxSteps?: number;
	/** Stop a turn that takes longer than this (the session is kept). */
	timeoutMs?: number;
	/** Wrap tool calls: observe, redact, block. Runs after the global middleware. */
	middleware?: ToolMiddleware[];
	/** Render a turn's `context` into the prompt. Default: labeled key/value lines. */
	formatContext?: ContextFormatter;
	/** Messages to start from. */
	messages?: MessageInput[];
	/**
	 * Lets an AI that can't use `tools` answer anyway, with less: when no
	 * AI that can use them is ready, one that can't answers, and what this
	 * returns joins the turn's context (e.g. the passages that match the
	 * question, found by the page). Without it, `tools` are required.
	 */
	withoutTools?: (message: Message, options: { signal: AbortSignal }) => unknown | Promise<unknown>;
}

export interface SendOptions {
	signal?: AbortSignal;
	/**
	 * Values bound to this turn: tools get them as `ctx.context`, and the
	 * model sees them rendered with `formatContext`, apart from the text.
	 */
	context?: unknown;
	/** Overrides the conversation's `timeoutMs` for this turn. */
	timeoutMs?: number;
}

export type ConversationStatus = "idle" | "running" | "error";

export interface PendingInput {
	callId: string;
	turnId: string;
	name: string;
	args: Record<string, unknown>;
}

export interface ConversationState {
	messages: Message[];
	status: ConversationStatus;
	error?: Error;
	/** Provider of the current or last turn. */
	provider?: ProviderInfo;
	/** That provider can't use the conversation's tools: it answered with `withoutTools`'s context instead. */
	limited?: boolean;
	/** Provider session: `starting` while an agent boots, `ready` once it can answer at once. */
	session: "none" | "starting" | "ready";
	/** Turns waiting behind the running one. */
	queued: number;
	/** Tool calls waiting for `submitToolResult`. */
	pendingInputs: PendingInput[];
}

export type SelectProvider = (requirements: Requirements, routing: RoutingOptions) => Provider;

/** Hooks a `Leuria` instance shares with all its conversations. */
export interface ConversationHooks {
	middleware?: ToolMiddleware[];
	onEvent?: (event: ChatEvent) => void;
	onClose?: (conversation: Conversation<never>) => void;
}

const DEFAULT_MAX_STEPS = 10;
/** Marks a turn ended by a tool, as opposed to cancelled. */
const END_TURN = Symbol("endTurn");

interface ActiveSession {
	provider: Provider;
	session: ProviderSession;
	route: "native" | "tool" | null;
}

export class Conversation<T = unknown> {
	private state: ConversationState;
	private readonly listeners = new Set<() => void>();
	private readonly eventListeners = new Set<(event: ChatEvent) => void>();
	private active: ActiveSession | null = null;
	private opening: Promise<ActiveSession> | null = null;
	private readonly runs = new Set<ChatRun<T>>();
	private tail: Promise<unknown> = Promise.resolve();
	private readonly inputs = new Map<string, { resolve: (outcome: ToolOutcome) => void; turnId: string }>();
	private collector: StructuredCollector<T> | null = null;
	private readonly tools: Map<string, ToolDefinition>;
	private readonly format: ContextFormatter;

	constructor(
		private readonly select: SelectProvider,
		private readonly options: ConversationOptions<T> = {},
		private readonly hooks: ConversationHooks = {},
	) {
		this.state = {
			messages: (options.messages ?? []).map(toMessage),
			status: "idle",
			session: "none",
			queued: 0,
			pendingInputs: [],
		};
		this.tools = new Map((options.tools ?? []).map((t) => [t.name, t]));
		if (this.tools.has(SUBMIT_TOOL)) throw new Error(`"${SUBMIT_TOOL}" is a reserved tool name.`);
		this.format = options.formatContext ?? defaultFormatContext;
	}

	getState = (): ConversationState => this.state;

	/** What this conversation's AI must be able to do for full answers (`tools` when it has some). */
	get needs(): Capability[] {
		return this.tools.size > 0 ? ["tools"] : [];
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/** Every event of every turn, e.g. for a trace panel or an eval harness. */
	on(listener: (event: ChatEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	/** Send a user message. Queued behind the running turn, if any. */
	send(input: MessageInput, options: SendOptions = {}): ChatRun<T> {
		const turnId = newId("turn");
		const previous = this.tail;
		const waits = this.runs.size > 0;
		if (waits) this.setState({ queued: this.state.queued + 1 });
		const run: ChatRun<T> = new ChatRun<T>(
			turnId,
			async (emit, signal) => {
				if (waits) {
					await previous.catch(() => undefined);
					this.setState({ queued: Math.max(0, this.state.queued - 1) });
				}
				if (signal.aborted) throw new AbortError();
				return this.turn(turnId, input, options, emit, signal);
			},
			options.signal,
		);
		this.runs.add(run);
		run.on((event) => this.dispatch(event));
		this.tail = run.result().catch(() => undefined);
		void run
			.result()
			.then(
				() => this.runs.size === 1 && this.setState({ status: "idle", error: undefined }),
				(error: unknown) => this.setState({ status: this.runs.size === 1 ? "error" : "running", error: toError(error) }),
			)
			.finally(() => this.runs.delete(run));
		return run;
	}

	/** Answer a tool call that has no `execute` (see `pendingInputs`). */
	submitToolResult(callId: string, result: unknown): void {
		this.settleInput(callId, { ok: true, result: result ?? null });
	}

	/** Refuse a tool call that has no `execute`; the model sees `error`. */
	rejectToolCall(callId: string, error = "The visitor declined."): void {
		this.settleInput(callId, { ok: false, error });
	}

	/**
	 * Open the provider session ahead of the first message, so the first
	 * answer does not pay for an agent start. Resolves false when no
	 * provider is ready.
	 */
	async warm(): Promise<boolean> {
		let provider: Provider;
		try {
			({ provider } = this.pick());
		} catch {
			return false;
		}
		const active = await this.ensureSession(provider, this.state.messages);
		await active.session.warm?.();
		return true;
	}

	/** Cancel the running turn and every queued one. */
	stop(): void {
		for (const run of this.runs) run.abort(new AbortError());
	}

	/** Clear the history and end the provider session. */
	reset(messages: MessageInput[] = []): void {
		this.stop();
		this.endSession();
		this.setState({ messages: messages.map(toMessage), status: "idle", error: undefined, provider: undefined });
	}

	/** End the provider session (e.g. on page unload). The history stays. */
	close(): void {
		this.stop();
		this.endSession();
		this.hooks.onClose?.(this as unknown as Conversation<never>);
	}

	// ── Turn ────────────────────────────────────────────────────────────

	private pick(images = false): { provider: Provider; limited: boolean } {
		const requirements = { tools: this.tools.size > 0, schema: Boolean(this.options.schema), images };
		try {
			return { provider: this.select(requirements, this.options), limited: false };
		} catch (error) {
			// No AI can use the tools: one that can't may answer with less, if the page allows it.
			if (!(error instanceof NoProviderError) || !requirements.tools || !this.options.withoutTools) throw error;
			try {
				return { provider: this.select({ ...requirements, tools: false }, this.options), limited: true };
			} catch {
				throw error;
			}
		}
	}

	private async turn(
		turnId: string,
		input: MessageInput,
		options: SendOptions,
		emit: (event: ChatEventBody) => void,
		runSignal: AbortSignal,
	): Promise<ChatResult<T>> {
		let user = toMessage(input);
		if (options.context !== undefined) user = { ...user, context: options.context };
		user = await resolveFiles(input, user);
		const hasImages = user.parts.some((p) => p.type === "file" && p.mediaType.startsWith("image/"));
		const history = this.state.messages;
		// The visitor's message shows at once, even if no provider can answer.
		this.setState({ messages: [...history, user], status: "running", error: undefined });

		const { provider, limited } = this.pick(hasImages);
		const info: ProviderInfo = { id: provider.id, label: provider.label, locality: provider.locality };
		const assistantId = newId();
		const assistant: Message = {
			id: assistantId,
			role: "assistant",
			parts: [],
			metadata: { turnId, provider: info, startedAt: Date.now(), ...(limited ? { limited: true } : {}) },
		};
		this.setState({ messages: [...this.state.messages, assistant], provider: info, limited });
		emit({ type: "start", provider: info });

		// One signal for the provider: visitor cancel, timeout, or a tool ending the turn.
		const turnAbort = new AbortController();
		const onRunAbort = () => turnAbort.abort(runSignal.reason ?? new AbortError());
		runSignal.addEventListener("abort", onRunAbort, { once: true });
		const timeoutMs = options.timeoutMs ?? this.options.timeoutMs;
		const timer = timeoutMs ? setTimeout(() => turnAbort.abort(new TimeoutError(timeoutMs)), timeoutMs) : undefined;
		let outcome: unknown;
		let settled = false;
		// Once the turn is stopped, late provider output is dropped and UI calls are released.
		const closed = () => settled || turnAbort.signal.aborted;
		turnAbort.signal.addEventListener("abort", () => this.dismissInputs(turnId), { once: true });

		const counts = new Map<string, number>();
		let toolCalls = 0;
		const maxSteps = this.options.maxSteps ?? DEFAULT_MAX_STEPS;
		const context: TurnContext = {
			turnId,
			signal: turnAbort.signal,
			text: (delta) => {
				if (closed() || !delta) return;
				this.appendPart(assistantId, "text", delta);
				emit({ type: "text-delta", text: delta });
			},
			reasoning: (delta) => {
				if (closed() || !delta) return;
				this.appendPart(assistantId, "reasoning", delta);
				emit({ type: "reasoning-delta", text: delta });
			},
			status: (message) => {
				if (!closed()) emit({ type: "status", message });
			},
			runTool: async ({ name, args, callId = newId("call") }) => {
				if (closed()) return { ok: false, error: "The turn has ended." };
				if (name !== SUBMIT_TOOL && ++toolCalls > maxSteps) {
					return { ok: false, error: `Tool budget exhausted (${maxSteps} calls). Answer with what you have.` };
				}
				const callCount = (counts.get(name) ?? 0) + 1;
				counts.set(name, callCount);
				return this.runTool(
					{ callId, turnId, name, args, context: options.context },
					{
						assistantId,
						callCount,
						signal: turnAbort.signal,
						emit,
						endTurn: (value) => {
							outcome = value;
							turnAbort.abort(END_TURN);
						},
					},
				);
			},
		};

		try {
			if (limited) {
				// What the page found for the question stands in for the tools this AI can't use.
				const extra = await this.options.withoutTools!(user, { signal: turnAbort.signal });
				if (extra !== undefined && extra !== null) {
					user = { ...user, context: mergeContext(user.context, extra) };
					this.setState({ messages: this.state.messages.map((m) => (m.id === user.id ? user : m)) });
				}
			}
			let active: ActiveSession;
			try {
				this.setState({ session: this.active?.provider === provider ? this.state.session : "starting" });
				active = await this.ensureSession(provider, history);
			} catch (error) {
				this.setState({ session: "none" });
				throw error;
			}
			this.collector = this.options.schema
				? new StructuredCollector<T>({ schema: this.options.schema, validate: this.options.validate })
				: null;

			let text = "";
			let failure: unknown;
			try {
				({ text } = await active.session.send(withRenderedContext(user, this.format), context));
			} catch (error) {
				failure = error;
			}
			settled = true;
			const reason: unknown = turnAbort.signal.aborted ? turnAbort.signal.reason : undefined;
			if (failure !== undefined && reason !== END_TURN) {
				// A broken session is not reused; the next turn starts fresh.
				this.endSession();
			}
			this.setState({ session: this.active ? "ready" : "none" });
			if (reason === END_TURN) {
				// Ended by a tool: a success, whatever the provider did after the stop.
			} else if (reason instanceof TimeoutError) {
				throw reason;
			} else if (reason !== undefined) {
				throw new AbortError();
			} else if (failure !== undefined) {
				throw failure;
			}

			const message = this.finishAssistant(assistantId, outcome);
			const finalText = messageText(message) || text;
			let object: T | undefined;
			if (this.collector) {
				object =
					reason === END_TURN
						? this.collector.submitted
							? this.collector.value
							: undefined
						: this.collector.fromText(finalText);
			}
			return { text: finalText, object, outcome, message, provider: info };
		} catch (error) {
			this.finishAssistant(assistantId, undefined, true);
			throw error;
		} finally {
			settled = true;
			clearTimeout(timer);
			runSignal.removeEventListener("abort", onRunAbort);
			this.dismissInputs(turnId);
		}
	}

	private async runTool(
		call: ToolCall,
		turn: {
			assistantId: string;
			callCount: number;
			signal: AbortSignal;
			emit: (event: ChatEventBody) => void;
			endTurn: (outcome?: unknown) => void;
		},
	): Promise<ToolOutcome> {
		const { name, args, callId } = call;
		if (name === SUBMIT_TOOL && this.collector) {
			try {
				return { ok: true, result: await this.collector.tool().execute!(args, {} as never) };
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		}

		const tool = this.tools.get(name);
		const interactive = tool !== undefined && tool.execute === undefined;
		this.updateAssistant(turn.assistantId, (parts) => [
			...parts,
			{ type: "tool-call", callId, name, args, state: interactive ? "awaiting-input" : "running" },
		]);
		turn.emit({ type: "tool-call", callId, name, args });

		const execute = async (): Promise<ToolOutcome> => {
			if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
			if (!tool.execute) {
				turn.emit({ type: "tool-input", callId, name, args });
				return this.waitForInput(call);
			}
			try {
				const result = await tool.execute(args, {
					callId,
					turnId: call.turnId,
					context: call.context,
					callCount: turn.callCount,
					endTurn: turn.endTurn,
					signal: turn.signal,
				});
				return { ok: true, result: result ?? null };
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		};

		const middleware = [...(this.hooks.middleware ?? []), ...(this.options.middleware ?? [])];
		const chain = middleware.reduceRight<() => Promise<ToolOutcome>>(
			(next, layer) => () => layer(call, next),
			execute,
		);
		let outcome: ToolOutcome;
		try {
			outcome = await chain();
		} catch (error) {
			outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
		}

		this.updateAssistant(turn.assistantId, (parts) =>
			parts.map((p) =>
				p.type === "tool-call" && p.callId === callId
					? outcome.ok
						? { ...p, state: "done", result: outcome.result }
						: { ...p, state: "error", error: outcome.error }
					: p,
			),
		);
		turn.emit({
			type: "tool-result",
			callId,
			name,
			...(outcome.ok ? { result: outcome.result } : { error: outcome.error }),
		});
		return outcome;
	}

	private waitForInput(call: ToolCall): Promise<ToolOutcome> {
		return new Promise((resolve) => {
			this.inputs.set(call.callId, { resolve, turnId: call.turnId });
			this.setState({
				pendingInputs: [
					...this.state.pendingInputs,
					{ callId: call.callId, turnId: call.turnId, name: call.name, args: call.args },
				],
			});
		});
	}

	private settleInput(callId: string, outcome: ToolOutcome): void {
		const pending = this.inputs.get(callId);
		if (!pending) return;
		this.inputs.delete(callId);
		this.setState({ pendingInputs: this.state.pendingInputs.filter((p) => p.callId !== callId) });
		pending.resolve(outcome);
	}

	/** A turn that ends never leaves a UI call hanging. */
	private dismissInputs(turnId: string): void {
		for (const [callId, pending] of this.inputs) {
			if (pending.turnId === turnId) this.settleInput(callId, { ok: false, error: "Dismissed: the turn ended." });
		}
	}

	// ── Provider session ────────────────────────────────────────────────

	private async ensureSession(provider: Provider, history: Message[]): Promise<ActiveSession> {
		// A session the provider ended (the visitor changed the AI or model) is replaced, history included.
		if (this.active?.provider === provider && this.active.session.closed) this.endSession();
		if (this.active?.provider === provider) return this.active;
		if (this.opening) {
			const opened = await this.opening.catch(() => null);
			if (opened?.provider === provider) return opened;
		}
		this.endSession();
		this.opening = this.openSession(provider, history);
		try {
			this.active = await this.opening;
			return this.active;
		} finally {
			this.opening = null;
		}
	}

	private async openSession(provider: Provider, history: Message[]): Promise<ActiveSession> {
		const { schema, system } = this.options;
		const caps: Capability[] = provider.getState().capabilities;
		const route = !schema ? null : caps.includes("structured") ? "native" : "tool";
		// An AI that can't use tools gets none (it answers with `withoutTools`'s context).
		const tools = caps.includes("tools") ? [...this.tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) : [];
		if (route === "tool") {
			// Descriptor only: execution goes through runTool and the turn's collector.
			const { name, description, inputSchema } = new StructuredCollector({ schema: schema! }).tool();
			tools.push({ name, description, inputSchema });
		}
		this.setState({ session: "starting" });
		const session = await provider.createSession({
			system: [system, route === "tool" ? SUBMIT_INSTRUCTION : undefined].filter(Boolean).join("\n\n") || undefined,
			tools,
			schema: route === "native" ? schema : undefined,
			history: history.map((m) => withRenderedContext(m, this.format)),
			maxSteps: this.options.maxSteps ?? DEFAULT_MAX_STEPS,
		});
		this.setState({ session: "ready" });
		return { provider, session, route };
	}

	private endSession(): void {
		try {
			this.active?.session.close();
		} catch {
			// already closed
		}
		this.active = null;
		if (this.state.session !== "none") this.setState({ session: "none" });
	}

	// ── State ───────────────────────────────────────────────────────────

	private dispatch(event: ChatEvent): void {
		for (const listener of this.eventListeners) {
			try {
				listener(event);
			} catch (error) {
				console.error("[leuria] event listener failed", error);
			}
		}
		this.hooks.onEvent?.(event);
	}

	private appendPart(id: string, type: "text" | "reasoning", delta: string): void {
		this.updateAssistant(id, (parts) => {
			const last = parts[parts.length - 1];
			return last?.type === type
				? [...parts.slice(0, -1), { type, text: last.text + delta }]
				: [...parts, { type, text: delta }];
		});
	}

	/** Stamp the end of the turn; drop the message when it has no content and the turn failed. */
	private finishAssistant(id: string, outcome: unknown, failed = false): Message {
		const messages = this.state.messages
			.filter((m) => !(failed && m.id === id && m.parts.length === 0))
			.map((m) =>
				m.id === id && m.metadata
					? { ...m, metadata: { ...m.metadata, finishedAt: Date.now(), ...(outcome !== undefined ? { outcome } : {}) } }
					: m,
			);
		this.setState({ messages });
		return messages.find((m) => m.id === id) ?? { id, role: "assistant", parts: [] };
	}

	private updateAssistant(id: string, update: (parts: MessagePart[]) => MessagePart[]): void {
		this.setState({
			messages: this.state.messages.map((m) => (m.id === id ? { ...m, parts: update(m.parts) } : m)),
		});
	}

	private setState(patch: Partial<ConversationState>): void {
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (error) {
				console.error("[leuria] conversation listener failed", error);
			}
		}
	}
}

/** A turn's own context and what `withoutTools` found: one object when both are objects. */
function mergeContext(context: unknown, extra: unknown): unknown {
	if (context === undefined || context === null) return extra;
	const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
	return { ...(isRecord(context) ? context : { Context: context }), ...(isRecord(extra) ? extra : { "Found on the page": extra }) };
}
