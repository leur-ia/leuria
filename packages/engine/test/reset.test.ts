import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetAgent } from "../src/agents.js";
import { geminiHome } from "../src/gemini.js";
import { profileFor } from "../src/profiles.js";

describe("starting over with an agent", () => {
	const home = mkdtempSync(join(tmpdir(), "leuria-reset-"));
	const previous = process.env.LEURIA_HOME;
	beforeAll(() => {
		process.env.LEURIA_HOME = home;
	});
	afterAll(() => {
		process.env.LEURIA_HOME = previous;
		rmSync(home, { recursive: true, force: true });
	});

	it("keeps Gemini's settings and sign-in in Leuria's own folder", () => {
		const env = profileFor("gemini")?.configure?.({ sandbox: home, mcpUrl: "", mcpToken: "" })?.env;
		expect(env).toEqual({ GEMINI_CLI_HOME: join(home, "gemini"), GEMINI_FORCE_FILE_STORAGE: "true" });
		expect(existsSync(geminiHome())).toBe(true);
	});

	it("erases the agent's installs and its Leuria sign-in, and nothing else", () => {
		for (const dir of ["agents/gemini@0.61.0", "agents/gemini@0.60.0", "agents/geminix@1.0.0", "agents/codex-acp@1.0.0"]) {
			mkdirSync(join(home, dir), { recursive: true });
		}
		writeFileSync(join(geminiHome(), "settings.json"), "{}");
		resetAgent("gemini");
		expect(existsSync(geminiHome())).toBe(false);
		expect(existsSync(join(home, "agents/gemini@0.61.0"))).toBe(false);
		expect(existsSync(join(home, "agents/gemini@0.60.0"))).toBe(false);
		expect(existsSync(join(home, "agents/geminix@1.0.0"))).toBe(true);
		expect(existsSync(join(home, "agents/codex-acp@1.0.0"))).toBe(true);
	});
});
