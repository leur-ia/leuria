/**
 * WebMCP: the page's tools for the browser's own agents too.
 *
 *   const stop = exposeTools([searchProducts, addToCart])
 *
 * The same tool definitions serve the page's assistant (through Leuria)
 * and any agent the browser runs, through `document.modelContext`
 * (Chrome 146+, `navigator.modelContext` before Chromium 150). Where the
 * browser has no WebMCP, nothing happens.
 */

import type { ToolAnnotations, ToolDefinition } from "./types.js";

interface ModelContext {
	registerTool(
		tool: {
			name: string;
			description: string;
			inputSchema: object;
			execute: (args: Record<string, unknown>, client?: { signal?: AbortSignal }) => Promise<unknown>;
			annotations?: ToolAnnotations;
		},
		options?: { signal?: AbortSignal },
	): Promise<void> | void;
}

/** The browser's WebMCP entry point, if any. */
export function modelContext(): ModelContext | undefined {
	const doc = typeof document === "undefined" ? undefined : (document as unknown as { modelContext?: ModelContext }).modelContext;
	const nav = typeof navigator === "undefined" ? undefined : (navigator as unknown as { modelContext?: ModelContext }).modelContext;
	return doc ?? nav;
}

/**
 * Offer page tools to the browser's agents. Tools without `execute` (the
 * visitor answers them in the page's UI) are left out. Returns a function
 * that takes the tools back.
 */
export function exposeTools(tools: ToolDefinition[], options: { signal?: AbortSignal } = {}): () => void {
	const context = modelContext();
	const controller = new AbortController();
	const stop = () => controller.abort();
	options.signal?.addEventListener("abort", stop, { once: true });
	if (!context) return stop;

	for (const tool of tools) {
		const { execute } = tool;
		if (!execute) continue;
		let calls = 0;
		const registered = context.registerTool(
			{
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
				...(tool.annotations ? { annotations: tool.annotations } : {}),
				execute: async (args, client) => {
					const signal = client?.signal ?? new AbortController().signal;
					try {
						// The same context the page's assistant gives, minus a turn: there is none.
						const result = await execute(args ?? {}, {
							callId: `webmcp-${++calls}`,
							turnId: "webmcp",
							context: undefined,
							callCount: 1,
							endTurn: () => undefined,
							signal,
						});
						return typeof result === "string" ? result : JSON.stringify(result ?? null);
					} catch (error) {
						return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
					}
				},
			},
			{ signal: controller.signal },
		);
		// A name taken, a schema refused: the page's assistant keeps working.
		Promise.resolve(registered).catch((error: unknown) => console.warn(`[leuria] ${tool.name} couldn't be offered to the browser's agent`, error));
	}
	return stop;
}
