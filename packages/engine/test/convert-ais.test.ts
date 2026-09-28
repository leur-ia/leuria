import { describe, expect, it } from "vitest";

import { convertServiceAis } from "../src/ais.js";
import { GrantStore } from "../src/grants.js";
import { loadConfig, saveConfig } from "../src/home.js";

describe("AIs saved as one fixed model of a service", () => {
	it("become the service, with that model chosen; sites keep theirs", () => {
		saveConfig({ port: 1, agent: "llm:lmstudio/qwen/qwen3-8b", ais: ["codex-acp", "llm:ollama/llama3:8b", "llm:ollama/qwen3:4b"] });
		const grants = new GrantStore(null);
		grants.create("https://a.example");
		grants.setAgent("https://a.example", "llm:ollama/qwen3:4b");
		convertServiceAis(grants);
		const config = loadConfig();
		expect(config.agent).toBe("llm:lmstudio");
		expect(config.ais).toEqual(["codex-acp", "llm:ollama"]);
		expect(config.models).toEqual({ "llm:lmstudio": "qwen/qwen3-8b", "llm:ollama": "llama3:8b" });
		expect(grants.get("https://a.example")).toMatchObject({ agent: "llm:ollama", model: { agent: "llm:ollama", id: "qwen3:4b" } });
		// Once converted, nothing changes.
		convertServiceAis(grants);
		expect(loadConfig()).toEqual(config);
	});
});
