import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { GrantStore, normalizeOrigin } from "../src/grants.js";

const dirs: string[] = [];
function tempFile(): string {
	const dir = mkdtempSync(join(tmpdir(), "leuria-grants-"));
	dirs.push(dir);
	return join(dir, "grants.json");
}
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("GrantStore", () => {
	it("stores only a hash of the token", () => {
		const path = tempFile();
		const token = new GrantStore(path).create("http://localhost:3000/", "Shop");
		const file = readFileSync(path, "utf-8");
		expect(file).not.toContain(token);
		expect(file).toContain("http://localhost:3000");
		expect(new GrantStore(path).verify("http://localhost:3000", token)).toBe(true);
	});

	it("rejects wrong tokens and other origins", () => {
		const store = new GrantStore(null);
		const token = store.create("http://localhost:3000");
		expect(store.verify("http://localhost:3000", "nope")).toBe(false);
		expect(store.verify("http://localhost:3001", token)).toBe(false);
		expect(store.verify("http://localhost:3000", undefined)).toBe(false);
	});

	it("replaces the token when a site pairs again", () => {
		const store = new GrantStore(null);
		const first = store.create("http://localhost:3000");
		const second = store.create("http://localhost:3000");
		expect(store.verify("http://localhost:3000", first)).toBe(false);
		expect(store.verify("http://localhost:3000", second)).toBe(true);
		expect(store.list()).toHaveLength(1);
	});

	it("keeps a site's own AI, and keeps it when the site pairs again", () => {
		const store = new GrantStore(null);
		store.create("https://shop.example");
		expect(store.get("https://shop.example")?.agent).toBeUndefined();
		expect(store.setAgent("https://shop.example", "codex-acp")).toBe(true);
		store.create("https://shop.example");
		expect(store.get("https://shop.example")?.agent).toBe("codex-acp");
		store.setAgent("https://shop.example", undefined);
		expect(store.get("https://shop.example")?.agent).toBeUndefined();
		expect(store.setAgent("https://unknown.example", "x")).toBe(false);
	});

	it("sees a revoke made by another process", async () => {
		const path = tempFile();
		const engine = new GrantStore(path);
		const token = engine.create("http://localhost:3000");
		const removed: string[] = [];
		engine.onRemoved((origin) => removed.push(origin));
		// mtime resolution: make sure the second write is observable
		await new Promise((r) => setTimeout(r, 20));
		new GrantStore(path).revoke("http://localhost:3000");
		expect(engine.verify("http://localhost:3000", token)).toBe(false);
		expect(removed).toEqual(["http://localhost:3000"]);
	});
});

describe("normalizeOrigin", () => {
	it("keeps scheme, host and port only", () => {
		expect(normalizeOrigin("HTTP://LocalHost:3000/path?q")).toBe("http://localhost:3000");
		expect(normalizeOrigin("https://shop.example")).toBe("https://shop.example");
	});

	it("refuses non-web schemes", () => {
		expect(() => normalizeOrigin("chrome-extension://abc")).toThrow();
		expect(() => normalizeOrigin("null")).toThrow();
	});
});
