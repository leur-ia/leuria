import type { Leuria, ProviderInfo } from "@leuria/client";

import { defaultStorage, type StoredVector, type VectorStorage } from "./storage.js";

export interface IndexDocument<M = unknown> {
	/** Unique in the index. */
	id: string;
	/** What is embedded. */
	text: string;
	/** Anything to get back with a hit (title, URL…). */
	meta?: M;
}

export interface SearchHit<M = unknown> {
	id: string;
	/** Cosine similarity, -1..1 (higher is closer). */
	score: number;
	text: string;
	meta?: M;
}

export interface IndexState {
	/**
	 * - `waiting`: no embedding model is available yet (see `ai.getState().embedPending`);
	 * - `indexing`: embedding documents (`done` of `total`);
	 * - `ready`: every document is indexed with `model`;
	 * - `error`: the last attempt failed (`error`); it is tried again when the model changes.
	 */
	status: "waiting" | "indexing" | "ready" | "error";
	/** The model the index is built with. */
	model?: ProviderInfo & { model: string };
	done: number;
	total: number;
	error?: Error;
}

export interface VectorIndexOptions<M> {
	/** Names the index in storage; one per kind of content. */
	name: string;
	documents?: IndexDocument<M>[];
	/** Default IndexedDB, or memory when the browser has none. */
	storage?: VectorStorage;
	/** Texts per embedding request. Default 32. */
	batchSize?: number;
}

/** FNV-1a: enough to notice a changed text. */
function hash(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
}

function normalize(vector: number[]): Float32Array {
	const out = Float32Array.from(vector);
	let norm = 0;
	for (const x of out) norm += x * x;
	norm = Math.sqrt(norm) || 1;
	for (let i = 0; i < out.length; i++) out[i]! /= norm;
	return out;
}

function dot(a: Float32Array, b: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
	return sum;
}

const keyOf = (model: IndexState["model"]) => (model ? `${model.id}:${model.model}` : "");

/**
 * A vector index of the page's content in the visitor's browser, built
 * with whatever embedding model the visitor has (their own through
 * Leuria, or one in the page). Vectors from different models can't be
 * compared, so each model gets its own set, and the index follows the
 * model: when it changes, the index is built again (once per model; sets
 * are kept, so switching back is instant).
 *
 *   const notes = createIndex(ai, { name: "notes", documents })
 *   notes.subscribe(() => render(notes.getState()))
 *   const hits = await notes.search("why did my glaze pull away", { k: 5 })
 */
export class VectorIndex<M = unknown> {
	private state: IndexState = { status: "waiting", done: 0, total: 0 };
	private readonly listeners = new Set<() => void>();
	private documents: IndexDocument<M>[];
	private byId = new Map<string, IndexDocument<M>>();
	private vectors = new Map<string, StoredVector>();
	private readonly storage: VectorStorage;
	private readonly batchSize: number;
	private readonly stopWatching: () => void;
	/** Bumped by every rebuild: an older one stops. */
	private generation = 0;
	private building: Promise<void> = Promise.resolve();

	constructor(
		private readonly ai: Leuria,
		private readonly options: VectorIndexOptions<M>,
	) {
		this.storage = options.storage ?? defaultStorage();
		this.batchSize = options.batchSize ?? 32;
		this.documents = options.documents ?? [];
		this.byId = new Map(this.documents.map((d) => [d.id, d]));
		this.stopWatching = ai.subscribe(() => {
			if (keyOf(this.ai.getState().embedder) !== keyOf(this.state.model) || this.state.status === "waiting") this.rebuild();
		});
		this.rebuild();
	}

	getState = (): IndexState => this.state;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/** Replace the documents; only new and changed ones are embedded. */
	setDocuments(documents: IndexDocument<M>[]): Promise<void> {
		this.documents = documents;
		this.byId = new Map(documents.map((d) => [d.id, d]));
		return this.rebuild(true);
	}

	/** Build again now, e.g. after an error. */
	retry(): Promise<void> {
		return this.rebuild(true);
	}

	/** Resolves once the index is ready (or rejects when it can't be built). */
	async ready(): Promise<void> {
		for (;;) {
			const building = this.building;
			await building;
			if (building === this.building) break;
		}
		if (this.state.status === "error") throw this.state.error;
		if (this.state.status !== "ready") throw new Error("No embedding model is available yet.");
	}

