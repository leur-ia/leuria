import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { GrantStore } from "../src/grants.js";
import { LlmSession } from "../src/llm/llm-session.js";
import { getProvider, listProviders, normalizeBaseUrl, parseLlmId, removeProvider, saveProvider } from "../src/llm/providers.js";
import { type EngineHandle, startEngine } from "../src/server.js";

/** A fake OpenAI-compatible server: first asks for the page tool, then answers with its result. */
function fakeLlm(): Promise<{ server: Server; url: string; requests: Array<Record<string, unknown>> }> {
	const requests: Array<Record<string, unknown>> = [];
	const server = createServer((req, res) => {
		if (req.url === "/v1/models") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ data: [{ id: "tiny-chat" }, { id: "nomic-embed-text" }] }));
			return;
		}
		let raw = "";
		req.on("data", (c) => (raw += c));
		req.on("end", () => {
			const body = JSON.parse(raw) as { messages: Array<{ role: string; content: unknown }>; tools?: unknown[] };
			requests.push(body);
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			const send = (delta: unknown) => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
			const last = body.messages[body.messages.length - 1]!;
			if (last.role === "user" && body.tools?.length) {
				send({ reasoning_content: "I should look it up." });
				send({ tool_calls: [{ index: 0, id: "c1", function: { name: "count_stock", arguments: '{"prod' } }] });
				send({ tool_calls: [{ index: 0, function: { arguments: 'uct":"blue mug"}' } }] });
			} else if (last.role === "tool") {
				send({ content: "There are " });
				send({ content: `${JSON.parse(String(last.content)).inStock} blue mugs.` });
			} else {
				send({ content: `echo: ${String(last.content)}` });
			}
			res.end("data: [DONE]\n\n");
		});
	});
	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as { port: number };
			resolve({ server, url: `http://127.0.0.1:${port}/v1`, requests });
		}),
	);
}

