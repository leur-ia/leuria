import { BaseProvider, type Capability, type Message, messageText, type ProviderSession, type ProviderState, type SessionOptions, type TurnContext } from "@leuria/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLanguageModel, installPromptAPI, LEURIA_MARK } from "../src/index.js";

type Reply = (input: { text: string; message: Message; context: TurnContext; options: SessionOptions; turn: number }) => Promise<string> | string;

/** The visitor's AI, scripted: streams each reply in two chunks. */
class FakeAI extends BaseProvider {
	sessions: SessionOptions[] = [];
	sent: string[] = [];
	closed = 0;
	connects = 0;

	constructor(
		private readonly reply: Reply,
		state: Partial<ProviderState> = {},
	) {
		super("bridge", "Your AI (Leuria)", "device", { status: "ready", capabilities: ["chat", "tools", "images"] as Capability[], ...state });
	}

	set(patch: Partial<ProviderState>): void {
		this.setState(patch);
	}

	async detect(): Promise<void> {}

	async connect(): Promise<void> {
		this.connects++;
		this.setState({ status: "ready", action: undefined });
	}

	async createSession(options: SessionOptions): Promise<ProviderSession> {
		this.sessions.push(options);
		let turn = 0;
		return {
			send: async (message, context) => {
				const text = messageText(message);
				this.sent.push(text);
				const answer = await this.reply({ text, message, context, options, turn: turn++ });
				const half = Math.ceil(answer.length / 2);
				context.text(answer.slice(0, half));
				context.text(answer.slice(half));
				return { text: answer };
			},
			close: () => {
				this.closed++;
			},
		};
	}
}

const echo: Reply = ({ text }) => `echo: ${text}`;

describe("availability", () => {
	it("follows the visitor's AI: connected, to connect, absent", async () => {
		const ai = new FakeAI(echo);
		const LanguageModel = createLanguageModel({ provider: ai });
		expect(await LanguageModel.availability()).toBe("available");
		ai.set({ status: "needs-action", action: "connect" });
		expect(await LanguageModel.availability()).toBe("downloadable");
		ai.set({ status: "unavailable", capabilities: [] });
		expect(await LanguageModel.availability()).toBe("unavailable");
	});

	it("is unavailable for audio, image output, or tools and images the AI can't take", async () => {
		const LanguageModel = createLanguageModel({ provider: new FakeAI(echo, { capabilities: ["chat"] }) });
		expect(await LanguageModel.availability({ expectedInputs: [{ type: "audio" }] })).toBe("unavailable");
		expect(await LanguageModel.availability({ expectedOutputs: [{ type: "image" }] })).toBe("unavailable");
		expect(await LanguageModel.availability({ expectedInputs: [{ type: "image" }] })).toBe("unavailable");
		expect(await LanguageModel.availability({ expectedInputs: [{ type: "text", languages: ["en", "fr"] }] })).toBe("available");
	});

	it("rejects invalid language tags and samplingMode with temperature", async () => {
		const LanguageModel = createLanguageModel({ provider: new FakeAI(echo) });
		await expect(LanguageModel.availability({ expectedInputs: [{ type: "text", languages: ["en-abc-invalid"] }] })).rejects.toBeInstanceOf(RangeError);
		await expect(LanguageModel.availability({ samplingMode: "balanced", temperature: 1 })).rejects.toBeInstanceOf(TypeError);
	});
});

describe("create", () => {
	it("connects the site when needed, reporting progress 0 then 1", async () => {
		const ai = new FakeAI(echo, { status: "needs-action", action: "connect" });
		const LanguageModel = createLanguageModel({ provider: ai });
		const loaded: number[] = [];
		const session = await LanguageModel.create({
			monitor: (m) => m.addEventListener("downloadprogress", (e) => loaded.push((e as unknown as { loaded: number }).loaded)),
		});
		expect(ai.connects).toBe(1);
		expect(loaded).toEqual([0, 1]);
		expect(await session.prompt("hi")).toBe("echo: hi");
	});

	it("fails when there is no AI, and can't be constructed directly", async () => {
		const LanguageModel = createLanguageModel({ provider: new FakeAI(echo, { status: "unavailable" }) });
		await expect(LanguageModel.create()).rejects.toMatchObject({ name: "NotSupportedError" });
		expect(() => new (LanguageModel as unknown as new () => unknown)()).toThrow(TypeError);
	});

	it("starts the AI with the page's system prompt and initial prompts", async () => {
		const ai = new FakeAI(echo);
		const LanguageModel = createLanguageModel({ provider: ai });
		const session = await LanguageModel.create({
			initialPrompts: [
				{ role: "system", content: "You are a pirate." },
				{ role: "user", content: "Ahoy" },
				{ role: "assistant", content: "Arr" },
			],
		});
		await session.prompt("Where's the treasure?");
		expect(ai.sessions[0]!.system).toBe("You are a pirate.");
		expect(ai.sessions[0]!.history.map(messageText)).toEqual(["Ahoy", "Arr"]);
	});

	it("refuses a system message that isn't first", async () => {
		const LanguageModel = createLanguageModel({ provider: new FakeAI(echo) });
		await expect(
			LanguageModel.create({ initialPrompts: [{ role: "user", content: "a" }, { role: "system", content: "b" }] }),
		).rejects.toBeInstanceOf(TypeError);
	});
});

