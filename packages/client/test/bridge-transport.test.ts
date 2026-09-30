import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GrantStore } from "../../engine/src/grants.js";
import { type EngineHandle, startEngine } from "../../engine/src/server.js";
import { BridgeClient, type BridgeEvent, bridge, LeuriaNotConnectedError, LeuriaNotRunningError, leuriaRunsHere } from "../src/index.js";

const PORT = 19598;
const URL_ = `http://127.0.0.1:${PORT}`;
const FAKE_AGENT = fileURLToPath(new URL("../../engine/test/fixtures/fake-agent.mjs", import.meta.url));
const SITE = "http://localhost:3000";
const silent = { info: () => {}, warn: () => {}, error: () => {} };

let engine: EngineHandle;
const nodeFetch = globalThis.fetch;

beforeAll(async () => {
	// Play a page on SITE: browsers always send Origin, Node does not.
	globalThis.fetch = (input, init = {}) => {
		const headers = { Origin: SITE, ...(init.headers as Record<string, string> | undefined) };
		return nodeFetch(input, { ...init, headers });
	};
	engine = await startEngine({
		port: PORT,
		grants: new GrantStore(null),
		logger: silent,
		agentName: "Fake agent",
		resolveAgent: async () => ({ command: process.execPath, args: [FAKE_AGENT] }),
		embeddings: {
			find: async () => ({ provider: { id: "lmstudio", kind: "lmstudio", name: "LM Studio", baseUrl: "http://127.0.0.1:1/v1" }, model: "fake-embed" }),
			embed: async (texts) => ({ model: "fake-embed", vectors: texts.map((t) => [t.length]) }),
		},
	});
});
afterAll(async () => {
	globalThis.fetch = nodeFetch;
	await engine.close();
});

function memoryStorage() {
	const map = new Map<string, string>();
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k),
	};
}

/** Plays the visitor answering Leuria's question as soon as the site asks. */
function answerWhenAsked(allow = true) {
	const timer = setInterval(() => {
		const request = engine.pairing.pending().find((r) => r.origin === SITE);
		if (!request) return;
		clearInterval(timer);
		engine.pairing.decideById(request.requestId, allow);
	}, 10);
	setTimeout(() => clearInterval(timer), 10_000);
}

