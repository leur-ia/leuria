import {
	BaseProvider,
	createLeuria,
	type EmbedRequest,
	type EmbedResult,
	type Leuria,
	type Message,
	type ProviderSession,
	type TurnContext,
} from "@leuria/client";
import { memoryStorage } from "@leuria/store";
import { afterEach, describe, expect, it } from "vitest";

import { buildCorpus, cleanMarkdown } from "../src/build.js";
import { createDocs, type Docs, openAsk, openSearch, renderMarkdown, setupDocs } from "../src/index.js";

const PAGES = [
	{
		url: "/docs/tools/",
		title: "Page tools",
		version: "2.0",
		markdown: `---\ntitle: Page tools\n---\nimport Tabs from '@theme/Tabs';\n\n# Page tools\n\nTools run in the page, whichever provider answers.\n\n## Define a tool {#define}\n\nUse defineTool with a JSON Schema.\n\n\`\`\`sh\n# not a heading\nnpm install @leuria/client\n\`\`\`\n\n## Errors\n\nA tool that throws is reported to the model.`,
	},
	{ url: "/docs/embeddings", title: "Embeddings", version: "2.0", markdown: "# Embeddings\n\nSearch by meaning with the visitor's embedding model, kiln or not." },
	{ url: "/docs/v1/tools", title: "Page tools", markdown: "# Page tools\n\nOld tools.", version: "1.0" },
];

/** Two-dimensional "meaning": words about tools, words about search. */
const TOPICS = [/tool|schema|throw/gi, /search|meaning|embed|similar/gi];

class TopicEmbedder extends BaseProvider {
	readonly offers = ["embed"] as const;
	constructor() {
		super("engine", "engine", "device", { status: "ready", capabilities: ["embed"], embedModel: "topics" });
	}
	async detect(): Promise<void> {}
	async embed(request: EmbedRequest): Promise<EmbedResult> {
		return { model: "topics", vectors: request.texts.map((t) => TOPICS.map((re) => (t.match(re)?.length ?? 0) + 0.01)) };
	}
	async createSession(): Promise<ProviderSession> {
		throw new Error("no chat");
	}
}

/** An AI that searches the docs, reads the first hit and answers with a link. */
class DocsReader extends BaseProvider {
	seen: string[] = [];
	constructor() {
		super("bridge", "Your AI", "device", { status: "ready", capabilities: ["chat", "tools"], model: "Codex" });
	}
	async detect(): Promise<void> {}
	async createSession(): Promise<ProviderSession> {
		return {
			send: async (message: Message, context: TurnContext) => {
				const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
				this.seen.push(text);
				const found = await context.runTool({ name: "search_docs", args: { query: "define a tool" } });
				const link = found.ok ? (found.result as Array<{ link: string }>)[0]!.link : "";
				await context.runTool({ name: "read_page", args: { url: link } });
				const answer = `Use \`defineTool\`, see [Page tools](${link}). <img src=x onerror=alert(1)>`;
				context.text(answer);
				return { text: answer };
			},
			close: () => undefined,
		};
	}
}

/** A small model that can't use tools, like the browser's own. */
class SmallModel extends BaseProvider {
	seen: string[] = [];
	constructor() {
		super("browser", "This browser's AI", "device", { status: "ready", capabilities: ["chat"] });
	}
	async detect(): Promise<void> {}
	async createSession(): Promise<ProviderSession> {
		return {
			send: async (message: Message, context: TurnContext) => {
				this.seen.push(message.parts.map((p) => (p.type === "text" ? p.text : "")).join(""));
				context.text("See [Page tools](/docs/tools#define).");
				return { text: "See [Page tools](/docs/tools#define)." };
			},
			close: () => undefined,
		};
	}
}

let ai: Leuria | undefined;
let docs: Docs | undefined;
afterEach(() => {
	docs?.destroy();
	ai?.destroy();
	document.body.innerHTML = "";
	history.replaceState(null, "", "/");
});
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe("buildCorpus", () => {
	it("cleans pages and cuts them into sections with the site's anchors", () => {
		const corpus = buildCorpus(PAGES, { site: "Leuria" });
		const tools = corpus.pages[0]!;
		expect(tools.url).toBe("/docs/tools");
		expect(tools.markdown).not.toContain("title: Page tools");
		expect(tools.markdown).not.toContain("import Tabs");
		expect(tools.markdown).toContain("## Define a tool\n");
		const ids = corpus.sections.filter((s) => s.url === "/docs/tools").map((s) => s.id);
		expect(ids).toEqual(["/docs/tools", "/docs/tools#define", "/docs/tools#errors"]);
		expect(corpus.sections.find((s) => s.id === "/docs/tools#define")!.text).toContain("# not a heading");
	});

	it("keeps code blocks as they are", () => {
		expect(cleanMarkdown("```js\nimport x from 'y'\n```")).toBe("```js\nimport x from 'y'\n```");
	});
});

