import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminHandler } from "../src/admin.js";
import { GrantStore } from "../src/grants.js";
import { loadConfig } from "../src/home.js";
import { type EngineHandle, startEngine } from "../src/server.js";

const PORT = 19593;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "t".repeat(40);
const silent = { info: () => {}, warn: () => {}, error: () => {} };
const events: Array<Record<string, unknown>> = [];
const resolvedFor: string[] = [];
let engine: EngineHandle;
let grants: GrantStore;

beforeAll(async () => {
	grants = new GrantStore(null);
	const config = { port: PORT, agent: "claude-acp" };
	engine = await startEngine({
		port: PORT,
		grants,
		logger: silent,
		agentName: "Test agent",
		resolveAgent: async (origin) => {
			resolvedFor.push(origin);
			return { command: "definitely-not-an-agent", args: [] };
		},
		onPairingRequest: (r) => events.push({ event: "pairing", ...r }),
		onPairingDecided: (d) => events.push({ event: "pairing_decided", ...d }),
		admin: { token: TOKEN, handle: createAdminHandler({ config, grants, logger: silent, port: () => PORT, emit: (e) => events.push(e) }) },
	});
});
afterAll(() => engine.close());

const admin = (path: string, init: RequestInit = {}, token = TOKEN) =>
	fetch(`${BASE}/admin${path}`, {
		...init,
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: "tauri://localhost", ...init.headers },
	});

