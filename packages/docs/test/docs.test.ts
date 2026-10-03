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
import { afterEach, describe, expect, it, vi } from "vitest";

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
	vi.unstubAllGlobals();
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

/** The tools page as Docusaurus renders it: Prism lines, hash links with zero-width spaces, a table. */
const TOOLS_HTML = `<html><body><nav>Menu</nav><article><div class="theme-doc-markdown markdown">
<header><h1>Page tools</h1></header>
<p>Tools run in the page, whichever <a href="/docs/providers">provider</a> answers.</p>
<h2 id="define">Define a tool<a class="hash-link" href="#define">\u200b</a></h2>
<p>Use <code>defineTool</code> with a JSON Schema.</p>
<div class="theme-code-block"><pre class="prism-code language-sh"><code class="language-sh"><span class="token-line"># not a heading<br></span><span class="token-line">npm install @leuria/client<br></span></code></pre><button>Copy</button></div>
<table><thead><tr><th>Option</th><th>What</th></tr></thead><tbody><tr><td>name</td><td>The tool's name</td></tr></tbody></table>
<h2 id="errors">Errors</h2><ul><li>A tool that throws is reported to the model.</li><li>See <code>onError</code>.</li></ul><ol start="3"><li>Third</li></ol>
</div></article></body></html>`;

/** Answers the site's pages from HTML, and counts the reads. */
function serveSite(): string[] {
	const reads: string[] = [];
	vi.stubGlobal("fetch", async (url: string) => {
		reads.push(String(url));
		return String(url).endsWith("/docs/tools") ? new Response(TOOLS_HTML) : new Response("", { status: 404 });
	});
	return reads;
}

describe("a light corpus", () => {
	it("keeps titles, descriptions and headings, not the text", () => {
		const corpus = buildCorpus(PAGES, { light: true });
		expect(corpus.pages[0]!.markdown).toBeUndefined();
		expect(corpus.sections.filter((s) => s.url === "/docs/tools").map((s) => [s.id, s.text])).toEqual([
			["/docs/tools", ""],
			["/docs/tools#define", "Define a tool"],
			["/docs/tools#errors", "Errors"],
		]);
	});

	it("reads a page from the site, once, as Markdown", async () => {
		const reads = serveSite();
		ai = createLeuria({ providers: [], autoDetect: false, closeOnUnload: false });
		docs = createDocs(ai, { corpus: buildCorpus(PAGES, { light: true }), meaning: false });
		const read = docs.tools[1]!;
		const page = (await read.execute!({ url: "/docs/tools#define" }, {} as never)) as { markdown: string };
		expect(page.markdown).toBe(
			[
				"# Page tools",
				"Tools run in the page, whichever [provider](/docs/providers) answers.",
				"## Define a tool",
				"Use `defineTool` with a JSON Schema.",
				"```sh\n# not a heading\nnpm install @leuria/client\n```",
				"| Option | What |\n| --- | --- |\n| name | The tool's name |",
				"## Errors",
				"- A tool that throws is reported to the model.\n- See `onError`.",
				"3. Third",
			].join("\n\n"),
		);
		await read.execute!({ url: "/docs/tools" }, {} as never);
		expect(reads).toEqual(["/docs/tools"]);
	});

	it("gives an AI that can't use tools the sections read from the pages", async () => {
		serveSite();
		const small = new SmallModel();
		ai = createLeuria({ providers: [small], autoDetect: false, closeOnUnload: false });
		docs = createDocs(ai, { corpus: buildCorpus(PAGES, { light: true }), meaning: false });
		setupDocs(docs);
		openAsk("How do I define a tool?");
		await wait();
		expect(small.seen[0]).toContain("(/docs/tools#define)\nDefine a tool\n\nUse `defineTool` with a JSON Schema.");
		// The section ends at the next heading.
		expect(small.seen[0]).toContain("| name | The tool's name |\n\n---");
	});

	it("searches with the site's own search, on the corpus's pages, and with Leuria's when it fails", async () => {
		ai = createLeuria({ providers: [], autoDetect: false, closeOnUnload: false });
		let fail = false;
		docs = createDocs(ai, {
			corpus: buildCorpus(PAGES, { light: true, defaultVersion: "2.0" }),
			meaning: false,
			search: async () => {
				if (fail) throw new Error("offline");
				return [
					{ url: "https://example.com/blog/tools", passage: "Not a docs page." },
					{ url: "https://example.com/docs/tools#errors", heading: "Errors", passage: "A tool that throws is reported to the model." },
					{ url: "https://example.com/docs/tools#errors", heading: "Errors", passage: "Again." },
				];
			},
		});
		const hits = await docs.search("errors");
		expect(hits).toEqual([
			expect.objectContaining({ href: "/docs/tools#errors", title: "Page tools", heading: "Errors", passage: "A tool that throws is reported to the model." }),
		]);
		expect(await docs.passage(hits[0]!)).toBe("A tool that throws is reported to the model.");
		fail = true;
		expect((await docs.search("errors"))[0]).toMatchObject({ href: "/docs/tools#errors", via: "words" });
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
