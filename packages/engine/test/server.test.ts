import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { GrantStore } from "../src/grants.js";
import { type EngineHandle, startEngine } from "../src/server.js";

const PORT = 19599;
const BASE = `http://127.0.0.1:${PORT}`;
const SELF = `http://127.0.0.1:${PORT}`;
const SITE = "http://localhost:3000";
const OTHER = "https://evil.example";
const silent = { info: () => {}, warn: () => {}, error: () => {} };

let engine: EngineHandle;
let grants: GrantStore;

beforeAll(async () => {
	grants = new GrantStore(null);
	engine = await startEngine({
		port: PORT,
		grants,
		logger: silent,
		agentName: "Test agent",
		resolveAgent: async () => ({ command: "definitely-not-an-agent", args: [] }),
		embeddings: {
			find: async () => ({ provider: { id: "lmstudio", kind: "lmstudio", name: "LM Studio", baseUrl: "http://127.0.0.1:1/v1" }, model: "fake-embed" }),
			embed: async (texts, kind) => ({ model: "fake-embed", vectors: texts.map((t) => [t.length, kind === "query" ? 1 : 0]) }),
		},
	});
});
afterAll(() => engine.close());

function json(res: Response) {
	return res.json() as Promise<Record<string, unknown>>;
}

function post(path: string, origin: string | null, body: unknown = {}, token?: string) {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (origin) headers.Origin = origin;
	if (token) headers.Authorization = `Bearer ${token}`;
	return fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

const nonce = () => randomBytes(24).toString("base64url");

/** The CLI way: the page's claim asks the visitor. Returns the running claim and the request it opened. */
async function ask(origin: string, app = "Test site", on = engine) {
	const secret = nonce();
	const claim = fetch(`http://127.0.0.1:${on.port}/connect/claim`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: origin },
		body: JSON.stringify({ nonce: secret, app }),
	});
	let requestId: string | undefined;
	for (let i = 0; i < 100 && !requestId; i++) {
		requestId = on.pairing.pending().find((r) => r.origin === origin)?.requestId;
		if (!requestId) await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return { claim, requestId: requestId!, nonce: secret };
}

/** Pair `origin` through the real flow: the page claims, the visitor decides on the engine's page, the claim answers. */
async function pair(origin: string, allow = true): Promise<Record<string, unknown>> {
	const { claim, requestId } = await ask(origin);
	const page = await fetch(`${BASE}/connect/${requestId}`);
	expect(await page.text()).toContain(origin);
	const decided = await post(`/connect/${requestId}/decide`, SELF, { allow });
	expect(decided.status).toBe(200);
	return json(await claim);
}

/** Answer a question a test left open, so its claim returns. */
async function settle(asked: { claim: Promise<Response>; requestId: string }) {
	engine.pairing.decideById(asked.requestId, false);
	await asked.claim;
}

describe("host and origin checks", () => {
	it("serves health to anyone, without pairing state for local callers", async () => {
		const local = await json(await fetch(`${BASE}/health`));
		expect(local.ok).toBe(true);
		expect(local.paired).toBeUndefined();
		const site = await fetch(`${BASE}/health`, { headers: { Origin: OTHER } });
		expect(site.headers.get("access-control-allow-origin")).toBe(OTHER);
		expect((await json(site)).paired).toBe(false);
	});

	it("rejects a rebound Host header", async () => {
		const { request } = await import("node:http");
		const status = await new Promise<number>((resolve, reject) => {
			const req = request(
				{ host: "127.0.0.1", port: PORT, path: "/health", headers: { Host: `evil.example:${PORT}` } },
				(res) => resolve(res.statusCode ?? 0),
			);
			req.on("error", reject);
			req.end();
		});
		expect(status).toBe(403);
	});

	it("refuses sessions to unpaired sites", async () => {
		const res = await post("/session/prepare", OTHER, { prompt: "x" });
		expect(res.status).toBe(401);
		expect((await json(res)).code).toBe("not_paired");
	});

	it("refuses WebSocket upgrades from unpaired sites", async () => {
		const code = await new Promise<number>((resolve) => {
			const ws = new WebSocket(`ws://127.0.0.1:${PORT}/webmcp/register`, { headers: { Origin: OTHER } });
			ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
			ws.on("open", () => resolve(101));
			ws.on("error", () => {});
		});
		expect(code).toBe(403);
	});

	it("keeps the agent MCP endpoint away from browsers and token-less callers", async () => {
		const rpc = { jsonrpc: "2.0", id: 1, method: "tools/list" };
		expect((await post("/webmcp/mcp", null, rpc)).status).toBe(401);
		expect((await post("/webmcp/mcp", OTHER, rpc)).status).toBe(401);
	});
});

