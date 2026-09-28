import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { GrantStore } from "../src/grants.js";
import { startEngine } from "../src/server.js";

const FAKE_AGENT = fileURLToPath(new URL("./fixtures/fake-agent.mjs", import.meta.url));
const silent = { info: () => {}, warn: () => {}, error: () => {} };

/** Start a session for a fake AI and collect what the engine learns about it. */
async function run(port: number, env: Record<string, string>) {
	const states: Array<{ id: string; ok: boolean; models?: unknown }> = [];
	const engine = await startEngine({
		port,
		grants: new GrantStore(null),
		logger: silent,
		agentName: "Fake",
		resolveAgent: async () => ({ id: "fake-ai", command: process.execPath, args: [FAKE_AGENT], env }),
		onAgentState: (id, state) => states.push({ id, ...state }),
	});
	try {
		const base = `http://127.0.0.1:${port}`;
		const { sessionId } = (await (
			await fetch(`${base}/session/prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
		).json()) as { sessionId: string };
		const stream = await fetch(`${base}/session/${sessionId}/stream`);
		await fetch(`${base}/session/${sessionId}/approve`, { method: "POST" });
		const reader = stream.body!.getReader();
		const decoder = new TextDecoder();
		let text = "";
		while (!/event: (ready|error|failed)/.test(text)) text += decoder.decode((await reader.read()).value, { stream: true });
		await reader.cancel();
		return states;
	} finally {
		await engine.close();
	}
}

describe("a real session is the check", () => {
	it("reports an AI that works, with the models it offers", async () => {
		const states = await run(19586, {});
		expect(states).toHaveLength(1);
		expect(states[0]).toMatchObject({ id: "fake-ai", ok: true, models: { current: "fast" } });
	});

	it("reports an AI that is signed out", async () => {
		expect(await run(19587, { FAKE_SIGNED_OUT: "1" })).toEqual([{ id: "fake-ai", ok: false }]);
	});
});
