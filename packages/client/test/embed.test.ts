import { describe, expect, it } from "vitest";

import { BaseProvider, connection, createLeuria, type EmbedRequest, type EmbedResult, NoProviderError, type ProviderSession, type ProviderState } from "../src/index.js";
import { ScriptedProvider } from "./helpers.js";

/** Embeds each text as [its length, a marker for the model]. */
class FakeEmbedder extends BaseProvider {
	readonly offers = ["embed"] as const;
	calls: EmbedRequest[] = [];
	constructor(id: string, status: ProviderState["status"], private readonly model = `${id}-model`) {
		super(id, `Embedder ${id}`, "device", {
			status,
			capabilities: status === "ready" ? ["embed"] : [],
			embedModel: status === "ready" ? model : undefined,
			action: status === "needs-action" ? "download" : undefined,
		});
	}
	set(status: ProviderState["status"]): void {
		this.setState({ status, capabilities: status === "ready" ? ["embed"] : [], embedModel: status === "ready" ? this.model : undefined });
	}
	async detect(): Promise<void> {}
	async connect(): Promise<void> {
		this.set("ready");
	}
	async embed(request: EmbedRequest): Promise<EmbedResult> {
		this.calls.push(request);
		return { model: this.model, vectors: request.texts.map((t) => [t.length]) };
	}
	async createSession(): Promise<ProviderSession> {
		throw new Error("cannot chat");
	}
}

const quiet = { autoDetect: false, closeOnUnload: false } as const;

describe("embed", () => {
	it("uses the first ready embedder and names its model", async () => {
		const ai = createLeuria({ providers: [new FakeEmbedder("engine", "unavailable"), new FakeEmbedder("page", "ready")], ...quiet });
		const result = await ai.embed(["mug", "teapot"], { kind: "query" });
		expect(result).toEqual({ vectors: [[3], [6]], model: "page-model", provider: { id: "page", label: "Embedder page", locality: "device" } });
	});

	it("says why nothing can embed", async () => {
		const ai = createLeuria({ providers: [new FakeEmbedder("page", "needs-action"), new ScriptedProvider("chat", () => "hi")], ...quiet });
		const error = await ai.embed(["x"]).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NoProviderError);
		expect((error as NoProviderError).reasons.map((r) => r.id)).toEqual(["page"]);
	});

	it("reports the embedder, and one worth a click ahead of it", () => {
		const engine = new FakeEmbedder("engine", "needs-action");
		const ai = createLeuria({ providers: [engine, new FakeEmbedder("page", "ready")], ...quiet });
		expect(ai.getState().embedder).toEqual({ id: "page", label: "Embedder page", locality: "device", model: "page-model" });
		expect(ai.getState().embedPending?.id).toBe("engine");
		engine.set("ready");
		expect(ai.getState().embedder?.model).toBe("engine-model");
		expect(ai.getState().embedPending).toBeUndefined();
	});

	it("keeps embedders out of chat: never active, never offered, never picked", async () => {
		const page = new FakeEmbedder("page", "needs-action");
		const ai = createLeuria({ providers: [new ScriptedProvider("chat", () => "hi", { status: "unavailable" }), page], ...quiet });
		expect(ai.getState().pending).toBeUndefined();
		page.set("ready");
		expect(ai.getState().active).toBeUndefined();
		await expect(ai.chat({ prompt: "hi" }).text()).rejects.toBeInstanceOf(NoProviderError);
		expect(connection(ai, "chat").getState().status).toBe("not-running");
	});
});