describe("prompting", () => {
	it("keeps one AI session, sending only what's new", async () => {
		const ai = new FakeAI(echo);
		const session = await createLanguageModel({ provider: ai }).create();
		await session.prompt("one");
		await session.prompt("two");
		expect(ai.sessions).toHaveLength(1);
		expect(ai.sent).toEqual(["one", "two"]);
		expect(session.contextUsage).toBeGreaterThan(0);
	});

	it("streams the answer", async () => {
		const session = await createLanguageModel({ provider: new FakeAI(echo) }).create();
		const chunks: string[] = [];
		for await (const chunk of session.promptStreaming("hello") as unknown as AsyncIterable<string>) chunks.push(chunk);
		expect(chunks.join("")).toBe("echo: hello");
		expect(chunks.length).toBe(2);
	});

	it("runs prompts one after the other", async () => {
		let running = 0;
		let overlap = false;
		const ai = new FakeAI(async ({ text }) => {
			overlap ||= running > 0;
			running++;
			await new Promise((r) => setTimeout(r, 5));
			running--;
			return text;
		});
		const session = await createLanguageModel({ provider: ai }).create();
		expect(await Promise.all([session.prompt("a"), session.prompt("b")])).toEqual(["a", "b"]);
		expect(overlap).toBe(false);
	});

	it("refuses system messages in a prompt", async () => {
		const session = await createLanguageModel({ provider: new FakeAI(echo) }).create();
		await expect(session.prompt([{ role: "system", content: "x" }])).rejects.toMatchObject({ name: "NotSupportedError" });
	});

	it("sends appended messages with the next prompt", async () => {
		const ai = new FakeAI(echo);
		const session = await createLanguageModel({ provider: ai }).create();
		await session.append([{ role: "user", content: "Here is my note: buy milk." }]);
		await session.prompt("Summarize it.");
		expect(ai.sent[0]).toBe("User: Here is my note: buy milk.\n\nUser: Summarize it.");
		await session.prompt("Thanks");
		expect(ai.sent[1]).toBe("Thanks");
	});

	it("continues an assistant prefix without repeating it", async () => {
		const ai = new FakeAI(() => "```json\n{}");
		const session = await createLanguageModel({ provider: ai }).create();
		const answer = await session.prompt([
			{ role: "user", content: "Give me JSON" },
			{ role: "assistant", content: "```json\n", prefix: true },
		]);
		expect(answer).toBe("{}");
		expect(ai.sent[0]).toContain("Begin your answer with exactly this text");
	});

	it("passes images to the AI", async () => {
		const ai = new FakeAI(({ message }) => message.parts.find((p) => p.type === "file")?.type ?? "none");
		const session = await createLanguageModel({ provider: ai }).create();
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const answer = await session.prompt([{ role: "user", content: [{ type: "text", value: "What's this?" }, { type: "image", value: new Blob([png], { type: "image/png" }) }] }]);
		expect(answer).toBe("file");
	});
});

