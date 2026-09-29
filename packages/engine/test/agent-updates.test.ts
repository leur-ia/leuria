import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { clearRegistryCache } from "../src/acp/registry.js";
import { installedAgent, pruneAgentVersions, updateAgents } from "../src/agents.js";

function fakeInstall(home: string, id: string, version: string): void {
	const dir = join(home, "agents", `${id}@${version}`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "leuria-agent.json"), JSON.stringify({ id, name: id, version, dir, command: "node", launchArgs: [], args: [], env: {} }));
}

function registry(agents: Array<{ id: string; version: string }>): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(JSON.stringify({ agents: agents.map((a) => ({ ...a, name: a.id, distribution: { npx: { package: `${a.id}@${a.version}` } } })) }))),
	);
}

describe("keeping installed AIs up to date", () => {
	const home = mkdtempSync(join(tmpdir(), "leuria-updates-"));
	const previous = process.env.LEURIA_HOME;
	beforeAll(() => {
		process.env.LEURIA_HOME = home;
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		clearRegistryCache();
		rmSync(join(home, "agents"), { recursive: true, force: true });
	});
	afterAll(() => {
		process.env.LEURIA_HOME = previous;
		rmSync(home, { recursive: true, force: true });
	});

	it("keeps only the newest version of each AI, comparing versions as numbers", () => {
		fakeInstall(home, "claude-acp", "0.9.0");
		fakeInstall(home, "claude-acp", "0.81.2");
		fakeInstall(home, "claude-acp", "0.84.0");
		fakeInstall(home, "codex-acp", "2.0.0");
		pruneAgentVersions();
		expect(readdirSync(join(home, "agents")).sort()).toEqual(["claude-acp@0.84.0", "codex-acp@2.0.0"]);
		expect(installedAgent("claude-acp")?.version).toBe("0.84.0");
	});

	it("leaves an AI alone when the registry has nothing newer, or doesn't list it", async () => {
		fakeInstall(home, "claude-acp", "0.84.0");
		fakeInstall(home, "private-agent", "1.0.0");
		registry([{ id: "claude-acp", version: "0.84.0" }]);
		const updated = vi.fn();
		await updateAgents(updated);
		expect(updated).not.toHaveBeenCalled();
		expect(readdirSync(join(home, "agents")).sort()).toEqual(["claude-acp@0.84.0", "private-agent@1.0.0"]);
	});

	it("keeps the current version when the registry can't be reached", async () => {
		fakeInstall(home, "claude-acp", "0.81.2");
		vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
		const updated = vi.fn();
		await updateAgents(updated);
		expect(updated).not.toHaveBeenCalled();
		expect(existsSync(join(home, "agents", "claude-acp@0.81.2", "leuria-agent.json"))).toBe(true);
	});
});
