import type { Capability, ProviderState } from "./types.js";

export class LeuriaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LeuriaError";
	}
}

/** No provider can serve the request right now. `reasons` says why, per provider. */
export class NoProviderError extends LeuriaError {
	constructor(
		readonly needs: Capability[],
		readonly reasons: Array<{ id: string; label: string; state: ProviderState; reason: string }>,
		/** Providers that could answer once the visitor picks one instead of their own AI (`ai.chooseInstead(id)`). */
		readonly choices: string[] = [],
	) {
		super(
			reasons.length === 0
				? "No AI provider is configured."
				: `No AI provider can answer: ${reasons.map((r) => `${r.label}: ${r.reason}`).join("; ")}`,
		);
		this.name = "NoProviderError";
	}

	/** A provider that would work after `connect()` (a click), if any. */
	get actionable(): string | undefined {
		return this.reasons.find((r) => r.state.status === "needs-action")?.id;
	}
}

/** The model did not return output that matches the schema. */
export class StructuredOutputError extends LeuriaError {
	constructor(
		message: string,
		readonly text: string,
	) {
		super(message);
		this.name = "StructuredOutputError";
	}
}

export class AbortError extends LeuriaError {
	constructor(message = "The request was cancelled.") {
		super(message);
		this.name = "AbortError";
	}
}

export function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

/** The turn took longer than its `timeoutMs`. */
export class TimeoutError extends LeuriaError {
	constructor(readonly timeoutMs: number) {
		super(`The turn took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`);
		this.name = "TimeoutError";
	}
}