describe("response constraints", () => {
	const schema = { type: "object", properties: { rating: { type: "integer", minimum: 1, maximum: 5 } }, required: ["rating"] };

	it("returns JSON that matches the schema, asking again when it doesn't", async () => {
		const ai = new FakeAI(({ turn }) => (turn === 0 ? 'Sure! {"rating": 9}' : '```json\n{"rating": 4}\n```'));
		const session = await createLanguageModel({ provider: ai }).create();
		const answer = await session.prompt("Rate it", { responseConstraint: schema });
		expect(JSON.parse(answer)).toEqual({ rating: 4 });
		expect(ai.sent[0]).toContain("JSON Schema");
		expect(ai.sent[1]).toContain("$.rating must be at most 5");
	});

	it("gives up after the retries", async () => {
		const session = await createLanguageModel({ provider: new FakeAI(() => "no idea"), retries: 1 }).create();
		await expect(session.prompt("Rate it", { responseConstraint: schema })).rejects.toMatchObject({ name: "UnknownError" });
	});

	it("checks a RegExp", async () => {
		const session = await createLanguageModel({ provider: new FakeAI(() => " yes\n") }).create();
		expect(await session.prompt("Is it?", { responseConstraint: /yes|no/ })).toBe("yes");
	});
});

describe("tools", () => {
	it("runs the page's tools for the AI", async () => {
		const ai = new FakeAI(async ({ context }) => {
			const outcome = await context.runTool({ name: "getWeather", args: { location: "Paris" } });
			return outcome.ok ? `It is ${outcome.result}` : outcome.error;
		});
		const execute = vi.fn(async ({ location }: { location: string }) => `sunny in ${location}`);
		const session = await createLanguageModel({ provider: ai }).create({
			tools: [{ name: "getWeather", description: "Weather", inputSchema: { type: "object", properties: { location: { type: "string" } } }, execute }],
		});
		expect(await session.prompt("Weather?")).toBe("It is sunny in Paris");
		expect(execute).toHaveBeenCalledWith({ location: "Paris" });
		expect(ai.sessions[0]!.tools.map((t) => t.name)).toEqual(["getWeather"]);
	});
});

describe("lifecycle", () => {
	it("aborts a prompt with the signal's reason", async () => {
		const session = await createLanguageModel({ provider: new FakeAI(() => new Promise<string>(() => undefined)) }).create();
		const controller = new AbortController();
		const pending = session.prompt("slow", { signal: controller.signal });
		controller.abort(new Error("stop"));
		await expect(pending).rejects.toThrow("stop");
	});

	it("ends the AI session on destroy and refuses prompts after", async () => {
		const ai = new FakeAI(echo);
		const session = await createLanguageModel({ provider: ai }).create();
		await session.prompt("hi");
		session.destroy();
		expect(ai.closed).toBe(1);
		await expect(session.prompt("again")).rejects.toMatchObject({ name: "InvalidStateError" });
	});

	it("clones with the history, in a session of its own", async () => {
		const ai = new FakeAI(echo);
		const session = await createLanguageModel({ provider: ai }).create();
		await session.prompt("first");
		const copy = await session.clone();
		await copy.prompt("second");
		expect(ai.sessions).toHaveLength(2);
		expect(ai.sessions[1]!.history.map(messageText)).toEqual(["first", "echo: first"]);
	});

	it("starts a new session with the history after the AI fails", async () => {
		const ai = new FakeAI(({ turn }) => {
			if (turn === 1) throw new Error("agent crashed");
			return "ok";
		});
		const session = await createLanguageModel({ provider: ai }).create();
		await session.prompt("one");
		await expect(session.prompt("two")).rejects.toMatchObject({ name: "UnknownError" });
		expect(await session.prompt("three")).toBe("ok");
		expect(ai.sessions).toHaveLength(2);
		expect(ai.sessions[1]!.history.map(messageText)).toEqual(["one", "ok"]);
	});
});

describe("installPromptAPI", () => {
	const scope = globalThis as { LanguageModel?: unknown };
	afterEach(() => {
		delete scope.LanguageModel;
	});

	it("installs where the browser has no LanguageModel", async () => {
		expect(await installPromptAPI({ provider: new FakeAI(echo) })).toBe("leuria");
		expect((scope.LanguageModel as Record<symbol, unknown>)[LEURIA_MARK]).toBe(true);
	});

	it("keeps the browser's model where it can run, and replaces it where it can't", async () => {
		scope.LanguageModel = { availability: async () => "downloadable" };
		expect(await installPromptAPI({ provider: new FakeAI(echo) })).toBe("browser");
		scope.LanguageModel = { availability: async () => "unavailable" };
		expect(await installPromptAPI({ provider: new FakeAI(echo) })).toBe("leuria");
	});

	it("leaves any browser model alone with when: missing", async () => {
		scope.LanguageModel = { availability: async () => "unavailable" };
		expect(await installPromptAPI({ provider: new FakeAI(echo), when: "missing" })).toBe("browser");
	});
});
