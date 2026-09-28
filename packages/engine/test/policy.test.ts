import { describe, expect, it } from "vitest";

import { buildSessionMeta, decidePermission } from "../src/policy.js";

const options = [
	{ optionId: "allow", kind: "allow_once" },
	{ optionId: "always", kind: "allow_always" },
	{ optionId: "reject", kind: "reject_once" },
];

describe("decidePermission", () => {
	it("allows WebMCP tools", () => {
		const d = decidePermission({
			toolCall: { _meta: { claudeCode: { toolName: "mcp__webmcp__runQuery" } } },
			options,
		});
		expect(d.allow).toBe(true);
		expect(d.response).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
	});

	it("rejects built-in tools", () => {
		const d = decidePermission({ toolCall: { title: "Bash", rawInput: { command: "ls ~" } }, options });
		expect(d.allow).toBe(false);
		expect(d.response).toEqual({ outcome: { outcome: "selected", optionId: "reject" } });
	});

	it("rejects tools from other MCP servers", () => {
		const d = decidePermission({ toolCall: { title: "mcp__gmail__send_message" }, options });
		expect(d.allow).toBe(false);
	});

	it("does not trust a look-alike prefix", () => {
		const d = decidePermission({ toolCall: { title: "mcp__webmcpx__runQuery" }, options });
		expect(d.allow).toBe(false);
	});

	it("cancels when no reject option exists", () => {
		const d = decidePermission({ toolCall: { title: "Write" }, options: [{ optionId: "ok", kind: "allow_once" }] });
		expect(d.allow).toBe(false);
		expect(d.response).toEqual({ outcome: { outcome: "cancelled" } });
	});

	it("never allows when the allow option is missing", () => {
		const d = decidePermission({ toolCall: { title: "mcp__webmcp__runQuery" }, options: [] });
		expect(d.allow).toBe(false);
	});
});

describe("buildSessionMeta", () => {
	it("removes built-in tools, user settings and bypass mode", () => {
		const meta = buildSessionMeta({ systemPrompt: "compose views", model: "sonnet" });
		const opts = (meta.claudeCode as { options: Record<string, unknown> }).options;
		expect(opts.tools).toEqual([]);
		expect(opts.settingSources).toEqual([]);
		expect(opts.strictMcpConfig).toBe(true);
		expect(opts.allowDangerouslySkipPermissions).toBe(false);
		expect(opts.allowedTools).toEqual(["mcp__webmcp"]);
		expect(opts.disallowedTools).toContain("Bash");
		expect(opts.model).toBe("sonnet");
		expect(meta.systemPrompt).toBe("compose views");
	});
});
