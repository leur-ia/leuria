import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GrantStore } from "../src/grants.js";
import { type EngineHandle, startEngine } from "../src/server.js";

const FAKE_AGENT = fileURLToPath(new URL("./fixtures/fake-agent.mjs", import.meta.url));
const PORT = 19585;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = "http://localhost:7100";
const silent = { info: () => {}, warn: () => {}, error: () => {} };

describe("what a connected site sees of its AI", () => {
	let engine: EngineHandle;
	let grants: GrantStore;
	let token: string;
	beforeAll(async () => {
		grants = new GrantStore(null);
		token = grants.create(SITE);
		engine = await startEngine({
			port: PORT,
			grants,
			logger: silent,
			agentName: "Default AI",
			siteAgentName: (origin) => (grants.get(origin)?.agent ? `Own AI of ${origin}` : "Default AI · Sonnet 5"),
			resolveAgent: async () => ({ command: process.execPath, args: [FAKE_AGENT] }),
		});
	});
	afterAll(() => engine.close());

	const health = (auth = true) =>
		fetch(`${BASE}/health`, { headers: { Origin: SITE, ...(auth ? { Authorization: `Bearer ${token}` } : {}) } }).then(
			(r) => r.json() as Promise<{ agent: string }>,
		);

	it("names the site's own AI and model; others only hear the default's name", async () => {
		expect((await health()).agent).toBe("Default AI · Sonnet 5");
		grants.setAgent(SITE, "codex-acp");
		expect((await health()).agent).toBe(`Own AI of ${SITE}`);
		expect((await health(false)).agent).toBe("Default AI");
		grants.setAgent(SITE, undefined);
	});

	it("ends the site's open conversation when its AI changes", async () => {
		const headers = { "Content-Type": "application/json", Origin: SITE, Authorization: `Bearer ${token}` };
		const { sessionId } = (await (await fetch(`${BASE}/session/prepare`, { method: "POST", headers, body: "{}" })).json()) as { sessionId: string };
		const stream = await fetch(`${BASE}/session/${sessionId}/stream`, { headers });
		await fetch(`${BASE}/session/${sessionId}/approve`, { method: "POST", headers });
		const reader = stream.body!.getReader();
		const decoder = new TextDecoder();
		let text = "";
		while (!text.includes("event: ready")) text += decoder.decode((await reader.read()).value, { stream: true });
		grants.setAgent(SITE, "claude-acp");
		while (!/event: (ended|cancelled|failed|done)|"status":"cancelled"/.test(text)) {
			const { value, done } = await reader.read();
			if (done) break;
			text += decoder.decode(value, { stream: true });
		}
		const state = (await (await fetch(`${BASE}/session/${sessionId}`, { headers })).json()) as { status: string };
		expect(state.status).toBe("cancelled");
	});
});