describe("admin API", () => {
	it("saves the embedding model choice; off gives sites none", async () => {
		const set = (choice: unknown) => admin("/embeddings", { method: "POST", body: JSON.stringify({ choice }) });
		expect((await set({ provider: "lmstudio", model: "nomic" })).status).toBe(200);
		expect(((await (await admin("/embeddings")).json()) as { choice: unknown }).choice).toEqual({ provider: "lmstudio", model: "nomic" });
		expect(loadConfig().embed).toEqual({ provider: "lmstudio", model: "nomic" });
		await set("off");
		const off = (await (await admin("/embeddings")).json()) as { choice: unknown; current: unknown };
		expect(off).toMatchObject({ choice: "off", current: null });
		await set("auto");
		expect(loadConfig().embed).toBeUndefined();
		expect(events.at(-1)).toEqual({ event: "embed", choice: "auto" });
		expect((await set("something")).status).toBe(400);
	});

	it("refuses callers without the app's token", async () => {
		expect((await admin("/status", {}, "wrong")).status).toBe(401);
		expect((await fetch(`${BASE}/admin/status`)).status).toBe(401);
	});

	it("stays silent to websites it doesn't know", async () => {
		const health = await fetch(`${BASE}/health`, { headers: { Origin: "https://shop.example" } });
		expect(health.status).toBe(403);
		expect(health.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("answers the app's webview, whatever its origin", async () => {
		const res = await admin("/status");
		expect(res.status).toBe(200);
		expect(res.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
		expect(await res.json()).toMatchObject({ port: PORT, agent: { id: "claude-acp" }, sites: 0, pairing: [] });
	});

	it("takes a leuria://connect link, lets the app approve the site, and the site claims its token", async () => {
		const site = "https://shop.example";
		const nonce = "n".repeat(32);
		expect((await admin("/pairing/link", { method: "POST", body: JSON.stringify({ origin: site, nonce: "short" }) })).status).toBe(400);
		const linked = await admin("/pairing/link", { method: "POST", body: JSON.stringify({ origin: site, app: "Shop", nonce }) });
		expect(linked.status).toBe(201);
		const started = (await linked.json()) as { requestId: string };
		expect(events.at(-1)).toMatchObject({ event: "pairing", requestId: started.requestId, origin: site, app: "Shop" });
		const pending = (await (await admin("/pairing")).json()) as { requests: Array<{ requestId: string }> };
		expect(pending.requests.map((r) => r.requestId)).toEqual([started.requestId]);

		expect((await admin(`/pairing/${started.requestId}`, { method: "POST", body: '{"allow":true}' })).status).toBe(200);
		expect(events.at(-1)).toMatchObject({ event: "pairing_decided", allowed: true });
		const waited = (await (
			await fetch(`${BASE}/connect/claim`, { method: "POST", headers: { Origin: site, "Content-Type": "application/json" }, body: JSON.stringify({ nonce }) })
		).json()) as {
			status: string;
		};
		expect(waited.status).toBe("allowed");

		const sites = (await (await admin("/sites")).json()) as { sites: Array<Record<string, unknown>> };
		expect(sites.sites).toHaveLength(1);
		expect(sites.sites[0]).not.toHaveProperty("tokenHash");
		expect(await (await admin(`/sites?origin=${encodeURIComponent(site)}`, { method: "DELETE" })).json()).toEqual({ removed: true });
		expect(grants.list()).toHaveLength(0);
	});

	it("lets the visitor pick the site's AI and model while allowing it", async () => {
		const site = "https://picked.example";
		const nonce = "p".repeat(32);
		const { requestId } = (await (await admin("/pairing/link", { method: "POST", body: JSON.stringify({ origin: site, nonce }) })).json()) as { requestId: string };
		const allowed = await admin(`/pairing/${requestId}`, { method: "POST", body: JSON.stringify({ allow: true, agent: "llm:lmstudio/qwen", model: "qwen-small" }) });
		expect(allowed.status).toBe(200);
		expect(grants.get(site)).toMatchObject({ agent: "llm:lmstudio/qwen", model: { agent: "llm:lmstudio/qwen", id: "qwen-small" } });
		expect(await admin(`/sites?origin=${encodeURIComponent(site)}`, { method: "DELETE" })).toBeTruthy();
	});

	it("keeps what a site says it needs, and answers how Your AIs fit it", async () => {
		const site = "https://needs.example";
		const nonce = "q".repeat(32);
		const linked = await admin("/pairing/link", {
			method: "POST",
			body: JSON.stringify({ origin: site, nonce, needs: { tools: "1", effort: "light", model: "gpt-9" } }),
		});
		const { requestId } = (await linked.json()) as { requestId: string };
		expect(events.at(-1)).toMatchObject({ event: "pairing", needs: { tools: true, effort: "light" } });
		await admin(`/pairing/${requestId}`, { method: "POST", body: JSON.stringify({ allow: true }) });
		expect(grants.get(site)?.needs).toEqual({ tools: true, effort: "light" });

		const fit = (await (await admin("/fit", { method: "POST", body: JSON.stringify({ origin: site }) })).json()) as {
			needs: unknown;
			ais: Array<{ id: string; verdict: string }>;
		};
		expect(fit.needs).toEqual({ tools: true, effort: "light" });
		// This test's Leuria home has no AI installed: nothing to recommend.
		expect(fit).toMatchObject({ ais: [], recommended: null });
		await admin(`/sites?origin=${encodeURIComponent(site)}`, { method: "DELETE" });
	});

	it("sets a site's AI back to the default, and refuses unknown sites", async () => {
		const unknown = await admin("/sites/agent", { method: "POST", body: JSON.stringify({ origin: "https://nope.example", agent: null }) });
		expect(unknown.status).toBe(404);
		const site = "https://docs.example";
		grants.create(site);
		grants.setAgent(site, "codex-acp");
		// Choosing the default AI (by null or by its id) clears the override.
		const res = await admin("/sites/agent", { method: "POST", body: JSON.stringify({ origin: site, agent: "claude-acp" }) });
		expect(await res.json()).toMatchObject({ agent: null, signIn: { ok: true } });
		expect(grants.get(site)?.agent).toBeUndefined();
	});

	it("gives a site its own model, tied to the site's AI", async () => {
		const site = "https://models.example";
		grants.create(site);
		const res = await admin("/sites/model", { method: "POST", body: JSON.stringify({ origin: site, model: "sonnet" }) });
		expect(await res.json()).toEqual({ origin: site, agent: "claude-acp", model: "sonnet" });
		expect(grants.get(site)?.model).toEqual({ agent: "claude-acp", id: "sonnet" });
		// Pairing again keeps it; null goes back to the AI's own choice.
		grants.create(site);
		expect(grants.get(site)?.model).toEqual({ agent: "claude-acp", id: "sonnet" });
		await admin("/sites/model", { method: "POST", body: JSON.stringify({ origin: site, model: null }) });
		expect(grants.get(site)?.model).toBeUndefined();
		const unknown = await admin("/sites/model", { method: "POST", body: JSON.stringify({ origin: "https://nope.example", model: "x" }) });
		expect(unknown.status).toBe(404);
	});

	it("keeps Your AIs: add, list with the default first, remove (never the default)", async () => {
		// Service models need no install: LM Studio is known without setup.
		const qwen = "llm:lmstudio/qwen3-8b";
		expect((await admin("/ais", { method: "POST", body: JSON.stringify({ id: qwen }) })).status).toBe(200);
		const { ais } = (await (await admin("/ais")).json()) as { ais: Array<{ id: string; default: boolean; kind: string }> };
		expect(ais.find((a) => a.id === qwen)).toMatchObject({ kind: "llm", default: false });
		// A site using it goes back to the default when it is removed.
		const site = "https://uses-qwen.example";
		grants.create(site);
		grants.setAgent(site, qwen);
		expect((await admin(`/ais?id=${encodeURIComponent(qwen)}`, { method: "DELETE" })).status).toBe(200);
		expect(grants.get(site)?.agent).toBeUndefined();
		expect(((await (await admin("/ais")).json()) as { ais: Array<{ id: string }> }).ais.map((a) => a.id)).not.toContain(qwen);
		expect((await admin("/ais?id=claude-acp", { method: "DELETE" })).status).toBe(409);
	});

	it("keeps the previous default in Your AIs, and sites on the new default follow it", async () => {
		const qwen = "llm:lmstudio/qwen3-8b";
		const site = "https://follows.example";
		grants.create(site);
		grants.setAgent(site, qwen);
		grants.setModel(site, { agent: qwen, id: "x" });
		await admin("/agent", { method: "POST", body: JSON.stringify({ id: qwen }) });
		expect(grants.get(site)?.agent).toBeUndefined();
		expect(grants.get(site)?.model).toEqual({ agent: qwen, id: "x" });
		const { ais } = (await (await admin("/ais")).json()) as { ais: Array<{ id: string; default: boolean }> };
		expect(ais[0]).toMatchObject({ id: qwen, default: true });
	});

	it("starts sessions with the agent resolved for the site's origin", async () => {
		const site = "https://docs.example";
		const token = grants.create(site);
		const prepared = (await (
			await fetch(`${BASE}/session/prepare`, {
				method: "POST",
				headers: { Origin: site, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: '{"prompt":"x"}',
			})
		).json()) as { sessionId: string };
		await fetch(`${BASE}/session/${prepared.sessionId}/approve`, {
			method: "POST",
			headers: { Origin: site, Authorization: `Bearer ${token}` },
		});
		await new Promise((r) => setTimeout(r, 50));
		expect(resolvedFor).toContain(site);
	});
});
