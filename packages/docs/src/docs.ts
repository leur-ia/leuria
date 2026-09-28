import { defineTool, exposeTools, type Leuria, type ToolDefinition } from "@leuria/client";
import { createIndex, type IndexState, type VectorIndex, type VectorStorage } from "@leuria/store";
import MiniSearch from "minisearch";

import { type DocsCorpus, type DocsPage, type DocsSection, pagePath } from "./corpus.js";

export interface DocsOptions {
	/** The corpus, or how to fetch it (called once, when first needed). */
	corpus: DocsCorpus | (() => Promise<DocsCorpus>);
	/**
	 * Show a page to the reader. Default: `location.assign`. Single-page
	 * sites pass their router's navigation.
	 */
	navigate?: (url: string) => void;
	/** The docs version the reader is on (versioned docs). Default: the version of the page open, else the corpus's default. */
	version?: () => string | undefined;
	/** Search by meaning, with the reader's embedding model. Default true. */
	meaning?: boolean;
	/** Names the vector index in the browser's storage. Default `docs`. */
	indexName?: string;
	/** Where vectors are kept. Default IndexedDB (memory when the browser has none). */
	storage?: VectorStorage;
}

export interface DocsHit {
	/** The section: `url#anchor`. */
	id: string;
	/** Where to send the reader: the page, and the section's anchor. */
	href: string;
	url: string;
	title: string;
	heading?: string;
	/** The start of the section's text, without its heading. */
	snippet: string;
	/** Found by words, by meaning, or both. */
	via: "words" | "meaning" | "both";
}

export interface DocsSearchOptions {
	/** Most hits. Default 8. */
	k?: number;
	/** `words` only, `meaning` only (when ready), or `both` (default). */
	by?: "words" | "meaning" | "both";
	/** Search every version, not only the reader's. */
	allVersions?: boolean;
}

/**
 * A docs site's content in the page: search by words at once, by meaning
 * once the reader has an embedding model, and the tools an assistant (or
 * the browser's own agents) uses to read the docs.
 */
export class Docs {
	private readonly options: DocsOptions;
	private loading?: Promise<DocsCorpus>;
	private corpus?: DocsCorpus;
	private words?: MiniSearch<DocsSection>;
	private byUrl = new Map<string, DocsPage>();
	private byId = new Map<string, DocsSection>();
	/** Search by meaning, built with the reader's model; created once the corpus is loaded. */
	index?: VectorIndex<{ url: string }>;
	private readonly listeners = new Set<() => void>();

	constructor(
		readonly ai: Leuria,
		options: DocsOptions,
	) {
		this.options = options;
		if (typeof options.corpus !== "function") this.use(options.corpus);
	}

	/** The corpus, fetched on first use. */
	load(): Promise<DocsCorpus> {
		if (this.corpus) return Promise.resolve(this.corpus);
		const source = this.options.corpus;
		this.loading ??= (typeof source === "function" ? source() : Promise.resolve(source)).then((corpus) => this.use(corpus));
		return this.loading;
	}

	get site(): string | undefined {
		return this.corpus?.site;
	}

	get pages(): DocsPage[] {
		return this.corpus?.pages ?? [];
	}

	/** The page at this address (any form: full URL, trailing slash, hash). */
	page(url: string): DocsPage | undefined {
		return this.byUrl.get(pagePath(url));
	}

	/** A section by its id (`url#anchor`). */
	section(id: string): DocsSection | undefined {
		return this.byId.get(id);
	}

	/** The page open on screen, if it is a docs page. */
	currentPage(): DocsPage | undefined {
		return typeof location === "undefined" ? undefined : this.page(location.pathname);
	}

	/** The version the reader is on. */
	version(): string | undefined {
		return this.options.version?.() ?? this.currentPage()?.version ?? this.corpus?.defaultVersion;
	}

	/** Search by meaning: waiting for a model, indexing, ready. */
	meaningState(): IndexState | undefined {
		return this.index?.getState();
	}

	/** Be told when the corpus loads or search by meaning changes state. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Search the docs: by words at once, merged with search by meaning when it is ready. */
	async search(query: string, { k = 8, by = "both", allVersions = false }: DocsSearchOptions = {}): Promise<DocsHit[]> {
		await this.load();
		const text = query.trim();
		if (!text) return [];
		const version = allVersions ? undefined : this.version();
		const inVersion = (section: DocsSection | undefined) => Boolean(section) && (!version || !section!.version || section!.version === version);

		const lists: Array<{ via: "words" | "meaning"; ids: string[] }> = [];
		if (by !== "meaning") {
			const ids = this.words!.search(text, { prefix: true, fuzzy: 0.2, boost: { title: 3, heading: 2 } })
				.map((hit) => String(hit.id))
				.filter((id) => inVersion(this.byId.get(id)));
			lists.push({ via: "words", ids: ids.slice(0, k * 2) });
		}
		if (by !== "words" && this.index?.getState().status === "ready") {
			try {
				const hits = await this.index.search(text, { k: k * 2, filter: (doc) => inVersion(this.byId.get(doc.id)) });
				lists.push({ via: "meaning", ids: hits.map((h) => h.id) });
			} catch {
				// Words still answer.
			}
		}

		// Reciprocal rank fusion: good in either list, better in both.
		const scores = new Map<string, { score: number; via: Set<"words" | "meaning"> }>();
		for (const { via, ids } of lists) {
			ids.forEach((id, rank) => {
				const entry = scores.get(id) ?? { score: 0, via: new Set() };
				entry.score += 1 / (60 + rank);
				entry.via.add(via);
				scores.set(id, entry);
			});
		}
		return [...scores.entries()]
			.sort((a, b) => b[1].score - a[1].score)
			.slice(0, k)
			.map(([id, { via }]) => this.hit(this.byId.get(id)!, via.size === 2 ? "both" : via.has("meaning") ? "meaning" : "words"));
	}

