import { describe, expect, it } from "vitest";

import {
	AbortError,
	type ChatEvent,
	createLeuria,
	defineTool,
	messageText,
	NoProviderError,
	StructuredOutputError,
} from "../src/index.js";
import { ScriptedProvider } from "./helpers.js";

const echo = (id: string, options?: ConstructorParameters<typeof ScriptedProvider>[2]) =>
	new ScriptedProvider(id, ({ message, context }) => {
		const text = `${id}: ${messageText(message)}`;
		context.text(text);
		return text;
	}, options);

describe("cascade", () => {
	it("uses the first ready provider", async () => {
		const ai = createLeuria({
			providers: [echo("a", { status: "unavailable" }), echo("b"), echo("c")],
			autoDetect: false,
		});
		const run = ai.chat({ prompt: "hi" });
		const events: ChatEvent[] = [];
		for await (const e of run) events.push(e);
		expect(events[0]).toMatchObject({ type: "start", provider: { id: "b" } });
		expect(await run.text()).toBe("b: hi");
		expect(ai.getState().active?.id).toBe("b");
	});

	it("skips providers without the needed capability", async () => {
		const ai = createLeuria({
			providers: [echo("chat-only", { capabilities: ["chat"] }), echo("tools")],
			autoDetect: false,
		});
		const tool = defineTool({ name: "t", description: "", inputSchema: { type: "object" }, execute: () => 1 });
		const result = await ai.chat({ prompt: "hi", tools: [tool] }).result();
		expect(result.provider.id).toBe("tools");
	});

	it("honors localOnly and explicit provider order", async () => {
		const ai = createLeuria({
			providers: [echo("site", { locality: "site" }), echo("device"), echo("other")],
			autoDetect: false,
		});
		expect((await ai.chat({ prompt: "x", localOnly: true }).result()).provider.id).toBe("device");
		expect((await ai.chat({ prompt: "x", provider: ["other", "device"] }).result()).provider.id).toBe("other");
	});

	it("explains why nothing can answer, and which provider a click would fix", async () => {
		const ai = createLeuria({
			providers: [
				echo("bridge", { status: "needs-action" }),
				echo("browser", { status: "unavailable", capabilities: [] }),
			],
			autoDetect: false,
		});
		const error = await ai.chat({ prompt: "x" }).result().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NoProviderError);
		expect((error as NoProviderError).actionable).toBe("bridge");
		expect((error as NoProviderError).reasons.map((r) => r.id)).toEqual(["bridge", "browser"]);
		expect(ai.getState().pending?.id).toBe("bridge");
	});

	it("still offers the visitor's own AI while a fallback answers, never one behind it", () => {
		const ai = createLeuria({
			providers: [echo("bridge", { status: "needs-action" }), echo("browser"), echo("later", { status: "needs-action" })],
			autoDetect: false,
		});
		expect(ai.getState().active?.id).toBe("browser");
		expect(ai.getState().pending?.id).toBe("bridge");
		const fallbackFirst = createLeuria({ providers: [echo("browser"), echo("bridge", { status: "needs-action" })], autoDetect: false });
		expect(fallbackFirst.getState().pending).toBeUndefined();
	});

	it("publishes a new state snapshot when a provider changes", () => {
		const bridge = echo("bridge", { status: "needs-action" });
		const ai = createLeuria({ providers: [bridge], autoDetect: false });
		const before = ai.getState();
		let notified = 0;
		ai.subscribe(() => notified++);
		expect(ai.getState()).toBe(before);
		bridge.set({ status: "ready" });
		expect(notified).toBe(1);
		expect(ai.getState()).not.toBe(before);
		expect(ai.getState().active?.id).toBe("bridge");
	});
});

