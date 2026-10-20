import { describe, expect, it } from "vitest";

import { dynamicCeiling, isDynamic, forDynamic } from "../src/ais.js";
import { type Candidate, recommend } from "../src/fit.js";

const c = (agent: string, cost: Candidate["traits"]["cost"], tier: "small" | "medium" | "large"): Candidate => ({ agent, traits: { cost, tier, local: cost === "free" }, isDefault: false });

describe("dynamic selection", () => {
	it("reads the ceiling from the site's agent id", () => {
		expect(isDynamic("dynamic")).toBe(true);
		expect(isDynamic("dynamic:free")).toBe(true);
		expect(isDynamic("codex-acp")).toBe(false);
		expect(dynamicCeiling("dynamic")).toBe("paid");
		expect(dynamicCeiling("dynamic:free")).toBe("free");
		expect(dynamicCeiling("dynamic:plan")).toBe("plan");
	});
	it("never goes past the ceiling, even when only a costlier AI fits", () => {
		const all = [c("llm:ollama", "free", "small"), c("claude-acp", "plan", "large"), c("llm:openai", "paid", "large")];
		expect(recommend({ effort: "deep" }, forDynamic(all, "free", []))).toBeUndefined();
		expect(recommend({ effort: "deep" }, forDynamic(all, "plan", []))?.agent).toBe("claude-acp");
		expect(recommend({ effort: "light" }, forDynamic(all, "paid", []))?.agent).toBe("llm:ollama");
		// Left out by the visitor: the whole AI, or one model of it.
		expect(recommend({ effort: "light" }, forDynamic(all, "paid", ["llm:ollama"]))?.agent).toBe("claude-acp");
		expect(forDynamic([{ ...all[0]!, model: "qwen3:4b" }], "paid", ["llm:ollama@qwen3:4b"])).toEqual([]);
	});
});

import { judgeEffort } from "../src/ais.js";
import type { Decisions } from "../src/llm/decisions.js";

const deciding = (choice: unknown): Decisions => ({
	find: async () => undefined,
	decide: async () => ({ model: "nimble", answers: { effort: { choice } } }),
});

describe("the first message's weight, from the decision model", () => {
	it("takes a known effort, and nothing when there is no model, no message or no sense", async () => {
		expect(await judgeEffort({ prompt: "Which mug is cheapest?", decisions: deciding("light") })).toBe("light");
		expect(await judgeEffort({ prompt: "Plan my kitchen", decisions: deciding("deep") }, "light")).toBe("deep");
		expect(await judgeEffort({ prompt: "hi", decisions: deciding("huge") })).toBeUndefined();
		expect(await judgeEffort({ prompt: "  ", decisions: deciding("light") })).toBeUndefined();
		expect(await judgeEffort({ prompt: "hi" })).toBeUndefined();
		const failing: Decisions = { find: async () => undefined, decide: async () => { throw new Error("gone"); } };
		expect(await judgeEffort({ prompt: "hi", decisions: failing })).toBeUndefined();
	});
});