describe("Docs", () => {
	it("finds by words at once, only in the reader's version", async () => {
		ai = createLeuria({ providers: [], autoDetect: false, closeOnUnload: false });
		docs = createDocs(ai, { corpus: buildCorpus(PAGES, { defaultVersion: "2.0" }), meaning: false });
		const hits = await docs.search("how do I define a tool");
		expect(hits[0]).toMatchObject({ href: "/docs/tools#define", title: "Page tools", heading: "Define a tool", via: "words" });
		expect(hits.some((h) => h.url === "/docs/v1/tools")).toBe(false);
		history.replaceState(null, "", "/docs/v1/tools");
		expect((await docs.search("tools")).map((h) => h.url)).toContain("/docs/v1/tools");
	});

	it("adds search by meaning once the reader's model has indexed the docs", async () => {
		ai = createLeuria({ providers: [new TopicEmbedder()], autoDetect: false, closeOnUnload: false });
		let fetched = 0;
		docs = createDocs(ai, {
			corpus: async () => {
				fetched++;
				return buildCorpus(PAGES);
			},
			storage: memoryStorage(),
		});
		expect(docs.meaningState()).toBeUndefined();
		await docs.load();
		await docs.index!.ready();
		const hits = await docs.search("finding similar things");
		expect(hits[0]).toMatchObject({ url: "/docs/embeddings", via: "meaning" });
		expect(fetched).toBe(1);
	});

	it("gives an assistant tools to search and read, and the browser's agents one to open a page", async () => {
		ai = createLeuria({ providers: [], autoDetect: false, closeOnUnload: false });
		const opened: string[] = [];
		docs = createDocs(ai, { corpus: buildCorpus(PAGES), meaning: false, navigate: (url) => opened.push(url) });
		expect(docs.tools.map((t) => t.name)).toEqual(["search_docs", "read_page", "list_pages"]);
		const read = docs.tools[1]!;
		expect(await read.execute!({ url: "https://example.com/docs/tools/" }, {} as never)).toMatchObject({ title: "Page tools" });
		await expect(read.execute!({ url: "/nope" }, {} as never)).rejects.toThrow(/No page/);
		const open = docs.pageTools.find((t) => t.name === "open_page")!;
		await open.execute!({ url: "/docs/tools#errors" }, {} as never);
		expect(opened).toEqual(["/docs/tools#errors"]);
	});
});

describe("renderMarkdown", () => {
	it("never trusts the answer as HTML", () => {
		const html = renderMarkdown('Hi <script>alert(1)</script> [x](javascript:alert(1)) [ok](/docs/tools) ![i](https://e.com/i.png "t")');
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("javascript:");
		expect(html).toContain('<a href="/docs/tools" data-internal="">ok</a>');
		expect(html).not.toContain("<img");
	});
});

describe("<leuria-ask>", () => {
	it("answers with the reader's AI, from the docs, with the page open as context", async () => {
		const reader = new DocsReader();
		ai = createLeuria({ providers: [reader], autoDetect: false, closeOnUnload: false });
		const opened: string[] = [];
		docs = createDocs(ai, { corpus: buildCorpus(PAGES, { site: "Leuria" }), meaning: false, navigate: (url) => opened.push(url) });
		history.replaceState(null, "", "/docs/embeddings");
		setupDocs(docs, { suggestions: ["How do I define a tool?"] });
		openAsk();
		const panel = document.querySelector("leuria-ask")!;
		const root = panel.shadowRoot!;
		expect(root.querySelector(".ask-empty")!.textContent).toContain("Ask anything about Leuria");

		root.querySelector<HTMLButtonElement>("[data-action=suggest]")!.click();
		await wait();
		expect(reader.seen[0]).toContain("Embeddings (/docs/embeddings)");
		expect(reader.seen[0]).toContain("How do I define a tool?");
		const thread = root.querySelector(".ask-thread")!;
		expect(thread.querySelector(".tool-line")!.textContent).toBe("Searched the docs · Read a page: Page tools");
		expect(thread.querySelector(".bubble.ai code")!.textContent).toBe("defineTool");
		expect(thread.querySelector(".bubble.ai img")).toBeNull();

		thread.querySelector<HTMLAnchorElement>(".bubble.ai a[data-internal]")!.click();
		expect(opened).toEqual(["/docs/tools#define"]);
	});

	it("gives an AI that can't use tools the best passages with the question", async () => {
		const small = new SmallModel();
		ai = createLeuria({ providers: [small], autoDetect: false, closeOnUnload: false });
		docs = createDocs(ai, { corpus: buildCorpus(PAGES), meaning: false });
		setupDocs(docs);
		openAsk("How do I define a tool?");
		await wait();
		expect(small.seen[0]).toContain("Passages from the docs");
		expect(small.seen[0]).toContain("(/docs/tools#define)");
		expect(small.seen[0]).toContain("Use defineTool with a JSON Schema.");
		const thread = document.querySelector("leuria-ask")!.shadowRoot!.querySelector(".ask-thread")!;
		expect(thread.querySelector(".bubble.ai a")!.getAttribute("href")).toBe("/docs/tools#define");
	});
});

describe("<leuria-search>", () => {
	it("finds by words as the reader types, opens a page, or asks the question instead", async () => {
		ai = createLeuria({ providers: [], autoDetect: false, closeOnUnload: false });
		const opened: string[] = [];
		docs = createDocs(ai, { corpus: buildCorpus(PAGES), meaning: false, navigate: (url) => opened.push(url) });
		setupDocs(docs);
		openSearch("define a tool");
		await wait();
		const root = document.querySelector("leuria-search")!.shadowRoot!;
		expect(root.querySelector(".ask-row")!.textContent).toContain("Ask AI: define a tool");
		const first = root.querySelector<HTMLElement>('.hit[data-index="1"]')!;
		expect(first.querySelector(".hit-title")!.textContent).toBe("Page tools›Define a tool");
		expect(root.querySelector(".search-status")!.textContent).toBe("Searching by words.");
		expect(root.querySelector<HTMLElement>(".search-connect")!.hidden).toBe(true);

		const input = root.querySelector("input")!;
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		expect(opened).toEqual(["/docs/tools#define"]);

		openSearch("what is a tool");
		await wait();
		root.querySelector<HTMLElement>('.ask-row')!.click();
		expect(document.querySelector("leuria-ask")!.isOpen()).toBe(true);
	});
});
