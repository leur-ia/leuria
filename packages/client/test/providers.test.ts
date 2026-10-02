import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { GrantStore } from "../../engine/src/grants.js";
import { type EngineHandle, startEngine } from "../../engine/src/server.js";
import { BridgeClient, bridge, browserAI, createLeuria, defineTool, messageText, server } from "../src/index.js";
import { sse } from "./helpers.js";

const lookup = defineTool<{ text?: string; sku?: string }>({
	name: "lookup",
	description: "Look up a product",
	inputSchema: { type: "object", properties: { sku: { type: "string" } } },
	execute: (args) => ({ sku: args.sku ?? args.text, price: 12 }),
});

describe("server provider", () => {
	it("streams text and runs tool calls in the page", async () => {
		const bodies: Array<Record<string, unknown>> = [];
		const fetchMock = (async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body)) as Record<string, unknown>;
			bodies.push(body);
			if (bodies.length === 1) {
				return sse([
					{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "lookup", arguments: '{"sk' } }] } }] },
					{ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'u":"blue"}' } }] } }] },
				]);
			}
			return sse([{ choices: [{ delta: { content: "The blue mug " } }] }, { choices: [{ delta: { content: "is €12." } }] }]);
		}) as typeof fetch;

		const ai = createLeuria({
			providers: [server({ url: "https://site.example/ai", model: "m", headers: () => ({ "X-Csrf": "t" }), fetch: fetchMock })],
			autoDetect: false,
		});
		await ai.detect();
		const result = await ai.chat({ system: "shop", prompt: "price of blue?", tools: [lookup] }).result();

		expect(result.text).toBe("The blue mug is €12.");
		expect(result.message.parts[0]).toMatchObject({ type: "tool-call", callId: "c1", args: { sku: "blue" }, result: { sku: "blue", price: 12 } });
		expect(bodies[0]).toMatchObject({ model: "m", stream: true, messages: [{ role: "system" }, { role: "user", content: "price of blue?" }] });
		expect((bodies[0]!.tools as unknown[]).length).toBe(1);
		expect(bodies[1]!.messages).toMatchObject([
			{ role: "system" },
			{ role: "user" },
			{ role: "assistant", tool_calls: [{ id: "c1", function: { name: "lookup" } }] },
			{ role: "tool", tool_call_id: "c1", content: '{"sku":"blue","price":12}' },
		]);
	});

	it("uses response_format when the endpoint supports JSON schema", async () => {
		let body: Record<string, unknown> = {};
		const fetchMock = (async (_url: string, init: RequestInit) => {
			body = JSON.parse(String(init.body)) as Record<string, unknown>;
			return sse([{ choices: [{ delta: { content: '{"rating":4}' } }] }]);
		}) as typeof fetch;
		const ai = createLeuria({ providers: [server({ url: "/ai", jsonSchema: true, fetch: fetchMock })], autoDetect: false });
		await ai.detect();
		const schema = { type: "object", properties: { rating: { type: "number" } } };
		expect(await ai.chat({ prompt: "rate", schema }).object()).toEqual({ rating: 4 });
		expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { schema } });
		expect(body.tools).toBeUndefined();
	});

	it("reports endpoint failures", async () => {
		const fetchMock = (async () => new Response("quota exceeded", { status: 429 })) as unknown as typeof fetch;
		const ai = createLeuria({ providers: [server({ url: "/ai", fetch: fetchMock })], autoDetect: false });
		await ai.detect();
		await expect(ai.chat({ prompt: "x" }).text()).rejects.toThrow(/429 quota exceeded/);
	});
});

