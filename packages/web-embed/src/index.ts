/**
 * @leuria/web-embed: a small embedding model that runs in the page, for
 * visitors whose own AI can't embed. Put it after `leuria()`:
 *
 *   const ai = createAI({ providers: [leuria(), promptAPI(), pageEmbedder()] })
 *
 * The model and its runtime (about 40 MB) are downloaded once, when the visitor asks for
 * it (`ai.connect("page-embed")`, from a click), then kept in the
 * browser's cache. Texts never leave the page.
 */

import { PageEmbedder, type PageEmbedderOptions } from "./provider.js";

export { PageEmbedder } from "./provider.js";
export type { PageEmbedderOptions } from "./provider.js";

export function pageEmbedder(options?: PageEmbedderOptions): PageEmbedder {
	return new PageEmbedder(() => new Worker(new URL("./worker.js", import.meta.url), { type: "module" }), options);
}
