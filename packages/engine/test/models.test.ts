import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AcpLiveSession, readModels } from "../src/acp/acp-client.js";

const FAKE_AGENT = fileURLToPath(new URL("./fixtures/fake-agent.mjs", import.meta.url));

async function ask(model?: string) {
	const chunks: string[] = [];
	const session = new AcpLiveSession({
		command: process.execPath,
		args: [FAKE_AGENT],
		cwd: process.cwd(),
		mcpServers: [{ type: "http", name: "webmcp", url: "http://127.0.0.1:9/unused", headers: [] }],
		model,
		onChunk: (t) => chunks.push(t),
	});
	expect(await session.start()).toEqual({});
	await session.prompt("MODEL?");
	const models = session.models;
	session.close();
	return { answer: chunks.join(""), models };
}

describe("agent models", () => {
	it("reads the models an agent offers, and keeps its default", async () => {
		const { answer, models } = await ask();
		expect(answer).toBe("model: fast");
		expect(models).toEqual({
			configId: "model",
			current: "fast",
			options: [
				{ id: "fast", name: "Fast" },
				{ id: "smart", name: "Smart", description: "Slower, better" },
			],
		});
	});

	it("switches to the chosen model with session/set_config_option", async () => {
		const { answer, models } = await ask("smart");
		expect(answer).toBe("model: smart");
		expect(models?.current).toBe("smart");
	});

	it("ignores a chosen model the agent no longer offers", async () => {
		expect((await ask("retired")).answer).toBe("model: fast");
	});

	it("reads the older `models` field and grouped options", () => {
		expect(readModels({ models: { currentModelId: "a", availableModels: [{ modelId: "a", name: "A" }, { modelId: "b", name: "B" }] } })).toEqual({
			current: "a",
			options: [
				{ id: "a", name: "A" },
				{ id: "b", name: "B" },
			],
		});
		const grouped = readModels({
			configOptions: [{ id: "m", category: "model", type: "select", currentValue: "x", options: [{ group: "g", name: "G", options: [{ value: "x", name: "X" }] }] }],
		});
		expect(grouped?.options).toEqual([{ id: "x", name: "X" }]);
		expect(readModels({})).toBeNull();
	});
});