	/** The documents closest in meaning to `query`. */
	async search(query: string, { k = 5, filter }: { k?: number; filter?: (doc: IndexDocument<M>) => boolean } = {}): Promise<SearchHit<M>[]> {
		await this.ready();
		const model = this.state.model!;
		const result = await this.ai.embed([query], { kind: "query", provider: model.id });
		if (result.model !== model.model) {
			// The model changed under us: build again, then search.
			await this.rebuild();
			return this.search(query, { k, filter });
		}
		return this.rank(normalize(result.vectors[0]!), k, (doc) => !filter || filter(doc));
	}

	/** The documents closest in meaning to one already indexed (no embedding needed). */
	async similar(id: string, { k = 5, filter }: { k?: number; filter?: (doc: IndexDocument<M>) => boolean } = {}): Promise<SearchHit<M>[]> {
		await this.ready();
		const vector = this.vectors.get(id)?.vector;
		if (!vector) return [];
		return this.rank(vector, k, (doc) => doc.id !== id && (!filter || filter(doc)));
	}

	/** Stop following the model. */
	destroy(): void {
		this.generation++;
		this.stopWatching();
		this.listeners.clear();
	}

	private rank(vector: Float32Array, k: number, keep: (doc: IndexDocument<M>) => boolean): SearchHit<M>[] {
		const hits: SearchHit<M>[] = [];
		for (const [id, stored] of this.vectors) {
			const doc = this.byId.get(id);
			if (!doc || !keep(doc)) continue;
			hits.push({ id, score: dot(vector, stored.vector), text: doc.text, meta: doc.meta });
		}
		return hits.sort((a, b) => b.score - a.score).slice(0, k);
	}

	private set(patch: Partial<IndexState>): void {
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) listener();
	}

	private rebuild(force = false): Promise<void> {
		const embedder = this.ai.getState().embedder;
		const same = keyOf(embedder) === keyOf(this.state.model);
		if (!force && same && (this.state.status === "indexing" || this.state.status === "ready" || (!embedder && this.state.status === "waiting"))) {
			return this.building;
		}
		const generation = ++this.generation;
		this.building = this.build(generation).catch((error: unknown) => {
			if (generation === this.generation) this.set({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
		});
		return this.building;
	}

	private async build(generation: number): Promise<void> {
		const current = () => generation === this.generation;
		const embedder = this.ai.getState().embedder;
		if (!embedder) {
			this.vectors = new Map();
			this.set({ status: "waiting", model: undefined, done: 0, total: this.documents.length, error: undefined });
			return;
		}
		const { name } = this.options;
		const stored = await this.storage.load(name, embedder.model);
		if (!current()) return;

		const hashes = new Map(this.documents.map((d) => [d.id, hash(d.text)]));
		const todo = this.documents.filter((d) => stored.get(d.id)?.hash !== hashes.get(d.id));
		const gone = [...stored.keys()].filter((id) => !hashes.has(id));
		for (const id of gone) stored.delete(id);
		this.vectors = stored;
		const total = this.documents.length;
		this.set({ status: todo.length ? "indexing" : "ready", model: embedder, done: total - todo.length, total, error: undefined });
		await this.storage.remove(name, embedder.model, gone);

		for (let i = 0; i < todo.length; i += this.batchSize) {
			const batch = todo.slice(i, i + this.batchSize);
			const result = await this.ai.embed(
				batch.map((d) => d.text),
				{ kind: "document", provider: embedder.id },
			);
			if (!current()) return;
			if (result.model !== embedder.model) throw new Error("The embedding model changed while indexing.");
			const records = batch.map((d, j) => ({ id: d.id, hash: hashes.get(d.id)!, vector: normalize(result.vectors[j]!) }));
			await this.storage.save(name, embedder.model, records);
			if (!current()) return;
			for (const { id, ...record } of records) this.vectors.set(id, record);
			this.set({ done: this.state.done + batch.length });
		}
		if (current()) this.set({ status: "ready" });
	}
}

export function createIndex<M = unknown>(ai: Leuria, options: VectorIndexOptions<M>): VectorIndex<M> {
	return new VectorIndex<M>(ai, options);
}
