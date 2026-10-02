/**
 * @leuria/docusaurus: Ask AI for any Docusaurus site, on the reader's own
 * AI. The site holds no API keys and pays nothing per question.
 *
 *   // docusaurus.config.js
 *   plugins: [["@leuria/docusaurus", { suggestions: ["How do I get started?"] }]]
 *
 * It adds an "Ask AI" button to the navbar, and a panel that answers from
 * the site's docs with links to the pages. It works next to any search
 * (Algolia DocSearch, local search): it replaces no theme component. Sites
 * without a search can add Leuria's (`search: true`), by words and by meaning.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { LoadContext, Plugin } from "@docusaurus/types";
import { buildCorpus, type DocsPage } from "@leuria/docs/build";

/**
 * Your own Chat Completions endpoint, as the last resort. Everything here
 * reaches the page: put no API key in it, add the key on the server.
 */
export interface ServerOptions {
	/** Chat Completions URL, e.g. `/api/ai/chat/completions`. */
	url: string;
	/** Sent as `model`. Needed by endpoints that don't pick one (LiteLLM, OpenRouter…). */
	model?: string;
	/** The endpoint supports `response_format: { type: "json_schema" }`. Default false. */
	jsonSchema?: boolean;
	/** The endpoint supports tool calls. Default true. */
	tools?: boolean;
	/** The endpoint accepts images. Default false. */
	images?: boolean;
	/** The name readers see when they pick it, e.g. "This site's AI". */
	label?: string;
}

export interface Options {
	/** The name Leuria shows when the reader connects the site. Default: the site's title. */
	app?: string;
	/** The name the assistant gives the docs. Default: the site's title. */
	site?: string;
	/** The Ask panel's title. Default "Ask the docs". */
	title?: string;
	/** Questions offered before the first one. */
	suggestions?: string[];
	/** Replaces the assistant's instructions. */
	system?: string;
	/**
	 * Where the Ask button goes: `navbar` (default), `floating` (bottom
	 * right), or `none` (you place `<leuria-ask-button>` yourself).
	 */
	askButton?: "navbar" | "floating" | "none";
	/**
	 * Add a search to the navbar (⌘K), by words and by meaning. For sites
	 * without one: leave it off next to Algolia DocSearch or a local search.
	 * Default false.
	 */
	search?: boolean;
	/** Also put the "Connect your AI" button in the navbar. Default false: the Ask panel offers it when needed. */
	connectButton?: boolean;
	/** Offer the docs tools to the browser's own agents (WebMCP). Default true. */
	webmcp?: boolean;
	/**
	 * A small embedding model in the page (`@leuria/web-embed`, about 40 MB,
	 * downloaded when the reader agrees) for readers whose AI can't embed.
	 * Its runtime comes from a CDN (jsDelivr) and the model from Hugging
	 * Face. Install `@leuria/web-embed` to use it. Default false.
	 */
	pageEmbeddings?: boolean;
	/**
	 * What the Ask panel needs, so Leuria recommends a model that fits and no
	 * bigger. Default `{ tools: true, effort: "light" }`: it searches and reads
	 * your pages, then answers.
	 */
	needs?: Needs;
	/**
	 * Skills that guide the reader's AI on your site, in the `npx skills`
	 * syntax: `"/"` for your site's own `static/.well-known/agent-skills/`,
	 * `owner/repo`, `owner/repo@skill`, or `owner/repo/path#commit` pinned to
	 * a commit. Leuria fetches them, shows them to the reader when they
	 * connect, and gives them to their AI on your site only. Readers without
	 * the Leuria app don't get them.
	 */
	skills?: string[];
	/** Your server as the last resort, for readers with no AI of their own. */
	server?: ServerOptions;
	/**
	 * Readers without Leuria: `ask` (default) proposes Leuria first, and this
	 * browser's AI or your server answer only once the reader picks one (for
	 * the page); `auto` uses them at once.
	 */
	fallback?: "ask" | "auto";
	/** Only these docs plugin instances. Default: every one. */
	docsPluginIds?: string[];
}

/** What the Ask panel needs from a model. */
export type Needs = { tools?: boolean; images?: boolean; effort?: "light" | "standard" | "deep"; context?: number };

/** What the client module gets, as JSON. */
export type ClientConfig = Pick<Options, "title" | "suggestions" | "system" | "server" | "skills"> &
	Required<Pick<Options, "app" | "askButton" | "webmcp" | "fallback" | "needs">>;

const NAME = "@leuria/docusaurus";

interface LoadedDoc {
	title: string;
	description?: string;
	source: string;
	permalink: string;
	unlisted?: boolean;
	draft?: boolean;
}
interface LoadedVersion {
	versionName: string;
	isLast: boolean;
	docs: LoadedDoc[];
}

