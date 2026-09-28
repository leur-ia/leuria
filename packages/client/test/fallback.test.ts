import { describe, expect, it } from "vitest";

import { createLeuria, NoProviderError } from "../src/index.js";
import { ScriptedProvider } from "./helpers.js";

/** Plays the visitor's own AI (the bridge): proposed first. */
class OwnAI extends ScriptedProvider {
	readonly asksFirst = true;
}

const quiet = { autoDetect: false, closeOnUnload: false } as const;

describe("the visitor's own AI first", () => {
	it("keeps the other AIs back until the visitor picks one, for this page only", async () => {
		const own = new OwnAI("bridge", () => "own", { status: "needs-action" });
		const browser = new ScriptedProvider("browser", () => "browser");
		const site = new ScriptedProvider("server", () => "site", { locality: "site" });
		const ai = createLeuria({ providers: [own, browser, site], ...quiet });

		expect(ai.getState().active).toBeUndefined();
		expect(ai.getState().pending?.id).toBe("bridge");
		expect(ai.getState().alternatives.map((p) => p.id)).toEqual(["browser", "server"]);
		const error = await ai.chat({ prompt: "hi" }).text().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NoProviderError);
		expect((error as NoProviderError).choices).toEqual(["browser", "server"]);

		ai.chooseInstead("server");
		expect(ai.getState().active?.id).toBe("server");
		expect(ai.getState().alternatives.map((p) => p.id)).toEqual(["browser"]);
		expect(await ai.chat({ prompt: "hi" }).text()).toBe("site");

		// Their own AI, once connected, answers first again.
		own.set({ status: "ready" });
		expect(ai.getState().active?.id).toBe("bridge");
		expect(ai.getState().alternatives).toEqual([]);

		// A new page (a new client) proposes it again: nothing was remembered.
		own.set({ status: "needs-action" });
		expect(createLeuria({ providers: [own, browser, site], ...quiet }).getState().active).toBeUndefined();
	});

	it("uses the others at once with fallback: auto, or when the site names one", async () => {
		const own = new OwnAI("bridge", () => "own", { status: "unavailable" });
		const browser = new ScriptedProvider("browser", () => "browser");
		expect(createLeuria({ providers: [own, browser], fallback: "auto", ...quiet }).getState().active?.id).toBe("browser");
		const ai = createLeuria({ providers: [own, browser], ...quiet });
		expect(await ai.chat({ prompt: "hi", provider: "browser" }).text()).toBe("browser");
	});

	it("doesn't hold back providers ahead of it, or when there is none", () => {
		const site = new ScriptedProvider("server", () => "site", { locality: "site" });
		const own = new OwnAI("bridge", () => "own", { status: "needs-action" });
		expect(createLeuria({ providers: [site, own], ...quiet }).getState().active?.id).toBe("server");
		expect(createLeuria({ providers: [new ScriptedProvider("browser", () => "b")], ...quiet }).getState().active?.id).toBe("browser");
	});
});
