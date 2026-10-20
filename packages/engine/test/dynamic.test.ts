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
