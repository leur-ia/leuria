/**
 * @leuria/web-embed/cdn: the same page model, with its runtime
 * (Transformers.js) loaded from a CDN when the visitor asks for it,
 * instead of bundled with the page. For sites whose bundler can't pack
 * Transformers.js, such as Docusaurus.
 *
 *   import { pageEmbedder } from "@leuria/web-embed/cdn"
 */

import { PageEmbedder, type PageEmbedderOptions } from "./provider.js";

export type { PageEmbedderOptions } from "./provider.js";
export { PageEmbedder } from "./provider.js";

/** The Transformers.js this package is tested with. */
export const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/+esm";

/** ./listen.js as text, inlined by the build (tsup.config.ts). */
declare const WORKER_LISTEN: string;

/** The worker, as ./worker.js does it, with Transformers.js from `from`. */
function workerSource(from: string): string {
	return `${WORKER_LISTEN}\nimport { env, pipeline } from ${JSON.stringify(from)};\nlisten(env, pipeline);\n`;
}

export function pageEmbedder(options: PageEmbedderOptions & { transformersUrl?: string } = {}): PageEmbedder {
	const source = workerSource(options.transformersUrl ?? TRANSFORMERS_URL);
	return new PageEmbedder(() => new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })), { type: "module" }), options);
}