	/** Show a page to the reader. */
	open(url: string): void {
		(this.options.navigate ?? ((href) => location.assign(href)))(url);
	}

	/** Tools for the docs assistant: search, read a page, list the pages. */
	get tools(): ToolDefinition[] {
		return [this.searchTool, this.readTool, this.listTool];
	}

	/** Tools for the browser's own agents (WebMCP): the same, plus opening a page for the reader. */
	get pageTools(): ToolDefinition[] {
		return [...this.tools, this.openTool];
	}

	/** Offer `pageTools` to the browser's agents; returns how to take them back. */
	expose(): () => void {
		return exposeTools(this.pageTools);
	}

	destroy(): void {
		this.index?.destroy();
		this.listeners.clear();
	}

	private use(corpus: DocsCorpus): DocsCorpus {
		this.corpus = corpus;
		this.byUrl = new Map(corpus.pages.map((page) => [pagePath(page.url), page]));
		this.byId = new Map(corpus.sections.map((section) => [section.id, section]));
		this.words = new MiniSearch<DocsSection>({
			fields: ["title", "heading", "text"],
			storeFields: [],
			processTerm: (term) => {
				const word = term.toLowerCase();
				return STOPWORDS.has(word) ? null : word;
			},
		});
		this.words.addAll(corpus.sections);
		if (this.options.meaning !== false && !this.index) {
			this.index = createIndex(this.ai, {
				name: this.options.indexName ?? "docs",
				storage: this.options.storage,
				documents: corpus.sections.map((s) => ({ id: s.id, text: `${s.title}\n\n${s.text}`, meta: { url: s.url } })),
			});
			this.index.subscribe(() => this.notify());
		}
		this.notify();
		return corpus;
	}

	private notify(): void {
		for (const listener of [...this.listeners]) listener();
	}

	private hit(section: DocsSection, via: DocsHit["via"]): DocsHit {
		const body = section.heading ? section.text.slice(section.heading.length).trim() : section.text;
		return {
			id: section.id,
			href: section.anchor ? `${section.url}#${section.anchor}` : section.url,
			url: section.url,
			title: section.title,
			heading: section.heading,
			snippet: plain(body).slice(0, 240),
			via,
		};
	}

	private readonly searchTool = defineTool<{ query: string }>({
		name: "search_docs",
		description:
			"Search the documentation, by words and by meaning. Returns the closest sections: page title, section, link and the passage that matched. Search again with other words if nothing fits.",
		inputSchema: { type: "object", properties: { query: { type: "string", description: "What to look for, in a few words." } }, required: ["query"] },
		annotations: { readOnlyHint: true },
		execute: async ({ query }) => {
			const hits = await this.search(query, { k: 6 });
			if (hits.length === 0) return { hits: [], note: "Nothing matched. Try other words, or list_pages." };
			return hits.map((hit) => ({
				page: hit.title,
				section: hit.heading,
				link: hit.href,
				passage: this.byId.get(hit.id)!.text.slice(0, 700),
			}));
		},
	});

	private readonly readTool = defineTool<{ url: string }>({
		name: "read_page",
		description: "Read a whole documentation page, as Markdown, by its link (from search_docs or list_pages).",
		inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
		annotations: { readOnlyHint: true },
		execute: async ({ url }) => {
			await this.load();
			const page = this.page(url);
			if (!page) throw new Error(`No page at ${url}. Use a link from search_docs or list_pages.`);
			const limit = 24_000;
			return {
				title: page.title,
				link: page.url,
				markdown: page.markdown.length > limit ? `${page.markdown.slice(0, limit)}\n\n[The rest of the page is cut.]` : page.markdown,
			};
		},
	});

	private readonly listTool = defineTool({
		name: "list_pages",
		description: "List the documentation's pages: title, link and summary.",
		inputSchema: { type: "object", properties: {} },
		annotations: { readOnlyHint: true },
		execute: async () => {
			await this.load();
			const version = this.version();
			return this.pages
				.filter((page) => !version || !page.version || page.version === version)
				.slice(0, 300)
				.map((page) => ({ title: page.title, link: page.url, summary: page.description }));
		},
	});

	private readonly openTool = defineTool<{ url: string }>({
		name: "open_page",
		description: "Open a documentation page on screen for the reader, by its link. A link may end with #section.",
		inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
		execute: async ({ url }) => {
			await this.load();
			const page = this.page(url);
			if (!page) throw new Error(`No page at ${url}.`);
			const hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
			this.open(`${page.url}${hash}`);
			return { opened: page.title };
		},
	});
}

/** Words that match everything: questions are full of them. */
export const STOPWORDS = new Set(
	"a an and are as at be by can do does for from how i if in into is it its me my of on or so than that the their then there these this to use using was what when where which who why will with you your".split(" "),
);

/** Markdown to plain text, enough for a snippet. */
export function plain(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/[`*_>#|]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** The docs of a site, for the Ask panel, search and the browser's agents. */
export function createDocs(ai: Leuria, options: DocsOptions): Docs {
	return new Docs(ai, options);
}
