import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FAKE_AGENT = fileURLToPath(new URL("./fixtures/fake-agent.mjs", import.meta.url));
const agentEnv: Record<string, string> = {};

vi.mock("../src/agents.js", () => ({
	agentName: () => "Fake",
	ensureAgent: async () => ({ id: "fake-ai", name: "Fake", command: process.execPath, launchArgs: [FAKE_AGENT], args: [], env: agentEnv }),
}));

const { checkSignIn } = await import("../src/auth.js");
const { macScript, windowsScript } = await import("../src/terminal-window.js");

describe("whether an agent is signed in", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "leuria-state-"));
		process.env.LEURIA_HOME = dir;
	});
	afterEach(() => {
		for (const key of Object.keys(agentEnv)) delete agentEnv[key];
		rmSync(dir, { recursive: true, force: true });
	});

	it("believes an agent that reports it is signed out, although it opened a session", async () => {
		agentEnv.FAKE_AUTH_STATUS = "none";
		agentEnv.FAKE_TERMINAL_AUTH = "only";
		const status = await checkSignIn("fake-ai", undefined, { quiet: true });
		expect(status).toMatchObject({ ok: false, detail: "not signed in", methods: [] });
		// Its only sign-in is on the command line: a window, where Leuria can open one.
		expect(status.window).toBe(process.platform === "darwin" || process.platform === "win32");
	});

	it("keeps the browser sign-in when an agent has one, even with a command-line one", async () => {
		agentEnv.FAKE_AUTH_STATUS = "none";
		agentEnv.FAKE_TERMINAL_AUTH = "1";
		const status = await checkSignIn("fake-ai", undefined, { quiet: true });
		expect(status.methods.map((m) => m.id)).toEqual(["account"]);
		expect(status.window).toBeUndefined();
	});

	it("is ready when the agent reports a sign-in", async () => {
		agentEnv.FAKE_AUTH_STATUS = "account";
		const status = await checkSignIn("fake-ai", undefined, { quiet: true });
		expect(status).toMatchObject({ ok: true, detail: "ready" });
	});

	it("doesn't wait for a report from an agent that makes none", async () => {
		const started = Date.now();
		const status = await checkSignIn("fake-ai", undefined, { quiet: true });
		expect(status.ok).toBe(true);
		expect(Date.now() - started).toBeLessThan(4_000);
	});
});

describe("the sign-in window's script", () => {
	const options = {
		title: "Sign in to Claude",
		command: "C:\\Users\\Jane Doe\\Leuria\\leuria-engine.exe",
		args: ["C:\\agents\\index.js", "--cli", "auth", "login", "100%"],
		env: { BUN_BE_BUN: "1", ODD: "a&b 50%" },
		cwd: "C:\\Temp\\leuria-auth-x",
	};

	it("keeps paths with spaces whole and % literal on Windows", () => {
		const script = windowsScript(options, "C:\\Temp\\done");
		expect(script).toContain('"C:\\Users\\Jane Doe\\Leuria\\leuria-engine.exe" "C:\\agents\\index.js" "--cli" "auth" "login" "100%%"');
		expect(script).toContain('set "ODD=a&b 50%%"');
		expect(script).toContain('echo %errorlevel%> "C:\\Temp\\done"');
		expect(script.split("\r\n")[0]).toBe("@echo off");
	});

	it("quotes everything for the shell on macOS", () => {
		const script = macScript({ ...options, command: "/Applications/Leuria.app/Contents/MacOS/leuria-engine", args: ["it's", "--cli"] }, "/tmp/done");
		expect(script).toContain("'/Applications/Leuria.app/Contents/MacOS/leuria-engine' 'it'\\''s' '--cli'");
		expect(script).toContain("export ODD='a&b 50%'");
		expect(script).toContain("echo $? > '/tmp/done'");
	});
});