function collect(events: BridgeEvent[], type: BridgeEvent["type"]): Promise<BridgeEvent> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}: ${JSON.stringify(events)}`)), 10_000);
		const check = setInterval(() => {
			const found = events.find((e) => e.type === type || e.type === "failed");
			if (found) {
				clearTimeout(timer);
				clearInterval(check);
				events.splice(0, events.indexOf(found) + 1);
				resolve(found);
			}
		}, 10);
	});
}

describe("BridgeClient", () => {
	it("asks nothing before the site is connected; a connected site sees whether Leuria runs", async () => {
		expect((await new BridgeClient({ url: "http://127.0.0.1:1", storage: memoryStorage() }).detect()).status).toBe("unpaired");
		const storage = memoryStorage();
		storage.setItem("leuria:token:http://127.0.0.1:1", "some-token");
		expect((await new BridgeClient({ url: "http://127.0.0.1:1", storage }).detect()).status).toBe("offline");
	});

	it("puts the site's needs in the link, and opens Leuria on the site's settings", async () => {
		const opened: string[] = [];
		(globalThis as { location?: unknown }).location = { origin: SITE };
		try {
			const leuria = new BridgeClient({ url: "http://127.0.0.1:1", app: "Shop", needs: { tools: true, effort: "light", context: 8000 }, storage: memoryStorage() });
			await leuria.connect({ openLink: (url) => opened.push(url), reachMs: 50, timeoutMs: 100 }).catch(() => undefined);
			leuria.manage({ openLink: (url) => opened.push(url) });
		} finally {
			delete (globalThis as { location?: unknown }).location;
		}
		const link = new URL(opened[0]!);
		expect(link.protocol).toBe("leuria:");
		expect(Object.fromEntries(link.searchParams)).toMatchObject({ origin: SITE, app: "Shop", tools: "1", effort: "light", context: "8000" });
		expect(opened[1]).toBe(`leuria://site?origin=${encodeURIComponent(SITE)}`);
	});

	it("opens no link on a phone or tablet, and says at once that Leuria isn't there", async () => {
		const phones = [
			{ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", maxTouchPoints: 5 },
			{ userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)", maxTouchPoints: 5 },
			{ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 }, // an iPad asking for desktop sites
		];
		const real = Object.getOwnPropertyDescriptor(globalThis, "navigator");
		try {
			for (const navigator of phones) {
				Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true });
				expect(leuriaRunsHere()).toBe(false);
				const opened: string[] = [];
				const leuria = new BridgeClient({ url: "http://127.0.0.1:1", storage: memoryStorage() });
				await expect(leuria.connect({ openLink: (url) => opened.push(url), reachMs: 5_000 })).rejects.toBeInstanceOf(LeuriaNotRunningError);
				expect(opened).toEqual([]);
			}
			Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 }, configurable: true });
			expect(leuriaRunsHere()).toBe(true);
		} finally {
			if (real) Object.defineProperty(globalThis, "navigator", real);
			else delete (globalThis as { navigator?: unknown }).navigator;
		}
	});

	it("says Leuria isn't running when a connect gets no answer", async () => {
		const leuria = new BridgeClient({ url: "http://127.0.0.1:1", storage: memoryStorage() });
		await expect(leuria.connect({ openLink: false, reachMs: 300 })).rejects.toBeInstanceOf(LeuriaNotRunningError);
	});

	it("connects after approval and runs a session with page tools", async () => {
		const leuria = new BridgeClient({ url: URL_, app: "Test", storage: memoryStorage() });
		answerWhenAsked();
		await leuria.connect({ openLink: false });
		expect((await leuria.detect()).status).toBe("ready");

		const seen: string[] = [];
		const events: BridgeEvent[] = [];
		const session = await leuria.startSession({
			prompt: "hello",
			systemPrompt: "test",
			tools: [
				{
					name: "echo",
					description: "Echo the text",
					inputSchema: { type: "object", properties: { text: { type: "string" } } },
					handler: async (args) => {
						seen.push(String(args.text));
						return { echoed: args.text };
					},
				},
			],
			onEvent: (e) => events.push(e),
		});

		const first = await collect(events, "turn_completed");
		expect(first).toMatchObject({ type: "turn_completed", text: 'tool said: {"echoed":"hello"}' });
		expect(seen).toEqual(["hello"]);
		expect(session.status).toBe("idle");

		await session.prompt("again");
		const second = await collect(events, "turn_completed");
		expect(second).toMatchObject({ text: 'tool said: {"echoed":"again"}' });

		// The policy refuses a built-in tool even if the agent asks.
		await session.prompt("run bash");
		const third = await collect(events, "turn_completed");
		expect(third).toMatchObject({ text: "bash: no" });

		session.close();
		expect(session.status).toBe("ended");
	});

	it("drops its token when the visitor revokes the site", async () => {
		const storage = memoryStorage();
		const leuria = new BridgeClient({ url: URL_, storage });
		answerWhenAsked();
		await leuria.connect({ openLink: false });
		expect((await leuria.detect()).status).toBe("ready");
		engine.revoke(SITE);
		expect((await leuria.detect()).status).toBe("unpaired");
		expect(leuria.token()).toBeNull();
		await expect(leuria.startSession({ prompt: "x" })).rejects.toBeInstanceOf(LeuriaNotConnectedError);
	});

});

describe("embeddings through the engine", () => {
	it("tells a connected site its model and embeds for it", async () => {
		const storage = memoryStorage();
		const leuria = new BridgeClient({ url: URL_, storage });
		expect((await leuria.detect()).embed).toBeUndefined();
		answerWhenAsked();
		await leuria.connect({ openLink: false });
		expect((await leuria.detect()).embed).toBe("fake-embed");

		const provider = bridge({ url: URL_, storage });
		await provider.detect();
		expect(provider.getState()).toMatchObject({ status: "ready", embedModel: "fake-embed" });
		expect(provider.getState().capabilities).toContain("embed");
		const texts = Array.from({ length: 300 }, (_, i) => "x".repeat(i % 7));
		const result = await provider.embed({ texts, kind: "document" });
		expect(result.model).toBe("fake-embed");
		expect(result.vectors).toHaveLength(300);
		expect(result.vectors[6]).toEqual([6]);
	});
});

// Last: after a No, the site can't ask again for a while.
describe("a denied connection", () => {
	it("is reported, and the site can't ask again at once", async () => {
		const leuria = new BridgeClient({ url: URL_, storage: memoryStorage() });
		answerWhenAsked(false);
		await expect(leuria.connect({ openLink: false })).rejects.toThrow(/did not allow/);
		await expect(leuria.connect({ openLink: false })).rejects.toThrow(/just said no/);
	});
});
