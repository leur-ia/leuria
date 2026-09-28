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

/** The worker, as ./worker.js does it, with Transformers.js from `from`. Keep the two in step. */
function workerSource(from: string): string {
	return `import { env, pipeline } from ${JSON.stringify(from)};
let extractor = null;
self.onmessage = async ({ data }) => {
	const { id, type } = data;
	try {
		if (type === "load") {
			env.allowLocalModels = false;
			if (data.remoteHost) env.remoteHost = data.remoteHost;
			extractor ??= await pipeline("feature-extraction", data.model, {
				dtype: "q8",
				progress_callback: (event) => {
					if (event.status !== "progress_total") return;
					const progress = event.total ? (event.loaded ?? 0) / event.total : (event.progress ?? 0) / 100;
					self.postMessage({ id, type: "progress", progress });
				},
			});
			self.postMessage({ id, type: "done" });
		} else if (type === "embed") {
			const output = await extractor(data.texts, { pooling: "mean", normalize: true });
			self.postMessage({ id, type: "done", vectors: output.tolist() });
		}
	} catch (error) {
		self.postMessage({ id, type: "error", message: error instanceof Error ? error.message : String(error) });
	}
};
`;
}

export function pageEmbedder(options: PageEmbedderOptions & { transformersUrl?: string } = {}): PageEmbedder {
	const source = workerSource(options.transformersUrl ?? TRANSFORMERS_URL);
	return new PageEmbedder(() => new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })), { type: "module" }), options);
}