describe("pairing", () => {
	it("gives the site a token after the visitor allows it", async () => {
		const result = await pair(SITE);
		expect(result.status).toBe("allowed");
		expect(typeof result.token).toBe("string");
		const health = await fetch(`${BASE}/health`, {
			headers: { Origin: SITE, Authorization: `Bearer ${result.token as string}` },
		});
		expect((await json(health)).paired).toBe(true);
	});

	it("gives nothing when the visitor denies, and lets the site ask again only later", async () => {
		const result = await pair("http://localhost:4000", false);
		expect(result).toEqual({ status: "denied" });
		expect(grants.has("http://localhost:4000")).toBe(false);
		expect((await post("/connect/claim", "http://localhost:4000", { nonce: nonce() })).status).toBe(429);
	});

	it("needs a nonce, from a web page", async () => {
		expect((await post("/connect/claim", SITE, {})).status).toBe(400);
		expect((await post("/connect/claim", null, { nonce: nonce() })).status).toBe(400);
		expect((await post("/connect/claim", SELF, { nonce: nonce() })).status).toBe(400);
		// The old flow is gone: a site asks through /connect/claim only.
		expect((await post("/connect", SITE, { app: "Old flow" })).status).toBe(401);
	});

	it("only lets the engine's own page decide", async () => {
		const asked = await ask(OTHER);
		expect((await post(`/connect/${asked.requestId}/decide`, OTHER, { allow: true })).status).toBe(403);
		expect((await post(`/connect/${asked.requestId}/decide`, null, { allow: true })).status).toBe(403);
		expect(grants.has(OTHER)).toBe(false);
		await settle(asked);
	});

	it("asks once per site: trying again updates the question", async () => {
		const first = await ask("http://localhost:5000");
		const second = await ask("http://localhost:5000");
		expect(second.requestId).toBe(first.requestId);
		await post(`/connect/${first.requestId}/decide`, SELF, { allow: true });
		// The latest nonce collects the token; the earlier one no longer matches.
		expect(await json(await second.claim)).toMatchObject({ status: "allowed" });
		expect((await first.claim).status).toBe(404);
	});

	it("lets the approval page (not other sites) see whether the visitor answered elsewhere", async () => {
		const health = (await json(await fetch(`${BASE}/health`, { headers: { Origin: OTHER } }))) as { approvals?: string };
		expect(health.approvals).toBe("page");
		const asked = await ask("http://localhost:6100");
		const own = await fetch(`${BASE}/connect/${asked.requestId}/state`);
		expect(await json(own)).toEqual({ decision: "pending" });
		const foreign = await fetch(`${BASE}/connect/${asked.requestId}/state`, { headers: { Origin: OTHER } });
		expect(foreign.status).toBe(403);
		const page = await (await fetch(`${BASE}/connect/${asked.requestId}`)).text();
		expect(page).toContain("It can't");
		expect(page).toContain("Not now");
		await settle(asked);
	});

	it("serves the approval page unframeable, with the app name escaped", async () => {
		const asked = await ask("http://localhost:6001", "<img src=x onerror=alert(1)>");
		const page = await fetch(`${BASE}/connect/${asked.requestId}`);
		expect(page.headers.get("x-frame-options")).toBe("DENY");
		expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
		expect(await page.text()).not.toContain("<img");
		await settle(asked);
	});
});

