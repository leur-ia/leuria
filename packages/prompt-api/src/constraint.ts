/**
 * `responseConstraint`: a JSON Schema or a RegExp. The visitor's AI gets
 * it as an instruction, and the answer is checked here; a mismatch is
 * sent back to the AI to fix, a few times at most.
 */

import { extractJson } from "@leuria/client";

export type ResponseConstraint = Record<string, unknown> | RegExp;

export function constraintInstruction(constraint: ResponseConstraint): string {
	if (constraint instanceof RegExp) {
		return `Answer with text that matches this regular expression, and nothing else: ${constraint.toString()}`;
	}
	return `Answer with JSON only (no code fences, no other text), matching this JSON Schema:\n${JSON.stringify(constraint)}`;
}

/** The answer as the page gets it, or why it doesn't match. */
export function checkAnswer(text: string, constraint: ResponseConstraint): { ok: true; text: string } | { ok: false; error: string } {
	if (constraint instanceof RegExp) {
		const whole = new RegExp(`^(?:${constraint.source})$`, constraint.flags.replace(/[gy]/g, ""));
		for (const candidate of [text, text.trim(), unfence(text.trim())]) {
			if (whole.test(candidate)) return { ok: true, text: candidate };
		}
		return { ok: false, error: `the answer does not match ${constraint.toString()}` };
	}
	const value = extractJson(text);
	if (value === undefined) return { ok: false, error: "the answer is not JSON" };
	const error = validate(value, constraint, "$");
	return error ? { ok: false, error } : { ok: true, text: JSON.stringify(value) };
}

function unfence(text: string): string {
	return /^```\w*\s*([\s\S]*?)\s*```$/.exec(text)?.[1] ?? text.replace(/^"([\s\S]*)"$/, "$1");
}

type Schema = Record<string, unknown>;

/** The first violation of the common JSON Schema keywords, or null. */
export function validate(value: unknown, schema: Schema, path: string): string | null {
	if (typeof schema !== "object" || schema === null) return null;
	if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) return `${path} must be ${JSON.stringify(schema.const)}`;
	if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
		return `${path} must be one of ${JSON.stringify(schema.enum)}`;
	}
	for (const key of ["anyOf", "oneOf"] as const) {
		const options = schema[key];
		if (Array.isArray(options)) {
			const matches = options.filter((s) => validate(value, s as Schema, path) === null).length;
			if (matches === 0 || (key === "oneOf" && matches > 1)) return `${path} does not match ${key}`;
		}
	}
	if (Array.isArray(schema.allOf)) {
		for (const s of schema.allOf) {
			const error = validate(value, s as Schema, path);
			if (error) return error;
		}
	}
	const types = schema.type === undefined ? undefined : [schema.type].flat();
	if (types && !types.some((t) => isType(value, t as string))) return `${path} must be ${types.join(" or ")}`;

	if (typeof value === "string") {
		if (typeof schema.minLength === "number" && value.length < schema.minLength) return `${path} is too short`;
		if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return `${path} is too long`;
		if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) return `${path} must match ${schema.pattern}`;
	}
	if (typeof value === "number") {
		if (typeof schema.minimum === "number" && value < schema.minimum) return `${path} must be at least ${schema.minimum}`;
		if (typeof schema.maximum === "number" && value > schema.maximum) return `${path} must be at most ${schema.maximum}`;
		if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) return `${path} must be more than ${schema.exclusiveMinimum}`;
		if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) return `${path} must be less than ${schema.exclusiveMaximum}`;
	}
	if (Array.isArray(value)) {
		if (typeof schema.minItems === "number" && value.length < schema.minItems) return `${path} needs at least ${schema.minItems} items`;
		if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return `${path} has more than ${schema.maxItems} items`;
		if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
			for (const [i, item] of value.entries()) {
				const error = validate(item, schema.items as Schema, `${path}[${i}]`);
				if (error) return error;
			}
		}
	}
	if (isType(value, "object")) {
		const object = value as Record<string, unknown>;
		const properties = (schema.properties ?? {}) as Record<string, Schema>;
		for (const key of Array.isArray(schema.required) ? (schema.required as string[]) : []) {
			if (!(key in object)) return `${path}.${key} is required`;
		}
		for (const [key, item] of Object.entries(object)) {
			if (key in properties) {
				const error = validate(item, properties[key]!, `${path}.${key}`);
				if (error) return error;
			} else if (schema.additionalProperties === false) {
				return `${path}.${key} is not allowed`;
			} else if (typeof schema.additionalProperties === "object" && schema.additionalProperties !== null) {
				const error = validate(item, schema.additionalProperties as Schema, `${path}.${key}`);
				if (error) return error;
			}
		}
	}
	return null;
}

function isType(value: unknown, type: string): boolean {
	switch (type) {
		case "string":
			return typeof value === "string";
		case "number":
			return typeof value === "number" && Number.isFinite(value);
		case "integer":
			return Number.isInteger(value);
		case "boolean":
			return typeof value === "boolean";
		case "null":
			return value === null;
		case "array":
			return Array.isArray(value);
		case "object":
			return typeof value === "object" && value !== null && !Array.isArray(value);
		default:
			return true;
	}
}
