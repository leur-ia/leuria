import { describe, expect, it } from "vitest";

import { contextFromText, fitOf, recommend, tierFromName, traitsOf } from "../src/fit.js";
import { parseParams } from "../src/llm/providers.js";
import { parseNeeds } from "../src/needs.js";

describe("what a site needs", () => {
	it("keeps only the known words", () => {
		expect(parseNeeds({ tools: "1", images: false, effort: "light", context: "8000", model: "gpt-9", effort2: "x" })).toEqual({ tools: true, effort: "light", context: 8000 });
		expect(parseNeeds({ effort: "extreme" })).toBeUndefined();
		expect(parseNeeds("tools")).toBeUndefined();
	});
});

describe("the catalog", () => {
	it("reads sizes, strengths and context from what services and names say", () => {
		expect(parseParams("27B")).toBe(27);
		expect(parseParams("8x7B")).toBe(56);
		expect(parseParams("500M")).toBe(0.5);
		expect(tierFromName("qwen3.8-27b")).toBe("medium");
		expect(tierFromName("llama3.2:3b")).toBe("small");
		expect(tierFromName("Haiku 4.5", "Haiku 4.5 · Fastest for quick answers")).toBe("small");
		expect(tierFromName("Sonnet 5", "Sonnet 5 · Efficient for routine tasks")).toBe("medium");
		expect(tierFromName("Opus 5.5")).toBe("large");
		expect(tierFromName("Default (recommended)", "Opus (1M context)")).toBe("large");
		expect(tierFromName("5.6 Luna")).toBeUndefined();
		expect(contextFromText("Opus 5.5 with 1M context · Best for everyday, complex tasks")).toBe(1_000_000);
	});

	it("knows what each kind of AI costs", () => {
		expect(traitsOf({ kind: "agent" }, { name: "Sonnet 5" })).toMatchObject({ cost: "plan", tools: true, tier: "medium", local: false });
		expect(traitsOf({ kind: "llm", local: true }, { name: "qwen3.8-27b", meta: { tools: true, images: true, context: 262144, params: 27 } })).toMatchObject({
			cost: "free",
			tier: "medium",
			local: true,
		});
		expect(traitsOf({ kind: "llm", local: false }, { name: "gpt-4o-mini" })).toMatchObject({ cost: "paid", tier: "small", tools: true });
	});
});

describe("fitting a site", () => {
	const needs = parseNeeds({ tools: true, effort: "light" });
	const haiku = traitsOf({ kind: "agent" }, { name: "Haiku 4.5" });
	const opus = traitsOf({ kind: "agent" }, { name: "Opus 5.5" });
	const localBig = traitsOf({ kind: "llm", local: true }, { name: "qwen3.8-27b", meta: { tools: true, params: 27 } });
	const localNoTools = traitsOf({ kind: "llm", local: true }, { name: "tiny", meta: { tools: false, params: 1 } });

	it("says when a model is short, more than needed, or fits", () => {
		expect(fitOf(needs, haiku)).toBe("fits");
		expect(fitOf(needs, opus)).toBe("more");
		// Free on this computer: bigger than needed costs nothing.
		expect(fitOf(needs, localBig)).toBe("fits");
		expect(fitOf(needs, localNoTools)).toBe("short");
		expect(fitOf({ effort: "deep" }, haiku)).toBe("short");
		expect(fitOf({ context: 500_000 }, { ...haiku, context: 200_000 })).toBe("short");
		expect(fitOf(undefined, opus)).toBe("fits");
	});

	it("recommends the cheapest model that is enough", () => {
		const c = (agent: string, model: string, traits: ReturnType<typeof traitsOf>, isDefault = false) => ({ agent, model, traits, isDefault });
		const all = [c("claude-acp", "opus", opus, true), c("claude-acp", "haiku", haiku, true), c("llm:lmstudio", "qwen", localBig), c("llm:lmstudio", "tiny", localNoTools)];
		expect(recommend(needs, all)).toMatchObject({ agent: "llm:lmstudio", model: "qwen" });
		// Without a free model that can use tools, the lightest on the plan.
		expect(recommend(needs, all.filter((x) => x.agent === "claude-acp"))).toMatchObject({ model: "haiku" });
		expect(recommend({ effort: "deep" }, [c("claude-acp", "haiku", haiku)])).toBeUndefined();
	});
});