describe("provider helpers", () => {
	const home = mkdtempSync(join(tmpdir(), "leuria-llm-"));
	const previous = process.env.LEURIA_HOME;
	beforeAll(() => {
		process.env.LEURIA_HOME = home;
	});
	afterAll(() => {
		process.env.LEURIA_HOME = previous;
		rmSync(home, { recursive: true, force: true });
	});

	it("normalises messy addresses", () => {
		expect(normalizeBaseUrl(" localhost:1234/ ")).toBe("http://localhost:1234/v1");
		expect(normalizeBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
		expect(normalizeBaseUrl("https://gateway.example.com/openai")).toBe("https://gateway.example.com/openai/v1");
		expect(normalizeBaseUrl("https://generativelanguage.googleapis.com/v1beta/openai/")).toBe(
			"https://generativelanguage.googleapis.com/v1beta/openai",
		);
	});

	it("parses AI ids whose model has slashes or colons", () => {
		expect(parseLlmId("llm:ollama/qwen3:8b")).toEqual({ providerId: "ollama", model: "qwen3:8b" });
		expect(parseLlmId("llm:lmstudio/qwen/qwen3-8b")).toEqual({ providerId: "lmstudio", model: "qwen/qwen3-8b" });
		expect(parseLlmId("codex-acp")).toBeNull();
	});

	it("knows LM Studio and Ollama without setup, and stores the visitor's APIs", () => {
		expect(listProviders().map((p) => p.id)).toEqual(["lmstudio", "ollama"]);
		const saved = saveProvider({ name: "Company gateway", baseUrl: "gateway.example.com", apiKey: " sk-test " });
		expect(saved).toMatchObject({ id: "company-gateway", kind: "openai", baseUrl: "http://gateway.example.com/v1", apiKey: "sk-test" });
		expect(getProvider("company-gateway")?.name).toBe("Company gateway");
		expect(removeProvider("company-gateway")).toBe(true);
	});
});

describe("LLM sessions", () => {
	let fake: Awaited<ReturnType<typeof fakeLlm>>;
	beforeAll(async () => {
		fake = await fakeLlm();
	});
	afterAll(() => fake.server.close());
	afterEach(() => fake.requests.splice(0));

	it("stream text and reasoning, and keep the conversation between turns", async () => {
		const chunks: string[] = [];
		const session = new LlmSession({
			provider: { id: "p", kind: "openai", name: "Test API", baseUrl: fake.url },
			model: "tiny-chat",
			systemPrompt: "Be brief.",
			tools: { list: () => [], call: async () => null },
			onChunk: (t) => chunks.push(t),
		});
		expect(await session.start()).toEqual({});
		await session.prompt("hi");
		await session.prompt("again");
		expect(chunks.join("")).toBe("echo: hiecho: again");
		const second = fake.requests[1]!.messages as Array<{ role: string }>;
		expect(second.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
	});

	it("say plainly when the provider is not running", async () => {
		const session = new LlmSession({
			provider: { id: "lmstudio", kind: "lmstudio", name: "LM Studio", baseUrl: "http://127.0.0.1:9/v1" },
			model: "x",
			tools: { list: () => [], call: async () => null },
		});
		expect((await session.start()).error).toMatch(/Couldn't reach LM Studio/);
	});

	it("run page tools through the engine, end to end", async () => {
		const PORT = 19592;
		const engine: EngineHandle = await startEngine({
			port: PORT,
			grants: new GrantStore(null),
			logger: { info: () => {}, warn: () => {}, error: () => {} },
			agentName: "Test model",
			resolveAgent: async () => ({
				command: "",
				args: [],
				llm: { provider: { id: "p", kind: "openai", name: "Test API", baseUrl: fake.url }, model: "tiny-chat" },
			}),
		});
		try {
			const base = `http://127.0.0.1:${PORT}`;
			const prepared = (await (
				await fetch(`${base}/session/prepare`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ prompt: "How many blue mugs?", systemPrompt: "Shop assistant." }),
				})
			).json()) as { sessionId: string; registrationToken: string };
			const calls: unknown[] = [];
			const channel = await new Promise<WebSocket>((resolve) => {
				const reg = new WebSocket(`ws://127.0.0.1:${PORT}/webmcp/register`);
				reg.on("open", () => reg.send(JSON.stringify({ type: "register", token: prepared.registrationToken })));
				reg.on("message", (d) => {
					const m = JSON.parse(d.toString()) as { channel: string; token: string };
					reg.close();
					const ch = new WebSocket(`ws://127.0.0.1:${PORT}${m.channel}?token=${m.token}`);
					ch.on("open", () => {
						ch.send(JSON.stringify({ type: "registerTool", name: "count_stock", description: "Count stock", inputSchema: { type: "object" } }));
						setTimeout(() => resolve(ch), 50);
					});
					ch.on("message", (raw) => {
						const call = JSON.parse(raw.toString()) as { type: string; id: string; arguments: unknown };
						if (call.type !== "callTool") return;
						calls.push(call.arguments);
						ch.send(JSON.stringify({ type: "toolResponse", id: call.id, result: { inStock: 42 } }));
					});
				});
			});
			const stream = await fetch(`${base}/session/${prepared.sessionId}/stream`);
			await fetch(`${base}/session/${prepared.sessionId}/approve`, { method: "POST" });
			const reader = stream.body!.getReader();
			const decoder = new TextDecoder();
			let text = "";
			while (!text.includes("turn_completed")) text += decoder.decode((await reader.read()).value, { stream: true });
			await reader.cancel();
			channel.close();

			expect(calls).toEqual([{ product: "blue mug" }]);
			expect(text).toContain("event: thought");
			expect(text).toContain('"status":"completed"');
			expect(text).toContain('"text":"There are 42 blue mugs."');
			// The model saw the page tool, and got its result back.
			expect((fake.requests[0]!.tools as Array<{ function: { name: string } }>)[0]!.function.name).toBe("count_stock");
			expect((fake.requests[1]!.messages as Array<{ role: string }>).map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
		} finally {
			await engine.close();
		}
	});
});

describe("a service as one AI, its model chosen like an agent's", () => {
	it("parses service ids with and without a fixed model", () => {
		expect(parseLlmId("llm:lmstudio")).toEqual({ providerId: "lmstudio" });
		expect(parseLlmId("llm:lmstudio/qwen/qwen3-8b")).toEqual({ providerId: "lmstudio", model: "qwen/qwen3-8b" });
		expect(parseLlmId("llm:")).toBeNull();
	});

	it("uses the chosen model, else one already loaded", async () => {
		const { defaultModel } = await import("../src/llm/providers.js");
		expect(defaultModel([{ id: "a" }, { id: "b", loaded: true }])).toBe("b");
		expect(defaultModel([{ id: "cloud", remote: true }, { id: "local" }])).toBe("local");
		expect(defaultModel([])).toBeUndefined();
	});
});

describe("launching a service AI", () => {
	let fake: Awaited<ReturnType<typeof fakeLlm>>;
	beforeAll(async () => {
		fake = await fakeLlm();
	});
	afterAll(() => fake.server.close());

	it("answers with the chosen model, else the service's first chat model", async () => {
		const { resolveAgentCommand } = await import("../src/agents.js");
		const { saveConfig, loadConfig } = await import("../src/home.js");
		saveProvider({ id: "fakesvc", name: "Fake service", baseUrl: fake.url });
		expect((await resolveAgentCommand("llm:fakesvc")).llm?.model).toBe("tiny-chat");
		saveConfig({ ...loadConfig(), models: { "llm:fakesvc": "other-chat" } });
		expect((await resolveAgentCommand("llm:fakesvc")).llm?.model).toBe("other-chat");
		// A site's own model wins.
		expect((await resolveAgentCommand("llm:fakesvc", "site-model")).llm?.model).toBe("site-model");
		expect((await resolveAgentCommand("llm:fakesvc")).name).toBe("Fake service");
	});
});
