import "fake-indexeddb/auto";

import { BaseProvider, createLeuria, type EmbedRequest, type EmbedResult, type Leuria, type ProviderSession, type ProviderState } from "@leuria/client";
import { afterEach, describe, expect, it } from "vitest";

import { chunkMarkdown, createIndex, indexedDbStorage, memoryStorage, type VectorIndex } from "../src/index.js";

/** Three-dimensional "meaning": counts of words about glaze, fire and tea. */
const TOPICS = [/glaze|beads|bare/g, /fire|kiln|flame/g, /tea|kettle|cup/g];

class TopicEmbedder extends BaseProvider {
	readonly offers = ["embed"] as const;
	calls: EmbedRequest[] = [];
	constructor(id: string, private readonly model: string, status: ProviderState["status"] = "ready") {
		super(id, id, "device", status === "ready" ? { status, capabilities: ["embed"], embedModel: model } : { status, capabilities: [] });
	}
	set(status: ProviderState["status"]): void {
		this.setState(status === "ready" ? { status, capabilities: ["embed"], embedModel: this.model } : { status, capabilities: [], embedModel: undefined });
	}
	async detect(): Promise<void> {}
	async embed(request: EmbedRequest): Promise<EmbedResult> {
		this.calls.push(request);
		return { model: this.model, vectors: request.texts.map((t) => TOPICS.map((re) => (t.match(re)?.length ?? 0) + 0.01)) };
	}
	async createSession(): Promise<ProviderSession> {
		throw new Error("no chat");
	}
}

const DOCS = [
	{ id: "crawling", text: "The glaze pulled back into beads, leaving bare clay.", meta: { title: "Crawling" } },
	{ id: "firing", text: "Fire the kiln slowly; watch the flame colour.", meta: { title: "Firing" } },
	{ id: "tea", text: "First light, the kettle, a warm cup of tea.", meta: { title: "Tea" } },
];

let ai: Leuria;
let index: VectorIndex<{ title: string }> | undefined;
afterEach(() => {
	index?.destroy();
	ai.destroy();
});

describe("createIndex", () => {
	it("builds with the visitor's model and finds by meaning", async () => {
		const engine = new TopicEmbedder("engine", "topics-v1");
		ai = createLeuria({ providers: [engine], autoDetect: false, closeOnUnload: false });
		index = createIndex(ai, { name: "notes", documents: DOCS, storage: memoryStorage() });
		await index.ready();
		expect(index.getState()).toMatchObject({ status: "ready", done: 3, total: 3, model: { id: "engine", model: "topics-v1" } });
		const hits = await index.search("why is my glaze full of beads?", { k: 2 });
		expect(hits[0]).toMatchObject({ id: "crawling", meta: { title: "Crawling" } });
		expect(engine.calls.at(-1)?.kind).toBe("query");
		expect((await index.similar("tea", { k: 1 }))[0]?.id).not.toBe("tea");
	});

	it("waits for a model, then builds as soon as one is ready", async () => {
		const page = new TopicEmbedder("page", "topics-v1", "needs-action");
		ai = createLeuria({ providers: [page], autoDetect: false, closeOnUnload: false });
		index = createIndex(ai, { name: "notes", documents: DOCS, storage: memoryStorage() });
		expect(index.getState().status).toBe("waiting");
		await expect(index.ready()).rejects.toThrow(/No embedding model/);
		page.set("ready");
		await index.ready();
		expect(index.getState().status).toBe("ready");
	});

	it("follows the model: a new model rebuilds, the old set is kept for switching back", async () => {
		const engine = new TopicEmbedder("engine", "big-model", "unavailable");
		const page = new TopicEmbedder("page", "small-model");
		ai = createLeuria({ providers: [engine, page], autoDetect: false, closeOnUnload: false });
		const storage = memoryStorage();
		index = createIndex(ai, { name: "notes", documents: DOCS, storage });
		await index.ready();
		expect(index.getState().model?.model).toBe("small-model");
		engine.set("ready");
		await index.ready();
		expect(index.getState().model?.model).toBe("big-model");
		expect(engine.calls).toHaveLength(1);
		engine.set("unavailable");
		await index.ready();
		expect(page.calls).toHaveLength(1); // Nothing embedded again.
	});

	it("embeds only new and changed documents", async () => {
		const engine = new TopicEmbedder("engine", "topics-v1");
		ai = createLeuria({ providers: [engine], autoDetect: false, closeOnUnload: false });
		index = createIndex(ai, { name: "notes", documents: DOCS, storage: memoryStorage(), batchSize: 2 });
		await index.ready();
		expect(engine.calls.map((c) => c.texts.length)).toEqual([2, 1]);
		await index.setDocuments([{ ...DOCS[0]!, text: "Glaze crawled again." }, DOCS[1]!]);
		expect(engine.calls.at(-1)?.texts).toEqual(["Glaze crawled again."]);
		expect(index.getState().total).toBe(2);
		expect((await index.search("tea", { k: 5 })).map((h) => h.id)).not.toContain("tea");
	});

	it("keeps vectors in IndexedDB across page loads", async () => {
		const storage = indexedDbStorage();
		const engine = new TopicEmbedder("engine", "topics-v1");
		ai = createLeuria({ providers: [engine], autoDetect: false, closeOnUnload: false });
		index = createIndex(ai, { name: "idb", documents: DOCS, storage });
		await index.ready();
		index.destroy();
		index = createIndex(ai, { name: "idb", documents: DOCS, storage: indexedDbStorage() });
		await index.ready();
		expect(engine.calls).toHaveLength(1);
		expect((await index.search("kiln flame"))[0]?.id).toBe("firing");
	});
});

describe("chunkMarkdown", () => {
	it("splits by heading and keeps the heading with each chunk", () => {
		const chunks = chunkMarkdown("# Celadon\n\nIron in reduction.\n\n## Firing\n\nCone 10.", { maxChars: 50 });
		expect(chunks).toEqual([
			{ heading: "Celadon", text: "Celadon\n\nIron in reduction." },
			{ heading: "Firing", text: "Firing\n\nCone 10." },
		]);
	});

	it("does not take a comment in a code block for a heading", () => {
		const chunks = chunkMarkdown("# Install\n\n```sh\n# first\nnpx leuria\n```\n\nDone.");
		expect(chunks).toEqual([{ heading: "Install", text: "Install\n\n```sh\n# first\nnpx leuria\n```\n\nDone." }]);
	});
});
