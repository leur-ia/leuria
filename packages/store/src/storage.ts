/** Where vectors are kept: one set per index and model. */
export interface VectorStorage {
	load(index: string, model: string): Promise<Map<string, StoredVector>>;
	save(index: string, model: string, records: Array<{ id: string } & StoredVector>): Promise<void>;
	remove(index: string, model: string, ids: string[]): Promise<void>;
}

export interface StoredVector {
	/** Hash of the text it was made from: a changed text is embedded again. */
	hash: string;
	vector: Float32Array;
}

export function memoryStorage(): VectorStorage {
	const sets = new Map<string, Map<string, StoredVector>>();
	const set = (index: string, model: string) => {
		const key = `${index}\u0000${model}`;
		let found = sets.get(key);
		if (!found) sets.set(key, (found = new Map()));
		return found;
	};
	return {
		load: async (index, model) => new Map(set(index, model)),
		save: async (index, model, records) => {
			for (const { id, hash, vector } of records) set(index, model).set(id, { hash, vector });
		},
		remove: async (index, model, ids) => {
			for (const id of ids) set(index, model).delete(id);
		},
	};
}

const DB = "leuria-store";
const STORE = "vectors";

function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

/** IndexedDB: private to the site's origin, and it never leaves the device. */
export function indexedDbStorage(factory: IDBFactory = indexedDB): VectorStorage {
	let opening: Promise<IDBDatabase> | null = null;
	const open = () =>
		(opening ??= new Promise((resolve, reject) => {
			const req = factory.open(DB, 1);
			req.onupgradeneeded = () => {
				const store = req.result.createObjectStore(STORE, { keyPath: ["index", "model", "id"] });
				store.createIndex("set", ["index", "model"]);
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		}));

	return {
		load: async (index, model) => {
			const db = await open();
			const rows = await request(db.transaction(STORE).objectStore(STORE).index("set").getAll([index, model]));
			return new Map(rows.map((r: { id: string; hash: string; vector: Float32Array }) => [r.id, { hash: r.hash, vector: r.vector }]));
		},
		save: async (index, model, records) => {
			const db = await open();
			const tx = db.transaction(STORE, "readwrite");
			for (const { id, hash, vector } of records) tx.objectStore(STORE).put({ index, model, id, hash, vector });
			await done(tx);
		},
		remove: async (index, model, ids) => {
			if (ids.length === 0) return;
			const db = await open();
			const tx = db.transaction(STORE, "readwrite");
			for (const id of ids) tx.objectStore(STORE).delete([index, model, id]);
			await done(tx);
		},
	};
}

/** IndexedDB when the browser has it, memory otherwise (private windows, tests). */
export function defaultStorage(): VectorStorage {
	return typeof indexedDB === "undefined" ? memoryStorage() : indexedDbStorage();
}