describe("tools", () => {
	it("runs page tools and records them in the assistant message", async () => {
		const provider = new ScriptedProvider("p", async ({ context }) => {
			const outcome = await context.runTool({ name: "add", args: { a: 2, b: 3 } });
			const failed = await context.runTool({ name: "missing", args: {} });
			const text = `sum=${outcome.ok ? String(outcome.result) : "?"} ${failed.ok ? "" : failed.error}`;
			context.text(text);
			return text;
		});
		const ai = createLeuria({ providers: [provider], autoDetect: false });
		const add = defineTool<{ a: number; b: number }, number>({
			name: "add",
			description: "Add two numbers",
			inputSchema: { type: "object" },
			execute: ({ a, b }) => a + b,
		});
		const run = ai.chat({ prompt: "2+3", tools: [add] });
		const result = await run.result();
		expect(result.text).toBe("sum=5 Unknown tool: missing");
		expect(result.message.parts).toMatchObject([
			{ type: "tool-call", name: "add", args: { a: 2, b: 3 }, state: "done", result: 5 },
			{ type: "tool-call", name: "missing", state: "error" },
			{ type: "text", text: "sum=5 Unknown tool: missing" },
		]);
		const types: string[] = [];
		for await (const e of run) types.push(e.type);
		expect(types).toEqual(["start", "tool-call", "tool-result", "tool-call", "tool-result", "text-delta", "finish"]);
	});

	it("caps tool calls per turn", async () => {
		const provider = new ScriptedProvider("p", async ({ context }) => {
			let last = "";
			for (let i = 0; i < 5; i++) {
				const o = await context.runTool({ name: "t", args: {} });
				last = o.ok ? "ok" : o.error;
			}
			return last;
		});
		const ai = createLeuria({ providers: [provider], autoDetect: false });
		const t = defineTool({ name: "t", description: "", inputSchema: { type: "object" }, execute: () => "x" });
		expect(await ai.chat({ prompt: "go", tools: [t], maxSteps: 3 }).text()).toMatch(/budget exhausted/);
	});

	it("reserves the submit_result name", () => {
		const ai = createLeuria({ providers: [echo("a")], autoDetect: false });
		const bad = defineTool({ name: "submit_result", description: "", inputSchema: {}, execute: () => 1 });
		expect(() => ai.conversation({ tools: [bad] })).toThrow(/reserved/);
	});
});

describe("structured output", () => {
	const schema = { type: "object", properties: { rating: { type: "number" } }, required: ["rating"] };
	const validate = (v: unknown) => {
		const rating = (v as { rating?: unknown }).rating;
		if (typeof rating !== "number" || rating < 0 || rating > 5) throw new Error("rating must be a number from 0 to 5");
		return { rating };
	};

	it("uses the submit tool on providers without native support, and lets the model retry", async () => {
		const provider = new ScriptedProvider("agent", async ({ context }) => {
			const first = await context.runTool({ name: "submit_result", args: { rating: 9 } });
			expect(first.ok).toBe(false);
			const second = await context.runTool({ name: "submit_result", args: { rating: 4 } });
			expect(second.ok).toBe(true);
			return "";
		});
		const ai = createLeuria({ providers: [provider], autoDetect: false });
		const run = ai.chat({ prompt: "rate it", schema, validate });
		expect(await run.object()).toEqual({ rating: 4 });
		const session = provider.sessions[0]!;
		expect(session.tools.map((t) => t.name)).toEqual(["submit_result"]);
		expect(session.system).toMatch(/submit_result/);
		expect(session.schema).toBeUndefined();
		// The submit tool is plumbing, not a visible tool call.
		expect((await run.result()).message.parts).toEqual([]);
	});

	it("passes the schema to providers with native support and parses their JSON", async () => {
		const provider = new ScriptedProvider(
			"native",
			({ context }) => {
				context.text('```json\n{"rating": 3}\n```');
				return "";
			},
			{ capabilities: ["chat", "structured"] },
		);
		const ai = createLeuria({ providers: [provider], autoDetect: false });
		expect(await ai.chat({ prompt: "rate", schema, validate }).object()).toEqual({ rating: 3 });
		expect(provider.sessions[0]!.schema).toEqual(schema);
		expect(provider.sessions[0]!.tools).toEqual([]);
	});

	it("fails clearly when the output never matches", async () => {
		const provider = new ScriptedProvider("native", ({ context }) => (context.text("no idea"), ""), {
			capabilities: ["chat", "structured"],
		});
		const ai = createLeuria({ providers: [provider], autoDetect: false });
		await expect(ai.chat({ prompt: "rate", schema }).object()).rejects.toBeInstanceOf(StructuredOutputError);
	});
});

