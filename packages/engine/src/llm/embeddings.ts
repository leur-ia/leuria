/**
 * Embeddings for sites, from an embedding model on this computer (LM
 * Studio or Ollama). Only local services: a site indexing its pages must
 * not send them to a cloud service or spend the visitor's API credits.
 *
 *   POST /embed   { texts: string[], kind?: "query" | "document" }  →  { model, vectors }
 */

import { type EmbedChoice, loadConfig } from "../home.js";
import { authHeaders, EMBEDDING, type LlmProvider, listProviders } from "./providers.js";

export interface Embedder {
	provider: LlmProvider;
	model: string;
}

export interface Embeddings {
	/** The embedding model sites get now, if any. Cheap: cached for a few seconds. */
	find: () => Promise<Embedder | undefined>;
	embed: (texts: string[], kind: "query" | "document") => Promise<{ model: string; vectors: number[][] }>;
}

export class NoEmbedderError extends Error {
	constructor() {
		super("No embedding model on this computer. Load one in LM Studio or Ollama.");
		this.name = "NoEmbedderError";
	}
}

function isLocal(provider: LlmProvider): boolean {
	if (provider.kind !== "lmstudio" && provider.kind !== "ollama") return false;
	const host = new URL(provider.baseUrl).hostname;
	return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

interface EmbeddingModel {
	id: string;
	/** LM Studio reports whether it is loaded in memory (it answers at once). */
	loaded?: boolean;
}

/** Embedding models of a local service, loaded ones first. Empty when it isn't running. */
async function listEmbeddingModels(provider: LlmProvider, timeoutMs = 1500): Promise<EmbeddingModel[]> {
	const root = provider.baseUrl.replace(/\/v\d+$/, "");
	const get = <T>(url: string) =>
		fetch(url, { headers: authHeaders(provider), signal: AbortSignal.timeout(timeoutMs) })
			.then((r) => (r.ok ? (r.json() as Promise<T>) : null))
			.catch(() => null);
	if (provider.kind === "lmstudio") {
		const native = await get<{ models?: Array<{ key: string; type: string; loaded_instances?: unknown[] }> }>(`${root}/api/v1/models`);
		if (native?.models) {
			return native.models
				.filter((m) => m.type === "embedding")
				.map((m) => ({ id: m.key, loaded: (m.loaded_instances?.length ?? 0) > 0 }))
				.sort((a, b) => Number(b.loaded) - Number(a.loaded));
		}
	}
	if (provider.kind === "ollama") {
		const tags = await get<{ models?: Array<{ name: string; remote_host?: string }> }>(`${root}/api/tags`);
		return (tags?.models ?? []).filter((m) => !m.remote_host && EMBEDDING.test(m.name)).map((m) => ({ id: m.name }));
	}
	const list = await get<{ data?: Array<{ id?: unknown; type?: unknown }> }>(`${provider.baseUrl}/models`);
	return (list?.data ?? [])
		.filter((m): m is { id: string; type?: unknown } => typeof m.id === "string")
		.filter((m) => m.type === "embedding" || EMBEDDING.test(m.id))
		.map((m) => ({ id: m.id }));
}

/** Every embedding model on this computer, by service (LM Studio, Ollama). */
export async function listLocalEmbedders(): Promise<Array<{ provider: LlmProvider; model: EmbeddingModel }>> {
	const found = await Promise.all(
		listProviders()
			.filter(isLocal)
			.map(async (provider) => (await listEmbeddingModels(provider)).map((model) => ({ provider, model }))),
	);
	return found.flat();
}

/**
 * Some models embed queries and documents differently, with a prefix
 * (from their model cards). Others take the text as it is.
 */
export function withPrefix(model: string, text: string, kind: "query" | "document"): string {
	if (/nomic-embed/i.test(model)) return `${kind === "query" ? "search_query" : "search_document"}: ${text}`;
	if (/(^|[/-])e5-/i.test(model)) return `${kind === "query" ? "query" : "passage"}: ${text}`;
	if (kind === "query" && /bge-.*en|mxbai-embed/i.test(model)) return `Represent this sentence for searching relevant passages: ${text}`;
	return text;
}

const CACHE_MS = 10_000;

/**
 * Embeddings from LM Studio or Ollama on this computer: the model the
 * visitor chose (`config.embed`), or the first one found (a loaded one
 * first). A chosen model that isn't available now gives nothing rather
 * than another model: the visitor picked it.
 */
export function localEmbeddings(choice: () => EmbedChoice | undefined = () => loadConfig().embed): Embeddings {
	let cached: { at: number; key: string; value: Promise<Embedder | undefined> } | undefined;

	const find = () => {
		const chosen = choice();
		const key = JSON.stringify(chosen ?? "auto");
		if (!cached || cached.key !== key || Date.now() - cached.at > CACHE_MS) {
			const value = (async (): Promise<Embedder | undefined> => {
				if (chosen === "off") return undefined;
				if (chosen) {
					const provider = listProviders().find((p) => p.id === chosen.provider);
					if (!provider || !isLocal(provider)) return undefined;
					const models = await listEmbeddingModels(provider);
					return models.some((m) => m.id === chosen.model) ? { provider, model: chosen.model } : undefined;
				}
				for (const provider of listProviders().filter(isLocal)) {
					const [model] = await listEmbeddingModels(provider);
					if (model) return { provider, model: model.id };
				}
				return undefined;
			})();
			cached = { at: Date.now(), key, value };
		}
		return cached.value;
	};

	return {
		find,
		embed: async (texts, kind) => {
			const embedder = await find();
			if (!embedder) throw new NoEmbedderError();
			const { provider, model } = embedder;
			const res = await fetch(`${provider.baseUrl}/embeddings`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...authHeaders(provider) },
				body: JSON.stringify({ model, input: texts.map((t) => withPrefix(model, t, kind)) }),
				signal: AbortSignal.timeout(120_000),
			}).catch(() => null);
			if (!res?.ok) {
				cached = undefined; // Look again next time: the model may have been unloaded.
				throw new Error(`${provider.name} couldn't embed the texts.`);
			}
			const body = (await res.json()) as { data?: Array<{ index?: number; embedding?: number[] }> };
			const data = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
			if (data.length !== texts.length || data.some((d) => !Array.isArray(d.embedding))) {
				throw new Error(`${provider.name} returned an unexpected answer.`);
			}
			return { model, vectors: data.map((d) => d.embedding!) };
		},
	};
}

const MAX_EMBED_TEXTS = 256;
const MAX_EMBED_CHARS = 8000;

/** Validate `POST /embed`'s body. Throws on bad input. */
export function parseEmbedBody(body: unknown): { texts: string[]; kind: "query" | "document" } {
	const { texts, kind } = (body ?? {}) as { texts?: unknown; kind?: unknown };
	if (!Array.isArray(texts) || texts.length === 0 || !texts.every((t) => typeof t === "string")) {
		throw new Error("texts must be a non-empty array of strings");
	}
	if (texts.length > MAX_EMBED_TEXTS) throw new Error(`At most ${MAX_EMBED_TEXTS} texts per request`);
	if (kind !== undefined && kind !== "query" && kind !== "document") throw new Error('kind must be "query" or "document"');
	return { texts: texts.map((t: string) => t.slice(0, MAX_EMBED_CHARS)), kind: kind ?? "document" };
}
