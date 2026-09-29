import { describe, expect, it } from "vitest";

import { createLeuria, defineTool, messageText, NoProviderError } from "../src/index.js";
import { ScriptedProvider } from "./helpers.js";

const quiet = { autoDetect: false, closeOnUnload: false } as const;
const lookup = defineTool<{ q: string }>({
	name: "lookup",
	description: "Look something up on the page.",
	inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
	execute: () => "found",
});

describe("an AI that can't use the page's tools", () => {
	it("answers with what the page found when the conversation allows it, and says it was limited", async () => {
		let seen = "";
		const browser = new ScriptedProvider("browser", ({ message }) => {
			seen = messageText(message);
			return "short answer";
		}, { capabilities: ["chat", "structured"] });
		const ai = createLeuria({ providers: [browser], ...quiet });
		const chat = ai.conversation({
			tools: [lookup],
			withoutTools: (message) => ({ "Passages that may answer": `about ${messageText(message)}` }),
		});

		await Promise.resolve();
		expect(ai.getState().needs).toEqual(["tools"]);
		const result = await chat.send("green mug?", { context: { Page: "shop" } }).result();

		expect(result.text).toBe("short answer");
		expect(chat.getState().limited).toBe(true);
		expect(result.message.metadata?.limited).toBe(true);
		// Its own context and the page's findings, together; no tools handed to it.
		expect(seen).toContain("Page: shop");
		expect(seen).toContain("Passages that may answer: about green mug?");
		expect(seen).toContain("green mug?");
		expect(browser.sessions[0]?.tools).toEqual([]);
	});

	it("still requires the tools without withoutTools", async () => {
		const browser = new ScriptedProvider("browser", () => "no", { capabilities: ["chat"] });
		const ai = createLeuria({ providers: [browser], ...quiet });
		const error = await ai.conversation({ tools: [lookup] }).send("hi").result().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NoProviderError);
	});

	it("prefers an AI that can use the tools, and then isn't limited", async () => {
		const own = new ScriptedProvider("bridge", () => "full answer");
		const browser = new ScriptedProvider("browser", () => "short answer", { capabilities: ["chat"] });
		const ai = createLeuria({ providers: [own, browser], ...quiet });
		const chat = ai.conversation({ tools: [lookup], withoutTools: () => "passages" });
		expect((await chat.send("hi").result()).text).toBe("full answer");
		expect(chat.getState().limited).toBe(false);
		expect(own.sessions[0]?.tools.map((t) => t.name)).toEqual(["lookup"]);
	});

	it("forgets the page's needs once the conversation closes", async () => {
		const ai = createLeuria({ providers: [new ScriptedProvider("browser", () => "")], ...quiet });
		const chat = ai.conversation({ tools: [lookup] });
		await Promise.resolve();
		expect(ai.getState().needs).toEqual(["tools"]);
		chat.close();
		expect(ai.getState().needs).toEqual([]);
	});
});