describe("browser AI provider", () => {
	const g = globalThis as { LanguageModel?: unknown };
	afterEach(() => {
		delete g.LanguageModel;
	});

	function fakeLanguageModel(availability: string, reply: (input: string, options: Record<string, unknown>) => string[]) {
		const created: Array<Record<string, unknown>> = [];
		g.LanguageModel = {
			availability: async () => availability,
			create: async (options: Record<string, unknown>) => {
				created.push(options);
				(options.monitor as ((m: EventTarget) => void) | undefined)?.(new EventTarget());
				return {
					promptStreaming: (input: string, opts: Record<string, unknown>) =>
						new ReadableStream<string>({
							start(controller) {
								for (const chunk of reply(input, opts)) controller.enqueue(chunk);
								controller.close();
							},
						}),
					destroy: () => undefined,
				};
			},
		};
		return created;
	}

	it("is unavailable without the Prompt API, and needs a download when the model is missing", async () => {
		const provider = browserAI();
		await provider.detect();
		expect(provider.getState().status).toBe("unavailable");
		fakeLanguageModel("downloadable", () => []);
		await provider.detect();
		expect(provider.getState()).toMatchObject({ status: "needs-action", action: "download" });
		await provider.connect();
		expect(provider.getState().status).toBe("ready");
	});

	it("streams deltas, replays history as initial prompts, and constrains JSON natively", async () => {
		const created = fakeLanguageModel("available", (_input, opts) =>
			opts.responseConstraint ? ['{"ok":', "true}"] : ["Hello ", "there"],
		);
		const ai = createLeuria({ providers: [browserAI()], autoDetect: false });
		await ai.detect();
		expect(await ai.chat({ messages: ["hi", { role: "assistant", content: "yo" }, "again"], system: "sys" }).text()).toBe(
			"Hello there",
		);
		expect(created[0]!.initialPrompts).toEqual([
			{ role: "system", content: "sys" },
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "yo" },
		]);
		expect(await ai.chat({ prompt: "json", schema: { type: "object" } }).object()).toEqual({ ok: true });
	});
});

