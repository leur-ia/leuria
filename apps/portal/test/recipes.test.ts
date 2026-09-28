// Every runnable recipe in the docs (```js leuria-run) runs here against a
// fake AI, so an API change that breaks an example fails the build.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import * as client from "@leuria/client";
import {
	BaseProvider,
	createLeuria,
	type EmbedRequest,
	type EmbedResult,
	type JsonSchema,
	type Message,
	type ProviderSession,
	type SessionOptions,
	type TurnContext,
} from "@leuria/client";
import * as store from "@leuria/store";
import { afterEach, describe, expect, it } from "vitest";

import { recipes, run } from "../src/playground/run";

const docsDir = fileURLToPath(new URL("../../../docs", import.meta.url));

function markdownFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? markdownFiles(path) : name.endsWith(".md") ? [path] : [];
	});
}

/** A value that fits a JSON Schema: every property, the first enum value. */
function fake(schema: JsonSchema | undefined): unknown {
	const s = (schema ?? {}) as Record<string, unknown>;
	if (Array.isArray(s.enum)) return s.enum[0];
	if (s.const !== undefined) return s.const;
	const type = Array.isArray(s.type) ? s.type[0] : s.type;
	if (type === "object" || s.properties) {
		const properties = (s.properties ?? {}) as Record<string, JsonSchema>;
		return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, fake(value)]));
	}
	if (type === "array") return [fake(s.items as JsonSchema)];
	if (type === "number" || type === "integer") return typeof s.minimum === "number" ? s.minimum : 1;
	if (type === "boolean") return true;
	return "mug";
}

/** Calls each tool once with made-up arguments, then answers; answers schemas with a fitting object. */
class FakeAI extends BaseProvider {
	constructor() {
		super("fake", "A test AI", "device", { status: "ready", capabilities: ["chat", "tools", "structured"], model: "fake", embedModel: "words" });
	}
	readonly offers = ["chat", "embed"] as const;
	async detect(): Promise<void> {}
	async embed({ texts }: EmbedRequest): Promise<EmbedResult> {
		const words = ["mug", "tea", "glaze", "blue", "price", "order", "search", "tool"];
		return { model: "words", vectors: texts.map((t) => words.map((w) => (t.toLowerCase().split(w).length - 1) + 0.01)) };
	}
	async createSession(options: SessionOptions): Promise<ProviderSession> {
		return {
			send: async (_message: Message, context: TurnContext) => {
				if (options.schema) return { text: JSON.stringify(fake(options.schema)) };
				for (const tool of options.tools) {
					const outcome = await context.runTool({ name: tool.name, args: fake(tool.inputSchema) as Record<string, unknown> });
					if (tool.name === client.SUBMIT_TOOL && outcome.ok) return { text: "" };
				}
				context.text("A short answer.");
				return { text: "A short answer." };
			},
			close: () => undefined,
		};
	}
}

const found = markdownFiles(docsDir).flatMap((file) =>
	recipes(readFileSync(file, "utf8")).map((code, i) => ({ name: `${relative(docsDir, file)}#${i + 1}`, code })),
);

let ai: client.Leuria | undefined;
afterEach(() => ai?.destroy());

describe("recipes", () => {
	if (found.length === 0) it.skip("no runnable recipes yet", () => undefined);
	it.each(found)("$name runs", async ({ code }) => {
		ai = createLeuria({ providers: [new FakeAI()], autoDetect: false, closeOnUnload: false });
		const printed: unknown[] = [];
		globalThis.confirm ??= () => true;
		await run(code, { ai, modules: { "@leuria/client": client, "@leuria/store": store }, print: (v) => printed.push(v) });
		expect(printed.length).toBeGreaterThan(0);
	});
});
