/**
 * `LanguageModel`, the Prompt API's interface, over a Leuria provider: by
 * default the visitor's own AI through the Leuria app.
 *
 * How the spec maps onto Leuria:
 * - `availability()`: "available" once the site is connected,
 *   "downloadable" while it isn't (connecting is the "download": it needs
 *   a click, like a model download), "unavailable" without Leuria.
 * - `create()` from a click connects the site, reporting `downloadprogress`
 *   0 then 1. The AI session itself starts with the first prompt.
 * - Each `LanguageModel` is one session of the visitor's AI, which keeps
 *   the context: a prompt sends only what's new.
 * - `tools` run in the page, called by the visitor's AI.
 * - `responseConstraint` is given to the AI as an instruction and checked
 *   here; a mismatch goes back to the AI to fix.
 * - Token counts are estimates (about 4 characters per token).
 */

import {
	type BridgeProviderOptions,
	leuria,
	type Message,
	messageText,
	newId,
	type Provider,
	type ProviderSession,
	type TurnContext,
} from "@leuria/client";
import { checkAnswer, constraintInstruction, type ResponseConstraint } from "./constraint.js";
import { asOneTurn, convert, type LanguageModelMessage, type LanguageModelMessageType, type LanguageModelPrompt } from "./content.js";
import { abortReason, domError } from "./errors.js";

export type Availability = "unavailable" | "downloadable" | "downloading" | "available";

export type LanguageModelSamplingMode =
	| "most-predictable"
	| "predictable"
	| "slightly-predictable"
	| "balanced"
	| "slightly-creative"
	| "creative"
	| "most-creative";

export interface LanguageModelExpected {
	type: LanguageModelMessageType;
	languages?: string[];
}

export interface LanguageModelTool {
	name: string;
	description: string;
	/** JSON Schema of the arguments. */
	inputSchema: object;
	/** Called with the arguments object; its result goes back to the model. */
	execute: (...args: any[]) => Promise<string> | string;
}

export interface LanguageModelCreateCoreOptions {
	/** Accepted and ignored: the visitor's AI sets its own sampling. */
	topK?: number;
	/** Accepted and ignored: the visitor's AI sets its own sampling. */
	temperature?: number;
	/** Accepted and ignored: the visitor's AI sets its own sampling. */
	samplingMode?: LanguageModelSamplingMode;
	expectedInputs?: LanguageModelExpected[];
	expectedOutputs?: LanguageModelExpected[];
	tools?: LanguageModelTool[];
}

export interface LanguageModelCreateOptions extends LanguageModelCreateCoreOptions {
	signal?: AbortSignal;
	monitor?: (monitor: EventTarget) => void;
	initialPrompts?: LanguageModelMessage[];
}

export interface LanguageModelPromptOptions {
	responseConstraint?: ResponseConstraint;
	/** Accepted and ignored: the visitor's AI always needs the constraint in its prompt. */
	omitResponseConstraintInput?: boolean;
	signal?: AbortSignal;
}

export interface LanguageModelAppendOptions {
	signal?: AbortSignal;
}

export interface LanguageModelCloneOptions {
	signal?: AbortSignal;
}

export interface PromptAPIOptions extends BridgeProviderOptions {
	/** The AI behind `LanguageModel`. Default: `leuria()` with these options. */
	provider?: Provider;
	/** Instructions for the AI when the page gives no system prompt. */
	system?: string;
	/** Most tool calls per prompt. Default 20. */
	maxSteps?: number;
	/** How many times an answer that misses the `responseConstraint` goes back to the AI. Default 2. */
	retries?: number;
}

/** @internal What a `LanguageModel` starts from (its constructor is not public). */
export interface LanguageModelInit {
	options: LanguageModelCreateCoreOptions;
	system: string;
	history: Message[];
}

/** Set on Leuria's `LanguageModel`, so code can tell it from the browser's own. */
export const LEURIA_MARK: unique symbol = Symbol.for("leuria.prompt-api") as never;

const DEFAULT_SYSTEM =
	"You answer requests from a web page. Reply with the answer only, without preamble or follow-up questions. Use only the tools the page gives you, if any.";