describe("a silent engine (the desktop app)", () => {
	const port = 19591;
	const base = `http://127.0.0.1:${port}`;
	let quiet: EngineHandle;
	let quietGrants: GrantStore;

	beforeAll(async () => {
		quietGrants = new GrantStore(null);
		quiet = await startEngine({
			port,
			grants: quietGrants,
			logger: silent,
			agentName: "Test agent",
			resolveAgent: async () => ({ command: "definitely-not-an-agent", args: [] }),
			admin: { token: "t".repeat(40), handle: async () => false },
		});
	});
	afterAll(() => quiet.close());

	const claim = (origin: string, body: unknown) =>
		fetch(`${base}/connect/claim`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });

	it("tells a site it never met nothing a page could read", async () => {
		for (const res of [
			await fetch(`${base}/health`, { headers: { Origin: OTHER } }),
			await fetch(`${base}/health`, { method: "OPTIONS", headers: { Origin: OTHER, "Access-Control-Request-Method": "GET" } }),
			await claim(OTHER, { nonce: nonce() }),
			await fetch(`${base}/admin/status`, { headers: { Origin: OTHER } }),
		]) {
			expect(res.status).toBe(403);
			expect(res.headers.get("access-control-allow-origin")).toBeNull();
			expect(await res.text()).toBe("");
		}
	});

	it("answers the site a link named, with that link's nonce only, and hands the token out once", async () => {
		const secret = nonce();
		const linked = quiet.pairing.link({ origin: SITE, app: "Shop", nonce: secret });
		expect(linked).toHaveProperty("requestId");
		// Another site, even with the nonce, still hears nothing.
		expect((await claim(OTHER, { nonce: secret })).headers.get("access-control-allow-origin")).toBeNull();
		const wrong = await claim(SITE, { nonce: nonce() });
		expect(wrong.status).toBe(404);
		expect(wrong.headers.get("access-control-allow-origin")).toBe(SITE);

		const waiting = claim(SITE, { nonce: secret });
		quiet.pairing.decideById((linked as { requestId: string }).requestId, true);
		const result = (await (await waiting).json()) as { status: string; token: string };
		expect(result.status).toBe("allowed");
		expect((await claim(SITE, { nonce: secret })).status).toBe(404);

		const health = await fetch(`${base}/health`, { headers: { Origin: SITE, Authorization: `Bearer ${result.token}` } });
		expect(health.headers.get("access-control-allow-origin")).toBe(SITE);
		expect(((await health.json()) as { paired: boolean }).paired).toBe(true);
	});

	it("checks the links it gets", () => {
		expect(quiet.pairing.link({ origin: "javascript:alert(1)", nonce: nonce() })).toHaveProperty("error");
		expect(quiet.pairing.link({ origin: base, nonce: nonce() })).toHaveProperty("error");
		expect(quiet.pairing.link({ origin: "https://shop.example", nonce: "short" })).toHaveProperty("error");
		const first = quiet.pairing.link({ origin: "https://shop.example/some/page", nonce: nonce() }) as { requestId: string };
		const again = quiet.pairing.link({ origin: "https://SHOP.example", nonce: nonce() }) as { requestId: string };
		expect(again.requestId).toBe(first.requestId);
		quiet.pairing.decideById(first.requestId, false);
		expect(quiet.pairing.link({ origin: "https://shop.example", nonce: nonce() })).toHaveProperty("error");
	});

	it("lets the app's own webview read its admin API", async () => {
		const res = await fetch(`${base}/admin/status`, { headers: { Origin: "tauri://localhost" } });
		expect(res.status).toBe(401);
		expect(res.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
	});
});

describe("embeddings", () => {
	it("are only for connected sites, which hear the model in health", async () => {
		const origin = "http://embed.test";
		expect((await post("/embed", origin, { texts: ["a"] })).status).toBe(401);
		expect((await json(await fetch(`${BASE}/health`, { headers: { Origin: origin } }))).embed).toBeUndefined();
		const { token } = await pair(origin);
		const health = await json(await fetch(`${BASE}/health`, { headers: { Origin: origin, Authorization: `Bearer ${token}` } }));
		expect(health.embed).toBe("fake-embed");
		const res = await post("/embed", origin, { texts: ["mug", "teapot"], kind: "query" }, token as string);
		expect(await json(res)).toEqual({ model: "fake-embed", vectors: [[3, 1], [6, 1]] });
	});

	it("reject malformed requests", async () => {
		const origin = "http://embed-bad.test";
		const { token } = await pair(origin);
		for (const body of [{}, { texts: [] }, { texts: [1] }, { texts: ["a"], kind: "other" }]) {
			expect((await post("/embed", origin, body, token as string)).status).toBe(400);
		}
	});
});

