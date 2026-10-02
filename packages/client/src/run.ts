import { toError } from "./errors.js";
import type { ChatEvent, ChatEventBody, ChatResult } from "./types.js";

/**
 * One turn in flight. Iterate it for events, or await `text()`,
 * `object()` or `result()`. Every iterator replays the events from the
 * start, so late consumers miss nothing.
 */
export class ChatRun<T = unknown> implements AsyncIterable<ChatEvent> {
	private readonly events: ChatEvent[] = [];
	private readonly waiters = new Set<() => void>();
	private readonly listeners = new Set<(event: ChatEvent) => void>();
	private readonly controller = new AbortController();
	private done = false;
	private readonly promise: Promise<ChatResult<T>>;

	constructor(
		readonly turnId: string,
		executor: (emit: (event: ChatEventBody) => void, signal: AbortSignal) => Promise<ChatResult<T>>,
		signal?: AbortSignal,
	) {
		if (signal) {
			if (signal.aborted) this.controller.abort(signal.reason);
			else signal.addEventListener("abort", () => this.controller.abort(signal.reason), { once: true });
		}
		this.promise = Promise.resolve()
			.then(() => executor((event) => this.push(event), this.controller.signal))
			.then(
				(result) => {
					this.push({ type: "finish", text: result.text, object: result.object, outcome: result.outcome });
					this.close();
					return result;
				},
				(error: unknown) => {
					this.push({ type: "error", error: toError(error) });
					this.close();
					throw error;
				},
			);
		// Callers that only iterate must not trigger unhandled rejections.
		this.promise.catch(() => undefined);
	}

	/** Cancel the turn. */
	abort(reason?: unknown): void {
		this.controller.abort(reason);
	}

	get signal(): AbortSignal {
		return this.controller.signal;
	}

	/** Call `listener` for every event, past and future. Returns the unsubscribe function. */
	on(listener: (event: ChatEvent) => void): () => void {
		for (const event of this.events) listener(event);
		if (this.done) return () => undefined;
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	result(): Promise<ChatResult<T>> {
		return this.promise;
	}

	async text(): Promise<string> {
		return (await this.promise).text;
	}

	/** The structured output. Rejects when the request had no schema. */
	async object(): Promise<T> {
		const result = await this.promise;
		if (result.object === undefined) throw new Error("This request had no schema.");
		return result.object;
	}

	async *[Symbol.asyncIterator](): AsyncIterator<ChatEvent> {
		let index = 0;
		for (;;) {
			while (index < this.events.length) yield this.events[index++]!;
			if (this.done) return;
			await new Promise<void>((resolve) => this.waiters.add(resolve));
		}
	}

	private push(body: ChatEventBody): void {
		if (this.done) return;
		const event = { ...body, turnId: this.turnId, at: Date.now() } as ChatEvent;
		this.events.push(event);
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (error) {
				console.error("[leuria] event listener failed", error);
			}
		}
		this.wake();
	}

	private close(): void {
		this.done = true;
		this.listeners.clear();
		this.wake();
	}

	private wake(): void {
		for (const resolve of this.waiters) resolve();
		this.waiters.clear();
	}
}
