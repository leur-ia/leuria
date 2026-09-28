/**
 * `leuria mcp-stdio <url>`: an MCP server over stdio that relays every
 * JSON-RPC message to the engine's HTTP endpoint. Used for agents that
 * only support stdio MCP servers (the one transport ACP requires).
 * The channel token comes from `LEURIA_MCP_TOKEN`.
 */

import { createInterface } from "node:readline";

export async function runMcpStdio(url: string): Promise<void> {
	const token = process.env.LEURIA_MCP_TOKEN;
	if (!url || !token) throw new Error("Usage: LEURIA_MCP_TOKEN=… leuria mcp-stdio <url>");
	const lines = createInterface({ input: process.stdin });
	for await (const line of lines) {
		if (!line.trim()) continue;
		void relay(url, token, line);
	}
}

async function relay(url: string, token: string, line: string): Promise<void> {
	let id: unknown = null;
	try {
		id = (JSON.parse(line) as { id?: unknown }).id ?? null;
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
			body: line,
		});
		// Notifications get 202 and no body.
		const text = (await res.text()).trim();
		if (text) process.stdout.write(`${text}\n`);
	} catch (error) {
		if (id === null) return;
		const message = error instanceof Error ? error.message : String(error);
		process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message } })}\n`);
	}
}