describe("sessions", () => {
	it("belong to the origin that prepared them", async () => {
		const { token } = await pair("http://localhost:7000");
		const { token: otherToken } = await pair("http://localhost:7001");
		const res = await post("/session/prepare", "http://localhost:7000", { prompt: "hello" }, token as string);
		expect(res.status).toBe(201);
		const body = await json(res);
		const reg = JSON.parse(Buffer.from(body.registrationToken as string, "base64").toString());
		expect(reg.server).toBe(`ws://127.0.0.1:${PORT}`);

		const peek = await fetch(`${BASE}/session/${body.sessionId as string}`, {
			headers: { Origin: "http://localhost:7001", Authorization: `Bearer ${otherToken as string}` },
		});
		expect(peek.status).toBe(404);

		const cancel = await post(`/session/${body.sessionId as string}/cancel`, "http://localhost:7000", {}, token as string);
		expect((await json(cancel)).status).toBe("cancelled");
	});

	it("ignore any agent the page asks for", async () => {
		const { token } = await pair("http://localhost:7002");
		const res = await post(
			"/session/prepare",
			"http://localhost:7002",
			{ prompt: "hello", agent: "sh", agentArgs: ["-c", "touch /tmp/pwned"] },
			token as string,
		);
		const body = await json(res);
		const info = await json(
			await fetch(`${BASE}/session/${body.sessionId as string}`, {
				headers: { Origin: "http://localhost:7002", Authorization: `Bearer ${token as string}` },
			}),
		);
		expect(info).not.toHaveProperty("agentCommand");
		await post(`/session/${body.sessionId as string}/cancel`, "http://localhost:7002", {}, token as string);
	});

	it("end when the site's grant is revoked", async () => {
		const origin = "http://localhost:7003";
		const { token } = await pair(origin);
		const { sessionId } = await json(await post("/session/prepare", origin, { prompt: "hello" }, token as string));
		expect(engine.revoke(origin)).toBe(true);
		expect(engine.sessions.get(sessionId as string)?.status).toBe("cancelled");
		expect((await post("/session/prepare", origin, { prompt: "x" }, token as string)).status).toBe(401);
	});

	it("are capped per origin", async () => {
		const origin = "http://localhost:7004";
		const { token } = await pair(origin);
		const statuses: number[] = [];
		for (let i = 0; i < 5; i++) {
			statuses.push((await post("/session/prepare", origin, { prompt: "x" }, token as string)).status);
		}
		expect(statuses).toEqual([201, 201, 201, 201, 400]);
		engine.revoke(origin);
	});
});

describe("sessions with the agent", () => {
	const FAKE_AGENT = new URL("./fixtures/fake-agent.mjs", import.meta.url).pathname;
	const AGENT_PORT = 19596;
	const AGENT_BASE = `http://127.0.0.1:${AGENT_PORT}`;
	let agentEngine: EngineHandle;

	beforeAll(async () => {
		agentEngine = await startEngine({
			port: AGENT_PORT,
			grants: new GrantStore(null),
			logger: silent,
			agentName: "Fake agent",
			resolveAgent: async () => ({ command: process.execPath, args: [FAKE_AGENT] }),
		});
	});
	afterAll(() => agentEngine.close());

	/** Local caller (no Origin): collect SSE events until `until`. */
	async function events(sessionId: string, until: string): Promise<Array<[string, unknown]>> {
		const res = await fetch(`${AGENT_BASE}/session/${sessionId}/stream`);
		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		const seen: Array<[string, unknown]> = [];
		let buf = "";
		for (;;) {
			const { value, done } = await reader.read();
			if (done) return seen;
			buf += decoder.decode(value, { stream: true });
			let i: number;
			while ((i = buf.indexOf("\n\n")) >= 0) {
				const block = buf.slice(0, i);
				buf = buf.slice(i + 2);
				const name = /^event: (.*)$/m.exec(block)![1]!;
				seen.push([name, JSON.parse(/^data: (.*)$/m.exec(block)![1]!)]);
				if (name === until || name === "failed") {
					await reader.cancel();
					return seen;
				}
			}
		}
	}

	async function local(path: string, body: unknown = {}) {
		const res = await fetch(`${AGENT_BASE}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		return { status: res.status, body: await json(res) };
	}

	it("start without a prompt, emit ready, then take turns with attachments and thoughts", async () => {
		const { body } = await local("/session/prepare", {});
		const id = body.sessionId as string;
		const ready = events(id, "ready");
		await local(`/session/${id}/approve`);
		expect((await ready).map(([e]) => e)).toContain("ready");

		const turn = events(id, "turn_completed");
		await local(`/session/${id}/prompt`, {
			prompt: "BLOCKS",
			attachments: [
				{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
				{ type: "text", name: "notes.txt", text: "hello" },
			],
		});
		const completed = (await turn).find(([e]) => e === "turn_completed")![1] as { text: string };
		expect(completed.text).toMatch(/^text:6,image:image\/png,text:\d+$/);

		const thinking = events(id, "turn_completed");
		await local(`/session/${id}/prompt`, { prompt: "THINK" });
		expect((await thinking).filter(([e]) => e === "thought")).toEqual([["thought", "pondering"]]);
		await local(`/session/${id}/close`);
	});

	it("rejects malformed attachments", async () => {
		const { status, body } = await local("/session/prepare", { attachments: [{ type: "exe", data: "x" }] });
		expect(status).toBe(400);
		expect(body.error).toMatch(/attachments\[0\]/);
	});
});

describe("MCP endpoint for agents", () => {
	/** Prepare a session and exchange its registration token for a channel token. */
	async function channelToken(): Promise<string> {
		const res = await fetch(`${BASE}/session/prepare`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt: "x" }),
		});
		const { registrationToken } = (await res.json()) as { registrationToken: string };
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${PORT}/webmcp/register`);
			ws.on("open", () => ws.send(JSON.stringify({ type: "register", token: registrationToken })));
			ws.on("message", (d) => {
				ws.close();
				resolve((JSON.parse(d.toString()) as { token: string }).token);
			});
			ws.on("error", reject);
		});
	}

	function rpc(token: string, body: unknown) {
		return fetch(`${BASE}/webmcp/mcp`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify(body),
		});
	}

	it("answers notifications with an empty 202, as strict MCP clients (Codex) require", async () => {
		const token = await channelToken();
		const res = await rpc(token, { jsonrpc: "2.0", method: "notifications/initialized" });
		expect(res.status).toBe(202);
		expect(await res.text()).toBe("");
	});

	it("negotiates the protocol version the client asks for, when known", async () => {
		const token = await channelToken();
		const known = await (await rpc(token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).json();
		expect((known as { result: { protocolVersion: string } }).result.protocolVersion).toBe("2025-06-18");
		const unknown = await (await rpc(token, { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } })).json();
		expect((unknown as { result: { protocolVersion: string } }).result.protocolVersion).toBe("2025-06-18");
	});
});

