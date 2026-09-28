import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkSignIn } from "../src/auth.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/fake-agent.mjs", import.meta.url));

describe("checking an AI that never answers", () => {
	const home = mkdtempSync(join(tmpdir(), "leuria-timeout-"));
	// Its own copy, so other tests' fake agents are not counted as leftovers.
	const FAKE_AGENT = join(home, "hanging-agent.mjs");
	const saved = { home: process.env.LEURIA_HOME, timeout: process.env.LEURIA_CHECK_TIMEOUT_MS };
	beforeAll(() => {
		process.env.LEURIA_HOME = home;
		process.env.LEURIA_CHECK_TIMEOUT_MS = "800";
		copyFileSync(FIXTURE, FAKE_AGENT);
		const dir = join(home, "agents", "hangs@1.0.0");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "leuria-agent.json"),
			JSON.stringify({ id: "hangs", name: "Hangs", version: "1.0.0", dir, command: process.execPath, launchArgs: [FAKE_AGENT], args: [], env: { FAKE_HANG: "1" } }),
		);
	});
	afterAll(() => {
		process.env.LEURIA_HOME = saved.home;
		if (saved.timeout === undefined) delete process.env.LEURIA_CHECK_TIMEOUT_MS;
		else process.env.LEURIA_CHECK_TIMEOUT_MS = saved.timeout;
		rmSync(home, { recursive: true, force: true });
	});

	it("gives up in time, says so plainly, and stops the agent", async () => {
		const started = Date.now();
		const status = await checkSignIn("hangs");
		expect(Date.now() - started).toBeLessThan(3000);
		expect(status).toMatchObject({ ok: false, detail: "Hangs didn't answer. It may need to be set up in its own app first." });
		await new Promise((r) => setTimeout(r, 300));
		const running = execFileSync("ps", ["-Ao", "command"], { encoding: "utf-8" }).split("\n").filter((l) => l.includes(FAKE_AGENT));
		expect(running).toEqual([]);
	});
});
