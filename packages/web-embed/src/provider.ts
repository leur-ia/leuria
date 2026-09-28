// The page model as a Leuria provider. How its worker starts is up to the entry point.

import { BaseProvider, type EmbedRequest, type EmbedResult, type ProviderSession } from "@leuria/client";

export interface PageEmbedderOptions {
	id?: string;
	label?: string;
	/** A Transformers.js feature-extraction model. Default `Xenova/bge-small-en-v1.5` (384 dimensions, English, made for search). */
	model?: string;
	/** Rough download size, said to the visitor before they agree. Default "about 40 MB". */
	size?: string;
	/** Put before each query (models trained for search want one). Default: the one from the model card for BGE and mxbai models, none otherwise. */
	queryPrefix?: string;
	/** Download without asking, on the first `embed`. Default false. */
	autoLoad?: boolean;
	/** Where the model files come from. Default Hugging Face (`https://huggingface.co/`); host them yourself to keep every request on your site. */
	remoteHost?: string;
}

type Reply = { id: number; type: "progress"; progress: number } | { id: number; type: "done"; vectors?: number[][] } | { id: number; type: "error"; message: string };

/** The model in a Web Worker (./worker.js), called like a function. */
class ModelWorker {
	private readonly worker: Worker;
	private next = 0;
	private readonly waiting = new Map<number, { resolve: (vectors?: number[][]) => void; reject: (error: Error) => void; progress?: (p: number) => void }>();

	constructor(create: () => Worker) {
		this.worker = create();
		this.worker.onmessage = ({ data }: MessageEvent<Reply>) => {
			const call = this.waiting.get(data.id);
			if (!call) return;
			if (data.type === "progress") call.progress?.(data.progress);
			else {
				this.waiting.delete(data.id);
				if (data.type === "done") call.resolve(data.vectors);
				else call.reject(new Error(data.message));
			}
		};
	}

	call(message: Record<string, unknown>, progress?: (p: number) => void): Promise<number[][] | undefined> {
		const id = this.next++;
		return new Promise((resolve, reject) => {
			this.waiting.set(id, { resolve, reject, progress });
			this.worker.postMessage({ ...message, id });
		});
	}

	terminate(): void {
		this.worker.terminate();
		for (const call of this.waiting.values()) call.reject(new Error("The model was stopped."));
		this.waiting.clear();
	}
}

const CACHE = "transformers-cache";
const BATCH = 16;

export class PageEmbedder extends BaseProvider {
	readonly offers = ["embed"] as const;
	readonly model: string;
	private readonly queryPrefix: string;
	private readonly options: PageEmbedderOptions;
	private loading: Promise<ModelWorker> | null = null;
	private worker: ModelWorker | null = null;

	/** `createWorker` starts the model's worker: bundled with the page, or with its runtime from a CDN. */
	constructor(
		private readonly createWorker: () => Worker,
		options: PageEmbedderOptions = {},
	) {
		super(options.id ?? "page-embed", options.label ?? "A model in this page", "device", { status: "unknown", capabilities: [] });
		this.options = options;
		this.model = options.model ?? "Xenova/bge-small-en-v1.5";
		this.queryPrefix = options.queryPrefix ?? (/bge-.*en|mxbai-embed/i.test(this.model) ? "Represent this sentence for searching relevant passages: " : "");
	}

	async detect(): Promise<void> {
		if (typeof WebAssembly === "undefined" || typeof Worker === "undefined") {
			this.setState({ status: "unavailable", capabilities: [], detail: "This browser can't run the model" });
			return;
		}
		if (this.worker || this.options.autoLoad || (await this.cached())) {
			this.ready();
			return;
		}
		if (this.loading) return;
		this.setState({
			status: "needs-action",
			action: "download",
			capabilities: [],
			detail: `A search model for this page must be downloaded first (${this.options.size ?? "about 40 MB"})`,
		});
	}

	/** Download the model (call it from a click). */
	async connect(): Promise<void> {
		await this.load();
	}

	async embed({ texts: input, kind, signal }: EmbedRequest): Promise<EmbedResult> {
		const worker = await this.load();
		const texts = kind === "query" && this.queryPrefix ? input.map((t) => this.queryPrefix + t) : input;
		const vectors: number[][] = [];
		for (let i = 0; i < texts.length; i += BATCH) {
			if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
			vectors.push(...((await worker.call({ type: "embed", texts: texts.slice(i, i + BATCH) })) ?? []));
		}
		return { vectors, model: this.model };
	}

	async createSession(): Promise<ProviderSession> {
		throw new Error("This model only embeds.");
	}

	private ready(): void {
		this.setState({ status: "ready", action: undefined, progress: undefined, capabilities: ["embed"], embedModel: this.model, detail: undefined });
	}

	private load(): Promise<ModelWorker> {
		this.loading ??= (async () => {
			const cached = await this.cached();
			if (!cached) this.setState({ status: "downloading", progress: 0, capabilities: [], detail: "The page's search model is downloading" });
			const worker = new ModelWorker(this.createWorker);
			try {
				await worker.call({ type: "load", model: this.model, remoteHost: this.options.remoteHost }, (progress) => {
					if (!cached) this.setState({ progress: Math.min(1, Math.max(0, progress)) });
				});
				this.worker = worker;
				this.ready();
				return worker;
			} catch (error) {
				worker.terminate();
				this.loading = null;
				this.setState({ status: "needs-action", action: "download", progress: undefined, capabilities: [], detail: "The search model couldn't be downloaded. Try again." });
				throw error;
			}
		})();
		return this.loading;
	}

	/** The model's files are already in the browser's cache. */
	private async cached(): Promise<boolean> {
		try {
			if (typeof caches === "undefined") return false;
			const cache = await caches.open(CACHE);
			return (await cache.keys()).some((request) => request.url.includes(`/${this.model}/`) && request.url.endsWith(".onnx"));
		} catch {
			return false;
		}
	}
}
