import { describe, expect, it } from "vitest";

import { agentMethods, preferredMethod } from "../src/auth.js";

describe("ACP v1 sign-in methods", () => {
	const codex = [
		{ id: "api-key", name: "API Key", _meta: { "api-key": { provider: "openai" } } },
		{ id: "chat-gpt", name: "ChatGPT" },
	];

	it("prefers an account sign-in over an API key", () => {
		expect(preferredMethod(codex)?.id).toBe("chat-gpt");
	});

	it("never offers terminal methods, which must not go to authenticate", () => {
		const methods = [{ id: "tui", name: "Log in", type: "terminal" as const }, ...codex];
		expect(agentMethods(methods).map((m) => m.id)).toEqual(["api-key", "chat-gpt"]);
		expect(preferredMethod([{ id: "tui", name: "Log in", type: "terminal" as const }])).toBeUndefined();
	});

	it("treats methods without a type as agent methods", () => {
		expect(agentMethods([{ id: "a", name: "A" }, { id: "b", name: "B" }])).toHaveLength(2);
	});
});