describe("bridge provider", () => {
	const PORT = 19597;
	const SITE = "http://localhost:3000";
	const FAKE_AGENT = fileURLToPath(new URL("../../engine/test/fixtures/fake-agent.mjs", import.meta.url));
	const nodeFetch = globalThis.fetch;
	let engine: EngineHandle;

	beforeAll(async () => {
		globalThis.fetch = (input, init = {}) =>
			nodeFetch(input, { ...init, headers: { Origin: SITE, ...(init.headers as Record<string, string> | undefined) } });
		engine = await startEngine({
			port: PORT,
			grants: new GrantStore(null),
			logger: { info: () => {}, warn: () => {}, error: () => {} },
			agentName: "Fake agent",
			resolveAgent: async () => ({ command: process.execPath, args: [FAKE_AGENT] }),
		});
	});
	afterAll(async () => {
		globalThis.fetch = nodeFetch;
		await engine.close();
	});

	function memoryStorage() {
		const map = new Map<string, string>();
		return {
			getItem: (k: string) => map.get(k) ?? null,
			setItem: (k: string, v: string) => void map.set(k, v),
			removeItem: (k: string) => void map.delete(k),
		};
	}

	it("needs a connect, then serves a conversation with page tools and structured output", async () => {
		const provider = bridge({ url: `http://127.0.0.1:${PORT}`, storage: memoryStorage() });
		const ai = createLeuria({ providers: [provider], autoDetect: false });
		await ai.detect();
		// Nothing is asked before a connect: Leuria doesn't answer sites it doesn't know.
		expect(ai.getState().pending).toMatchObject({ id: "bridge", action: "connect" });

		// Play the visitor clicking Allow when Leuria asks.
		const originalConnect = provider.client.connect.bind(provider.client);
		provider.client.connect = (options = {}) => {
			answerWhenAsked();
			return originalConnect({ ...options, openLink: false });
		};
		await ai.connect();
		expect(ai.getState().active?.id).toBe("bridge");

		const convo = ai.conversation({ system: "shop", tools: [lookup] });
		const first = await convo.send("blue").result();
		expect(first.text).toBe('tool said: {"sku":"blue","price":12}');
		expect(first.message.parts[0]).toMatchObject({ type: "tool-call", name: "lookup", state: "done" });
		const second = await convo.send("green").result();
		expect(second.text).toContain('"sku":"green"');
		expect(convo.getState().messages.map(messageText)).toHaveLength(4);
		convo.close();

		const rating = await ai
			.chat({ prompt: 'SUBMIT {"rating":5}', schema: { type: "object", properties: { rating: { type: "number" } } } })
			.object();
		expect(rating).toEqual({ rating: 5 });
	});

	it("warms up, sends attachments, streams reasoning, and survives a timeout and a tool-ended turn", async () => {
		const provider = bridge({ url: `http://127.0.0.1:${PORT}`, storage: memoryStorage() });
		// Reuse the grant from the previous test's origin.
		const token = await pairDirect();
		provider.client.forget();
		(provider.client as unknown as { storage: { setItem: (k: string, v: string) => void } }).storage.setItem(
			`leuria:token:http://127.0.0.1:${PORT}`,
			token,
		);
		const ai = createLeuria({ providers: [provider], autoDetect: false });
		await ai.detect();

		const render = defineTool<{ text?: string }>({
			name: "render",
			description: "Render and end the turn",
			inputSchema: { type: "object" },
			execute: (args, ctx) => {
				if (String(args.text).includes("END")) ctx.endTurn({ rendered: args.text });
				return { ok: true };
			},
		});
		const convo = ai.conversation({ tools: [render], timeoutMs: 1500 });
		expect(await convo.warm()).toBe(true);
		expect(convo.getState().session).toBe("ready");

		const png = { url: "data:image/png;base64,iVBORw0KGgo=", mediaType: "image/png" };
		const notes = { url: "data:text/plain;base64,aGVsbG8=", mediaType: "text/plain", filename: "n.txt" };
		const blocks = await convo.send({ role: "user", content: "BLOCKS", files: [png, notes] }).text();
		expect(blocks).toMatch(/^text:\d+,image:image\/png,text:\d+$/);

		const thought = await convo.send("THINK").result();
		expect(thought.message.parts[0]).toEqual({ type: "reasoning", text: "pondering" });

		const ended = await convo.send("END here").result();
		expect(ended.outcome).toEqual({ rendered: "END here" });

		await expect(convo.send("SLOW").result()).rejects.toThrow(/took longer/);
		// The agent was cancelled, not killed: the same session answers.
		const after = await convo.send("BLOCKS").text();
		expect(after).toMatch(/^text:\d+$/);
		convo.close();
	});

	it("says Leuria isn't running when a connect gets no answer, until the next connect", async () => {
		const provider = bridge({ url: `http://127.0.0.1:${PORT}`, storage: memoryStorage() });
		// Leuria never gets the link: the attempt waits on after telling so.
		provider.client.connect = ({ onUnreached, signal } = {}) =>
			new Promise((_, reject) => {
				onUnreached?.();
				signal?.addEventListener("abort", () => reject(new Error("replaced")));
			});
		void provider.connect().catch(() => undefined);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(provider.getState().status).toBe("unavailable");

		// Opened or installed since: the next connect may reach it.
		provider.client.connect = () => new Promise(() => undefined);
		void provider.connect();
		expect(provider.getState()).toMatchObject({ status: "needs-action", action: "connect" });
	});

	/** Plays the visitor answering Leuria's question as soon as the site asks. */
	function answerWhenAsked(allow = true) {
		const timer = setInterval(() => {
			const request = engine.pairing.pending().find((r) => r.origin === SITE);
			if (!request) return;
			clearInterval(timer);
			engine.pairing.decideById(request.requestId, allow);
		}, 10);
		setTimeout(() => clearInterval(timer), 10_000);
	}

	/** Pair SITE again through the engine and return the token. */
	async function pairDirect(): Promise<string> {
		const client = new BridgeClient({ url: `http://127.0.0.1:${PORT}`, storage: memoryStorage() });
		answerWhenAsked();
		await client.connect({ openLink: false });
		return client.token()!;
	}
});
