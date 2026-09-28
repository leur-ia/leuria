import { afterEach, describe, expect, it, vi } from "vitest";

import { defineTool, exposeTools } from "../src/index.js";

type Registered = { tool: { name: string; annotations?: unknown; execute: (args: Record<string, unknown>) => Promise<unknown> }; signal?: AbortSignal };

function fakeModelContext(where: "document" | "navigator") {
	const registered: Registered[] = [];
	const modelContext = { registerTool: async (tool: Registered["tool"], options?: { signal?: AbortSignal }) => void registered.push({ tool, signal: options?.signal }) };
	vi.stubGlobal(where, { modelContext });
	return registered;
}

afterEach(() => vi.unstubAllGlobals());

const search = defineTool<{ query?: string }>({
	name: "search_products",
	description: "Search the shop.",
	inputSchema: { type: "object", properties: { query: { type: "string" } } },
	annotations: { readOnlyHint: true },
	execute: ({ query = "" }) => [{ name: `mug ${query}`.trim() }],
});
const failing = defineTool({ name: "broken", description: "Fails.", inputSchema: { type: "object" }, execute: () => { throw new Error("out of mugs"); } });
const askVisitor = defineTool({ name: "confirm_order", description: "The visitor confirms.", inputSchema: { type: "object" } });

describe("exposeTools", () => {
	it("offers the page's tools to the browser's agents, results as JSON", async () => {
		const registered = fakeModelContext("document");
		exposeTools([search, failing, askVisitor]);
		expect(registered.map((r) => r.tool.name)).toEqual(["search_products", "broken"]);
		expect(registered[0]?.tool.annotations).toEqual({ readOnlyHint: true });
		expect(await registered[0]?.tool.execute({ query: "blue" })).toBe('[{"name":"mug blue"}]');
		expect(await registered[1]?.tool.execute({})).toBe('{"error":"out of mugs"}');
	});

	it("takes them back", () => {
		const registered = fakeModelContext("document");
		const stop = exposeTools([search]);
		expect(registered[0]?.signal?.aborted).toBe(false);
		stop();
		expect(registered[0]?.signal?.aborted).toBe(true);
	});

	it("uses navigator.modelContext on older Chrome, and does nothing without WebMCP", () => {
		const registered = fakeModelContext("navigator");
		exposeTools([search]);
		expect(registered).toHaveLength(1);
		vi.unstubAllGlobals();
		expect(() => exposeTools([search])()).not.toThrow();
	});
});
