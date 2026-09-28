import { afterEach, describe, expect, it, vi } from "vitest";

import { localEmbeddings, parseEmbedBody, withPrefix } from "../src/llm/embeddings.js";

afterEach(() => vi.unstubAllGlobals());

describe("withPrefix", () => {
	it("follows the model cards", () => {
		expect(withPrefix("nomic-embed-text-v1.5", "mugs", "query")).toBe("search_query: mugs");
		expect(withPrefix("nomic-embed-text-v1.5", "mugs", "document")).toBe("search_document: mugs");
		expect(withPrefix("multilingual-e5-small", "mugs", "document")).toBe("passage: mugs");
		expect(withPrefix("bge-small-en-v1.5", "mugs", "query")).toMatch(/^Represent this sentence/);
		expect(withPrefix("bge-small-en-v1.5", "mugs", "document")).toBe("mugs");
		expect(withPrefix("all-minilm", "mugs", "query")).toBe("mugs");
	});
});

describe("parseEmbedBody", () => {
	it("defaults to documents and trims long texts", () => {
		const { texts, kind } = parseEmbedBody({ texts: ["x".repeat(9000)] });
		expect(kind).toBe("document");
		expect(texts[0]).toHaveLength(8000);
	});
});

describe("localEmbeddings", () => {
	it("uses a loaded LM Studio embedding model, with its prefixes", async () => {
		const calls: Array<{ url: string; body?: unknown }> = [];
		vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
			calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
			if (url === "http://127.0.0.1:1234/api/v1/models") {
				return Response.json({
					models: [
						{ key: "qwen3-8b", type: "llm", loaded_instances: [{}] },
						{ key: "text-embedding-bge", type: "embedding" },
						{ key: "text-embedding-nomic-embed-text-v1.5", type: "embedding", loaded_instances: [{}] },
					],
				});
			}
			if (url === "http://127.0.0.1:1234/v1/embeddings") {
				return Response.json({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] });
			}
			throw new Error("offline");
		});
		const embeddings = localEmbeddings(() => undefined);
		expect((await embeddings.find())?.model).toBe("text-embedding-nomic-embed-text-v1.5");
		const result = await embeddings.embed(["a", "b"], "query");
		expect(result).toEqual({ model: "text-embedding-nomic-embed-text-v1.5", vectors: [[1, 0], [0, 1]] });
		expect(calls.at(-1)?.body).toEqual({ model: "text-embedding-nomic-embed-text-v1.5", input: ["search_query: a", "search_query: b"] });
	});

	it("finds nothing when no local service has an embedding model", async () => {
		vi.stubGlobal("fetch", async () => {
			throw new Error("offline");
		});
		const embeddings = localEmbeddings(() => undefined);
		expect(await embeddings.find()).toBeUndefined();
		await expect(embeddings.embed(["a"], "document")).rejects.toThrow(/No embedding model/);
	});
});

describe("the visitor's choice", () => {
	const lmStudio = () =>
		vi.stubGlobal("fetch", async (url: string) => {
			if (url === "http://127.0.0.1:1234/api/v1/models") {
				return Response.json({ models: [{ key: "bge-small", type: "embedding", loaded_instances: [{}] }, { key: "nomic-embed", type: "embedding" }] });
			}
			throw new Error("offline");
		});

	it("uses the chosen model, even when another is loaded", async () => {
		lmStudio();
		expect((await localEmbeddings(() => ({ provider: "lmstudio", model: "nomic-embed" })).find())?.model).toBe("nomic-embed");
	});

	it("gives nothing when off, or when the chosen model isn't there (never another one)", async () => {
		lmStudio();
		expect(await localEmbeddings(() => "off").find()).toBeUndefined();
		expect(await localEmbeddings(() => ({ provider: "lmstudio", model: "gone" })).find()).toBeUndefined();
	});

	it("looks again as soon as the choice changes", async () => {
		lmStudio();
		let choice: "off" | undefined = "off";
		const embeddings = localEmbeddings(() => choice);
		expect(await embeddings.find()).toBeUndefined();
		choice = undefined;
		expect((await embeddings.find())?.model).toBe("bge-small");
	});
});
