// The page model runs here, off the page's main thread, so the page stays
// responsive while it downloads and embeds. Plain JavaScript: bundlers pick
// it up through `new URL("./worker.js", import.meta.url)`, from source or
// from dist.
import { env, pipeline } from "@huggingface/transformers";

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
