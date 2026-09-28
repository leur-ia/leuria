/**
 * Structured output. Providers with native support (browser AI's
 * `responseConstraint`, a server's `response_format`) get the schema
 * directly. The others get a `submit_result` tool whose input is the
 * schema: models are good at filling tool arguments, and the arguments
 * come back already parsed.
 */

import { StructuredOutputError } from "./errors.js";
import type { JsonSchema, ToolDefinition } from "./types.js";

export const SUBMIT_TOOL = "submit_result";

/** Appended to the system prompt when the tool route is used. */
export const SUBMIT_INSTRUCTION = `When you have the answer, call the ${SUBMIT_TOOL} tool exactly once with it. Do not write the answer as text.`;

export interface StructuredSpec<T> {
	schema: JsonSchema;
	/** Throw to reject; the message goes back to the model. Return the typed value. */
	validate?: (value: unknown) => T;
}

/** Tool schemas must be objects: wrap anything else in `{ value }`. */
function wrap(schema: JsonSchema): { schema: JsonSchema; unwrap: (args: Record<string, unknown>) => unknown } {
	if (schema.type === "object") return { schema, unwrap: (args) => args };
	return {
		schema: { type: "object", properties: { value: schema }, required: ["value"], additionalProperties: false },
		unwrap: (args) => args.value,
	};
}

export class StructuredCollector<T> {
	value: T | undefined;
	submitted = false;
	private readonly wrapped: ReturnType<typeof wrap>;

	constructor(private readonly spec: StructuredSpec<T>) {
		this.wrapped = wrap(spec.schema);
	}

	tool(): ToolDefinition {
		return {
			name: SUBMIT_TOOL,
			description: "Submit the final answer. Its arguments must match the schema.",
			inputSchema: this.wrapped.schema,
			execute: (args) => {
				this.value = this.check(this.wrapped.unwrap(args));
				this.submitted = true;
				return { accepted: true };
			},
		};
	}

	/** Result when the provider answered in text (native route, or the model ignored the tool). */
	fromText(text: string): T {
		if (this.submitted) return this.value as T;
		const json = extractJson(text);
		if (json === undefined) throw new StructuredOutputError("The model did not return JSON.", text);
		try {
			return this.check(json);
		} catch (error) {
			throw new StructuredOutputError(
				`The model's JSON does not match: ${error instanceof Error ? error.message : String(error)}`,
				text,
			);
		}
	}

	private check(value: unknown): T {
		return this.spec.validate ? this.spec.validate(value) : (value as T);
	}
}

/** Parse the first JSON value in `text`, tolerating code fences and prose around it. */
export function extractJson(text: string): unknown {
	const trimmed = text.trim();
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)?.[1];
	for (const candidate of [fenced, trimmed]) {
		if (!candidate) continue;
		try {
			return JSON.parse(candidate);
		} catch {
			// try the next form
		}
	}
	const start = trimmed.search(/[[{]/);
	if (start < 0) return undefined;
	const open = trimmed[start]!;
	const close = open === "{" ? "}" : "]";
	const end = trimmed.lastIndexOf(close);
	if (end <= start) return undefined;
	try {
		return JSON.parse(trimmed.slice(start, end + 1));
	} catch {
		return undefined;
	}
}
