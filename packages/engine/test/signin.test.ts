import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FAKE_AGENT = fileURLToPath(new URL("./fixtures/fake-agent.mjs", import.meta.url));
const agentEnv: Record<string, string> = {};

// The fake agent stands in for one installed from the registry.
vi.mock("../src/agents.js", () => ({
	agentName: () => "Fake",
	ensureAgent: async () => ({ id: "fake-ai", name: "Fake", command: process.execPath, launchArgs: [FAKE_AGENT], args: [], env: agentEnv }),
}));

const { signIn } = await import("../src/auth.js");

describe("signing in to an agent", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "leuria-signin-"));
		process.env.LEURIA_HOME = dir;
		process.env.LEURIA_SIGNIN_STALL_MS = "300";
	});
	afterEach(() => {
		delete process.env.LEURIA_SIGNIN_STALL_MS;
		delete agentEnv.FAKE_STALL_ONCE;
		rmSync(dir, { recursive: true, force: true });
	});

	it("starts the agent again when it opens no sign-in page, and signs in", async () => {
		const marker = join(dir, "stalled");
		agentEnv.FAKE_STALL_ONCE = marker;
		const status = await signIn("fake-ai", { onUrl: () => {} });
		expect(existsSync(marker)).toBe(true);
		expect(status).toMatchObject({ ok: true });
	});

	it("signs in at once when the agent answers", async () => {
		const status = await signIn("fake-ai", { onUrl: () => {} });
		expect(status).toMatchObject({ ok: true });
	});
});