describe("conversation", () => {
	it("keeps the history and the provider session across turns", async () => {
		const provider = new ScriptedProvider("p", ({ message, context, turn }) => {
			const text = `#${turn} ${messageText(message)}`;
			context.text(text);
			return text;
		});
		const ai = createLeuria({ providers: [provider], autoDetect: false });
		const convo = ai.conversation({ system: "be brief" });
		const snapshots: number[] = [];
		convo.subscribe(() => snapshots.push(convo.getState().messages.length));

		await convo.send("one").result();
		await convo.send("two").result();
		const { messages, status } = convo.getState();
		expect(status).toBe("idle");
		expect(messages.map((m) => `${m.role}:${messageText(m)}`)).toEqual([
			"user:one",
			"assistant:#0 one",
			"user:two",
			"assistant:#1 two",
		]);
		expect(provider.sessions).toHaveLength(1);
		expect(snapshots.length).toBeGreaterThan(4);
	});

	it("moves to a better provider mid-conversation and hands it the history", async () => {
		const fallback = echo("browser");
		const bridge = echo("bridge", { status: "needs-action" });
		const ai = createLeuria({ providers: [bridge, fallback], autoDetect: false });
		const convo = ai.conversation();
		await convo.send("first").result();
		bridge.set({ status: "ready" });
		const second = await convo.send("second").result();
		expect(second.provider.id).toBe("bridge");
		expect(bridge.sessions[0]!.history.map(messageText)).toEqual(["first", "browser: first"]);
		expect(fallback.closed).toBe(1);
	});

	it("stops a running turn and keeps what was said", async () => {
		const provider = new ScriptedProvider("p", ({ context }) => {
			context.text("partial");
			return new Promise((_, reject) => context.signal.addEventListener("abort", () => reject(new Error("aborted"))));
		});
		const ai = createLeuria({ providers: [provider], autoDetect: false });
		const convo = ai.conversation();
		const run = convo.send("long task");
		await new Promise((r) => setTimeout(r, 5));
		convo.stop();
		await expect(run.result()).rejects.toBeInstanceOf(AbortError);
		const state = convo.getState();
		expect(state.status).toBe("error");
		expect(messageText(state.messages[1]!)).toBe("partial");
		// A failed session is not reused.
		expect(provider.closed).toBe(1);
	});

	it("reports NoProviderError through the run and the state", async () => {
		const ai = createLeuria({ providers: [echo("x", { status: "unavailable" })], autoDetect: false });
		const convo = ai.conversation();
		await expect(convo.send("hi").result()).rejects.toBeInstanceOf(NoProviderError);
		expect(convo.getState().status).toBe("error");
		expect(convo.getState().messages.map((m) => m.role)).toEqual(["user"]);
	});
});

describe("names", () => {
	it("keeps the first names as aliases of the agnostic ones", async () => {
		const sdk = await import("../src/index.js");
		expect(sdk.createLeuria).toBe(sdk.createAI);
		expect(sdk.bridge).toBe(sdk.leuria);
		expect(sdk.browserAI).toBe(sdk.promptAPI);
		const ai = sdk.createAI({ providers: [sdk.leuria(), sdk.promptAPI()] });
		expect(ai.getState().providers.map((p) => p.id)).toEqual(["bridge", "browser"]);
	});
});
