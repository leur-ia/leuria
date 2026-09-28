/**
 * @leuria/store: search by meaning over the page's own content, in the
 * visitor's browser. Built with the visitor's embedding model, private to
 * the site's origin, and it never leaves the device.
 *
 *   import { createIndex } from "@leuria/store"
 *   const notes = createIndex(ai, { name: "notes", documents })
 *   await notes.search("why did my glaze pull away")
 */

export { createIndex, VectorIndex } from "./vector-index.js";
export type { IndexDocument, IndexState, SearchHit, VectorIndexOptions } from "./vector-index.js";
export { defaultStorage, indexedDbStorage, memoryStorage } from "./storage.js";
export type { StoredVector, VectorStorage } from "./storage.js";
export { chunkMarkdown } from "./chunk.js";