/** The pages of every docs plugin instance, and the version readers land on. */
function docsPages(context: LoadContext, allContent: Record<string, Record<string, unknown>>, ids?: string[]) {
	const pages: DocsPage[] = [];
	let defaultVersion: string | undefined;
	const instances = allContent["docusaurus-plugin-content-docs"] ?? {};
	for (const [id, content] of Object.entries(instances)) {
		if (ids && !ids.includes(id)) continue;
		const versions = (content as { loadedVersions?: LoadedVersion[] }).loadedVersions ?? [];
		const versioned = versions.length > 1;
		for (const version of versions) {
			if (versioned && version.isLast) defaultVersion ??= version.versionName;
			for (const doc of version.docs) {
				if (doc.unlisted || doc.draft) continue;
				const file = doc.source.replace(/^@site\//, `${context.siteDir}/`);
				let markdown: string;
				try {
					markdown = readFileSync(file, "utf8");
				} catch {
					continue;
				}
				pages.push({
					url: doc.permalink,
					title: doc.title,
					description: doc.description,
					markdown,
					version: versioned ? version.versionName : undefined,
				});
			}
		}
	}
	return { pages, defaultVersion };
}

interface NavbarItem {
	type?: string;
	position?: string;
	value?: string;
	className?: string;
}

/** Put the buttons in the navbar, before the search, once. */
function addNavbarItems(context: LoadContext, items: NavbarItem[]): void {
	const navbar = (context.siteConfig.themeConfig as { navbar?: { items?: NavbarItem[] } }).navbar;
	if (!navbar) return;
	navbar.items ??= [];
	for (const item of items) {
		if (!navbar.items.some((existing) => existing.value === item.value)) navbar.items.push(item);
	}
}

export default function leuriaDocusaurus(context: LoadContext, options: Options = {}): Plugin {
	const dir = join(context.generatedFilesDir, "leuria");
	const files = {
		config: join(dir, "config.json"),
		corpus: join(dir, "corpus.json"),
		embedder: join(dir, "embedder.js"),
	};
	const title = context.siteConfig.title;
	const askButton = options.askButton ?? "navbar";
	const config: ClientConfig = {
		app: options.app ?? title,
		title: options.title,
		suggestions: options.suggestions,
		system: options.system,
		askButton,
		webmcp: options.webmcp ?? true,
		server: options.server,
		skills: options.skills,
		fallback: options.fallback ?? "ask",
		needs: options.needs ?? { tools: true, effort: "light" },
	};

	mkdirSync(dir, { recursive: true });
	writeFileSync(files.config, JSON.stringify(config));
	writeFileSync(files.corpus, JSON.stringify({ pages: [], sections: [] }));
	// Imported only when the site asks for it, so sites without it need not install it.
	writeFileSync(
		files.embedder,
		options.pageEmbeddings
			? `export default function load() { return import("@leuria/web-embed/cdn").then((m) => m.pageEmbedder()); }\n`
			: "export default null;\n",
	);

	const items: NavbarItem[] = [];
	if (options.search) items.push({ type: "html", position: "right", value: "<leuria-search-button></leuria-search-button>", className: "leuria-navbar-item" });
	if (askButton === "navbar") items.push({ type: "html", position: "right", value: "<leuria-ask-button></leuria-ask-button>", className: "leuria-navbar-item" });
	if (options.connectButton) {
		items.push({ type: "html", position: "right", value: '<leuria-connect-button size="1" hide-byline></leuria-connect-button>', className: "leuria-navbar-item" });
	}
	addNavbarItems(context, items);

	return {
		name: NAME,

		async allContentLoaded({ allContent }) {
			const { pages, defaultVersion } = docsPages(context, allContent as Record<string, Record<string, unknown>>, options.docsPluginIds);
			const corpus = buildCorpus(pages, { site: options.site ?? title, defaultVersion });
			writeFileSync(files.corpus, JSON.stringify(corpus));
		},

		configureWebpack() {
			return {
				resolve: {
					alias: {
						"@leuria-docusaurus/config": files.config,
						"@leuria-docusaurus/corpus": files.corpus,
						"@leuria-docusaurus/embedder": files.embedder,
					},
				},
			};
		},

		getClientModules() {
			return [fileURLToPath(new URL("./client/index.js", import.meta.url))];
		},

		injectHtmlTags() {
			// Room for the buttons in the navbar, before the page's CSS loads.
			return {
				headTags: [
					{
						tagName: "style",
						innerHTML:
							".leuria-navbar-item{display:inline-flex;align-items:center;padding:0 var(--ifm-navbar-item-padding-horizontal,.75rem)}leuria-ask{--leuria-ask-top:calc(var(--ifm-navbar-height,3.75rem) + 8px)}",
					},
				],
			};
		},
	};
}

export function validateOptions({ options }: { options?: Options & { id?: string } }): Options & { id: string } {
	const value = options ?? {};
	if (value.askButton && !["navbar", "floating", "none"].includes(value.askButton)) {
		throw new Error(`${NAME}: askButton must be "navbar", "floating" or "none".`);
	}
	if (value.suggestions && !Array.isArray(value.suggestions)) throw new Error(`${NAME}: suggestions must be a list of questions.`);
	if (value.server && typeof value.server.url !== "string") throw new Error(`${NAME}: server needs a url.`);
	if (value.server?.model !== undefined && typeof value.server.model !== "string") throw new Error(`${NAME}: server.model must be a string.`);
	if (value.skills && (!Array.isArray(value.skills) || value.skills.some((ref) => typeof ref !== "string" || !ref))) {
		throw new Error(`${NAME}: skills must be a list of skill refs, e.g. ["/"] or ["owner/repo/path#commit"].`);
	}
	if (value.fallback && !["ask", "auto"].includes(value.fallback)) throw new Error(`${NAME}: fallback must be "ask" or "auto".`);
	// Docusaurus fills in the instance id only for plugins without a validator.
	return { ...value, id: value.id ?? "default" };
}