describe("agents without HTTP MCP", () => {
	const FAKE_AGENT = new URL("./fixtures/fake-agent.mjs", import.meta.url).pathname;
	const TSX = new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url).pathname;
	const CLI = new URL("../src/cli.ts", import.meta.url).pathname;
	const STDIO_PORT = 19594;
	let stdioEngine: EngineHandle;

	beforeAll(async () => {
		stdioEngine = await startEngine({
			port: STDIO_PORT,
			grants: new GrantStore(null),
			logger: silent,
			agentName: "Fake agent",
			resolveAgent: async () => ({ command: process.execPath, args: [FAKE_AGENT], env: { FAKE_NO_HTTP: "1" } }),
			stdioMcpCommand: { command: process.execPath, args: [TSX, CLI, "mcp-stdio"] },
		});
	});
	afterAll(() => stdioEngine.close());

	it("reach the page tools through the stdio relay", async () => {
		const base = `http://127.0.0.1:${STDIO_PORT}`;
		const prepared = (await (
			await fetch(`${base}/session/prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "blue" }) })
		).json()) as { sessionId: string; registrationToken: string };
		const channel = await new Promise<WebSocket>((resolve) => {
			const reg = new WebSocket(`ws://127.0.0.1:${STDIO_PORT}/webmcp/register`);
			reg.on("open", () => reg.send(JSON.stringify({ type: "register", token: prepared.registrationToken })));
			reg.on("message", (d) => {
				const m = JSON.parse(d.toString()) as { channel: string; token: string };
				reg.close();
				const ch = new WebSocket(`ws://127.0.0.1:${STDIO_PORT}${m.channel}?token=${m.token}`);
				ch.on("open", () => {
					ch.send(JSON.stringify({ type: "registerTool", name: "lookup", description: "", inputSchema: { type: "object" } }));
					resolve(ch);
				});
				ch.on("message", (raw) => {
					const call = JSON.parse(raw.toString()) as { type: string; id: string; arguments: { text: string } };
					if (call.type === "callTool") ch.send(JSON.stringify({ type: "toolResponse", id: call.id, result: { via: "stdio", text: call.arguments.text } }));
				});
			});
		});
		const stream = await fetch(`${base}/session/${prepared.sessionId}/stream`);
		await fetch(`${base}/session/${prepared.sessionId}/approve`, { method: "POST" });
		const reader = stream.body!.getReader();
		const decoder = new TextDecoder();
		let text = "";
		while (!text.includes("turn_completed")) text += decoder.decode((await reader.read()).value, { stream: true });
		await reader.cancel();
		expect(text).toContain('tool said: {\\"via\\":\\"stdio\\",\\"text\\":\\"blue\\"}');
		channel.close();
		await fetch(`${base}/session/${prepared.sessionId}/close`, { method: "POST" });
	}, 20_000);
});