/** Reported as `contextWindow`: the visitor's AI manages its own context, so this is a nominal size. */
const CONTEXT_WINDOW = 128_000;

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function createLanguageModel(options: PromptAPIOptions = {}) {
	const { provider: given, system: defaultSystem = DEFAULT_SYSTEM, maxSteps = 20, retries = 2, ...bridgeOptions } = options;
	let shared = given;
	const provider = (): Provider => (shared ??= leuria(bridgeOptions));
	const key = Symbol("LanguageModel");
	const live = new Set<LanguageModel>();
	let watching = false;
	const watchUnload = () => {
		if (watching || typeof window === "undefined") return;
		watching = true;
		// The visitor's AI sessions end with the page.
		window.addEventListener("pagehide", () => {
			for (const model of [...live]) model.destroy();
		});
	};

	class LanguageModel extends EventTarget {
		static readonly [LEURIA_MARK] = true;

		static async availability(options: LanguageModelCreateCoreOptions = {}): Promise<Availability> {
			validateCore(options);
			return availabilityOf(provider(), options);
		}

		/** Only in extension contexts in the spec; null here. */
		static async params(): Promise<null> {
			return null;
		}

		static async create(options: LanguageModelCreateOptions = {}): Promise<LanguageModel> {
			validateCore(options);
			const { signal } = options;
			if (signal?.aborted) throw abortReason(signal);
			const initial = await convert(options.initialPrompts ?? [], true);
			const ai = provider();
			let availability = await availabilityOf(ai, options);
			if (availability === "unavailable") throw domError("NotSupportedError", "No AI can serve these options here.");
			const monitor = new EventTarget();
			options.monitor?.(monitor);
			if (availability !== "available") {
				if (!hasActivation()) {
					throw domError("NotAllowedError", "Connecting the visitor's AI needs a user gesture: call create() from a click.");
				}
				if (!ai.connect) throw domError("NotSupportedError", "This AI cannot be connected from the page.");
				progress(monitor, 0);
				await untilAborted(ai.connect(), signal);
				availability = await availabilityOf(ai, options);
				if (availability !== "available") throw domError("NotAllowedError", "The visitor's AI was not connected.");
				progress(monitor, 1);
			}
			if (signal?.aborted) throw abortReason(signal);
			const { signal: _signal, monitor: _monitor, initialPrompts: _initial, ...core } = options;
			return new LanguageModel(key, { options: core, system: initial.system || defaultSystem, history: initial.messages });
		}

		readonly #options: LanguageModelCreateCoreOptions;
		readonly #system: string;
		readonly #tools: Map<string, LanguageModelTool>;
		readonly #history: Message[];
		/** Appended messages, sent with the next prompt. */
		#pending: Message[] = [];
		#session: ProviderSession | null = null;
		#queue: Promise<unknown> = Promise.resolve();
		#destroyed = false;
		readonly #lifetime = new AbortController();
		#overflow: ((event: Event) => void) | null = null;

		constructor(token: symbol, init: LanguageModelInit) {
			if (token !== key) throw new TypeError("Illegal constructor");
			super();
			this.#options = init.options;
			this.#system = init.system;
			this.#history = [...init.history];
			this.#tools = new Map((init.options.tools ?? []).map((tool) => [tool.name, tool]));
			live.add(this);
			watchUnload();
		}

		get contextUsage(): number {
			return estimateTokens([this.#system, ...[...this.#history, ...this.#pending].map(messageText)].join("\n"));
		}

		get contextWindow(): number {
			return CONTEXT_WINDOW;
		}

		get samplingMode(): LanguageModelSamplingMode | null {
			return this.#options.samplingMode ?? null;
		}

		get oncontextoverflow(): ((event: Event) => void) | null {
			return this.#overflow;
		}

		set oncontextoverflow(handler: ((event: Event) => void) | null) {
			if (this.#overflow) this.removeEventListener("contextoverflow", this.#overflow);
			this.#overflow = typeof handler === "function" ? handler : null;
			if (this.#overflow) this.addEventListener("contextoverflow", this.#overflow);
		}

		prompt(input: LanguageModelPrompt, options: LanguageModelPromptOptions = {}): Promise<string> {
			return this.#prompt(input, options);
		}

		promptStreaming(input: LanguageModelPrompt, options: LanguageModelPromptOptions = {}): ReadableStream<string> {
			const cancel = new AbortController();
			const stream = new ReadableStream<string>({
				start: (controller) => {
					const enqueue = (delta: string) => {
						try {
							controller.enqueue(delta);
						} catch {
							// cancelled by the reader
						}
					};
					this.#prompt(input, { ...options, signal: anySignal(options.signal, cancel.signal) }, enqueue).then(
						() => controller.close(),
						(error: unknown) => {
							try {
								controller.error(error);
							} catch {
								// cancelled by the reader
							}
						},
					);
				},
				cancel: (reason) => cancel.abort(reason ?? domError("AbortError", "The stream was cancelled.")),
			});
			return asyncIterable(stream);
		}

		async append(input: LanguageModelPrompt, options: LanguageModelAppendOptions = {}): Promise<void> {
			this.#assertLive();
			const signal = anySignal(options.signal, this.#lifetime.signal);
			if (signal.aborted) throw abortReason(signal);
			const { messages, prefix } = await convert(input);
			if (prefix !== undefined) throw domError("SyntaxError", "append() takes no prefix message.");
			const work = this.#queue.then(() => {
				if (signal.aborted) throw abortReason(signal);
				this.#pending.push(...messages);
			});
			this.#queue = work.catch(() => undefined);
			return untilAborted(work, signal);
		}

		async measureContextUsage(input: LanguageModelPrompt, options: LanguageModelPromptOptions = {}): Promise<number> {
			this.#assertLive();
			const { messages, prefix } = await convert(input);
			const constraint = options.responseConstraint ? constraintInstruction(options.responseConstraint) : "";
			return estimateTokens([...messages.map(messageText), prefix ?? "", constraint].join("\n"));
		}

		async clone(options: LanguageModelCloneOptions = {}): Promise<LanguageModel> {
			this.#assertLive();
			const signal = anySignal(options.signal, this.#lifetime.signal);
			await untilAborted(this.#queue, signal);
			this.#assertLive();
			return new LanguageModel(key, { options: this.#options, system: this.#system, history: [...this.#history, ...this.#pending] });
		}

		destroy(): void {
			if (this.#destroyed) return;
			this.#destroyed = true;
			this.#lifetime.abort(domError("AbortError", "The session was destroyed."));
			this.#dropSession();
			live.delete(this);
		}

		// ── Turns ───────────────────────────────────────────────────────

		async #prompt(input: LanguageModelPrompt, options: LanguageModelPromptOptions, onDelta?: (delta: string) => void): Promise<string> {
			this.#assertLive();
			const signal = anySignal(options.signal, this.#lifetime.signal);
			if (signal.aborted) throw abortReason(signal);
			const constraint = options.responseConstraint;
			if (constraint !== undefined && (typeof constraint !== "object" || constraint === null)) {
				throw new TypeError("responseConstraint must be a JSON Schema or a RegExp.");
			}
			const { messages, prefix } = await convert(input);
			const work = this.#queue.then(() => this.#turn(messages, prefix, constraint, signal, onDelta));
			this.#queue = work.catch(() => undefined);
			return untilAborted(work, signal);
		}

		async #turn(
			messages: Message[],
			prefix: string | undefined,
			constraint: ResponseConstraint | undefined,
			signal: AbortSignal,
			onDelta?: (delta: string) => void,
		): Promise<string> {
			if (signal.aborted) throw abortReason(signal);
			const sending = [...this.#pending, ...messages];
			const user = asOneTurn(sending.length ? sending : [{ id: newId(), role: "user", parts: [{ type: "text", text: "" }] }]);
			const hasImages = user.parts.some((p) => p.type === "file" && p.mediaType.startsWith("image/"));
			if (hasImages && !provider().getState().capabilities.includes("images")) {
				throw domError("NotSupportedError", "The visitor's AI does not take images.");
			}
			const instructions = [
				constraint ? constraintInstruction(constraint) : undefined,
				prefix !== undefined ? `Begin your answer with exactly this text, then continue it:\n${prefix}` : undefined,
			].filter((s): s is string => Boolean(s));
			const session = await this.#ensureSession();

			let answer: string;
			if (constraint) {
				let text = await this.#send(session, withInstructions(user, instructions), signal);
				let check = checkAnswer(stripPrefix(text, prefix), constraint);
				for (let attempt = 0; !check.ok && attempt < retries; attempt++) {
					const fix = `That answer is not valid: ${check.error}. ${constraintInstruction(constraint)}`;
					text = await this.#send(session, { id: newId(), role: "user", parts: [{ type: "text", text: fix }] }, signal);
					check = checkAnswer(stripPrefix(text, prefix), constraint);
				}
				if (!check.ok) throw domError("UnknownError", `The answer did not match the response constraint: ${check.error}.`);
				answer = check.text;
				if (answer) onDelta?.(answer);
			} else {
				const strip = prefixStripper(prefix, onDelta);
				const text = await this.#send(session, withInstructions(user, instructions), signal, strip.push);
				strip.flush();
				answer = stripPrefix(text, prefix);
			}
			this.#pending = [];
			this.#history.push(user, { id: newId(), role: "assistant", parts: [{ type: "text", text: (prefix ?? "") + answer }] });
			return answer;
		}

		async #send(session: ProviderSession, message: Message, signal: AbortSignal, onDelta?: (delta: string) => void): Promise<string> {
			const context: TurnContext = {
				turnId: newId("turn"),
				signal,
				text: (delta) => {
					if (delta && !signal.aborted) onDelta?.(delta);
				},
				reasoning: () => undefined,
				status: () => undefined,
				runTool: ({ name, args }) => this.#runTool(name, args),
			};
			try {
				return (await session.send(message, context)).text;
			} catch (error) {
				if (signal.aborted) throw abortReason(signal);
				// A broken session is not reused: the next prompt starts a new one, with the history.
				this.#dropSession();
				throw domError("UnknownError", error instanceof Error ? error.message : String(error));
			}
		}

		async #runTool(name: string, args: Record<string, unknown>) {
			const tool = this.#tools.get(name);
			if (!tool) return { ok: false as const, error: `Unknown tool: ${name}` };
			try {
				const result: unknown = await tool.execute(args);
				return { ok: true as const, result: typeof result === "string" ? result : JSON.stringify(result ?? null) };
			} catch (error) {
				return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
			}
		}

		async #ensureSession(): Promise<ProviderSession> {
			if (this.#session && !this.#session.closed) return this.#session;
			this.#dropSession();
			const ai = provider();
			if (ai.getState().status !== "ready") await ai.detect().catch(() => undefined);
			const state = ai.getState();
			if (state.status !== "ready") throw domError("InvalidStateError", "The visitor's AI is not connected anymore.");
			const tools = [...this.#tools.values()].map(({ name, description, inputSchema }) => ({
				name,
				description,
				inputSchema: inputSchema as Record<string, unknown>,
			}));
			if (tools.length && !state.capabilities.includes("tools")) throw domError("NotSupportedError", "The visitor's AI cannot use tools.");
			this.#session = await ai.createSession({ system: this.#system, tools, history: [...this.#history], maxSteps });
			return this.#session;
		}

		#dropSession(): void {
			try {
				this.#session?.close();
			} catch {
				// already closed
			}
			this.#session = null;
		}

		#assertLive(): void {
			if (this.#destroyed) throw domError("InvalidStateError", "The session was destroyed.");
		}
	}

	return LanguageModel;
}

export type LanguageModelConstructor = ReturnType<typeof createLanguageModel>;
export type LanguageModel = InstanceType<LanguageModelConstructor>;

// ── Helpers ────────────────────────────────────────────────────────────

function validateCore(options: LanguageModelCreateCoreOptions): void {
	if (options.samplingMode !== undefined && (options.topK !== undefined || options.temperature !== undefined)) {
		throw new TypeError("samplingMode cannot be combined with topK or temperature.");
	}
	for (const expected of [...(options.expectedInputs ?? []), ...(options.expectedOutputs ?? [])]) {
		// Throws a RangeError on an invalid language tag, as the spec says.
		if (expected.languages) Intl.getCanonicalLocales(expected.languages);
	}
}

async function availabilityOf(ai: Provider, options: LanguageModelCreateCoreOptions): Promise<Availability> {
	const inputs = (options.expectedInputs ?? []).map((e) => e.type);
	const outputs = (options.expectedOutputs ?? []).map((e) => e.type);
	if (inputs.includes("audio") || outputs.some((t) => t !== "text" && t !== "tool-call")) return "unavailable";
	await ai.detect().catch(() => undefined);
	const state = ai.getState();
	const caps = new Set(state.capabilities);
	if (inputs.includes("image") && !caps.has("images")) return "unavailable";
	if (options.tools?.length && !caps.has("tools")) return "unavailable";
	switch (state.status) {
		case "ready":
			return "available";
		case "needs-action":
			return "downloadable";
		case "downloading":
			return "downloading";
		default:
			return "unavailable";
	}
}

function hasActivation(): boolean {
	const activation = typeof navigator === "undefined" ? undefined : (navigator as { userActivation?: { isActive: boolean } }).userActivation;
	return activation ? activation.isActive : true;
}

function progress(target: EventTarget, loaded: number): void {
	const event =
		typeof ProgressEvent !== "undefined"
			? new ProgressEvent("downloadprogress", { loaded, total: 1 })
			: Object.assign(new Event("downloadprogress"), { loaded, total: 1 });
	target.dispatchEvent(event);
}

function withInstructions(message: Message, instructions: string[]): Message {
	if (!instructions.length) return message;
	const text = [messageText(message), ...instructions].filter(Boolean).join("\n\n");
	return { ...message, parts: [{ type: "text", text }, ...message.parts.filter((p) => p.type !== "text")] };
}

function stripPrefix(text: string, prefix: string | undefined): string {
	if (!prefix) return text;
	const start = text.trimStart();
	return start.startsWith(prefix) ? start.slice(prefix.length) : text;
}

/** Streamed text without the prefix the AI was asked to start with (the page already has it). */
function prefixStripper(prefix: string | undefined, onDelta?: (delta: string) => void) {
	if (!prefix) return { push: (delta: string) => onDelta?.(delta), flush: () => undefined };
	let buffer = "";
	let decided = false;
	return {
		push(delta: string) {
			if (decided) return onDelta?.(delta);
			buffer += delta;
			const start = buffer.trimStart();
			if (start.length < prefix.length && prefix.startsWith(start)) return;
			decided = true;
			const rest = start.startsWith(prefix) ? start.slice(prefix.length) : buffer;
			if (rest) onDelta?.(rest);
		},
		flush() {
			// An answer that was only (part of) the prefix continues it with nothing.
			if (!decided && !prefix.startsWith(buffer.trimStart())) onDelta?.(buffer);
		},
	};
}

function anySignal(...signals: Array<AbortSignal | undefined>): AbortSignal {
	const list = signals.filter((s): s is AbortSignal => Boolean(s));
	if (list.length === 1) return list[0]!;
	if (typeof AbortSignal.any === "function") return AbortSignal.any(list);
	const controller = new AbortController();
	for (const signal of list) {
		if (signal.aborted) {
			controller.abort(signal.reason);
			break;
		}
		signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
	}
	return controller.signal;
}

/** `promise`, or the abort reason as soon as `signal` aborts (the work itself may settle later). */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(abortReason(signal));
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(abortReason(signal));
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
	});
}

/** Safari's streams are not async iterable yet; the spec's examples use `for await`. */
function asyncIterable<T>(stream: ReadableStream<T>): ReadableStream<T> {
	if (Symbol.asyncIterator in stream) return stream;
	Object.defineProperty(stream, Symbol.asyncIterator, {
		value: async function* () {
			const reader = stream.getReader();
			try {
				for (;;) {
					const { value, done } = await reader.read();
					if (done) return;
					yield value;
				}
			} finally {
				reader.releaseLock();
			}
		},
	});
	return stream;
}
