# Ask AI for your Docusaurus site

`@leuria/docusaurus` gives your docs an assistant that answers from your pages, with links to them, on each reader's own AI. You hold no API keys and pay nothing per question.

```sh
npm install @leuria/docusaurus
```

```js
// docusaurus.config.js
export default {
  plugins: [
    ["@leuria/docusaurus", { suggestions: ["How do I get started?", "How do I deploy?"] }],
  ],
}
```

That's all. The navbar gets an **Ask AI** button, and the panel it opens knows every page of your docs.

## What it adds

- **Ask AI.** A panel that answers from your docs. The assistant searches them, reads the pages it needs and links to them. It knows which page the reader has open, and the text they selected. The conversation stays open while the reader moves between pages.
- **Search, if you want it** (`search: true`). A ⌘K search by words at once, and by meaning once the reader has an embedding model. It offers to ask the question instead.
- **The Connect button, if you want it** (`connectButton: true`). The Ask panel offers it anyway when it's needed.
- **Tools for the browser's agents** (WebMCP). The same docs tools (`search_docs`, `read_page`, `list_pages`, `open_page`) are offered to agents built into the browser.

At build time the plugin reads the Markdown of every docs page (drafts and unlisted pages are left out) and cuts it into sections. Readers fetch that file the first time they search or ask.

## Options

| Option | Default | What |
| --- | --- | --- |
| `app` | the site's `title` | The name Leuria shows when the reader connects your site |
| `site` | the site's `title` | The name the assistant gives your docs |
| `title` | "Ask the docs" | The panel's title |
| `suggestions` | none | Questions offered before the first one |
| `system` | built in | Replaces the assistant's instructions |
| `askButton` | `"navbar"` | `"navbar"`, `"floating"` (bottom right), or `"none"` to place `<leuria-ask-button>` yourself |
| `search` | `false` | Add Leuria's search to the navbar, for sites without one |
| `connectButton` | `false` | Also put "Connect your AI" in the navbar |
| `webmcp` | `true` | Offer the docs tools to the browser's own agents |
| `pageEmbeddings` | `false` | A small embedding model in the page for search by meaning, for readers whose AI can't embed. About 40 MB, downloaded only when the reader agrees. Its runtime comes from jsDelivr and the model from Hugging Face. Needs `npm install @leuria/web-embed` |
| `server` | none | `{ url }`: your own Chat Completions endpoint, as the last resort for readers with no AI |
| `needs` | `{ tools: true, effort: "light" }` | What the Ask panel needs, so Leuria recommends a model that fits and no bigger. Raise `effort` for docs where answers need more reasoning |
| `fallback` | `"ask"` | Readers without Leuria: `"ask"` proposes Leuria first, and the browser's AI or your server answer only once the reader picks one, for the page. `"auto"` uses them at once |
| `docsPluginIds` | every one | Only these docs plugin instances |

For versioned docs, the assistant and the search stay in the version the reader is on; outside a docs page they use the latest.

## Next to your search

The plugin replaces no theme component, so it works next to Algolia DocSearch, a local search plugin, or your own swizzled components. Its buttons are plain `html` navbar items holding web components, added once by the plugin. The Ask button doesn't take ⌘K; Leuria's search does, and only when you turn it on.

To place the buttons yourself, set `askButton: "none"` and add them where you like:

```js
navbar: {
  items: [{ type: "html", position: "right", value: "<leuria-ask-button></leuria-ask-button>" }],
}
```

The elements keep their own styles in a shadow root and follow your site's light and dark theme. The panel opens below your navbar.

## What readers see

Leuria comes first: the panel proposes the reader's own AI (ChatGPT through Codex, Claude Code, a model in LM Studio or Ollama), which searches and reads your docs with tools.

- **Without Leuria**, Connect explains how to get it, with Download first. Below, in small, the reader may pick another AI for the page instead: their browser's built-in model, where there is one, or your server, if you set `server`. Nothing is remembered: Leuria is proposed again on the next visit. With `fallback: "auto"`, these answer at once instead.
- **Small models can't use tools**, so with the browser's model the panel searches your docs itself and gives it the best passages with the question.
- **A reader using another AI** still sees a one-line offer to use their own.

Questions go to the reader's AI, never to your server (unless you set `server` and nothing else can answer). The docs index stays in the reader's browser.

## For coding agents: llms.txt

Leuria's panel serves people. For coding agents, add [`docusaurus-plugin-llms`](https://github.com/rachfop/docusaurus-plugin-llms): it writes `llms.txt` and a Markdown copy of every page at build time. The two work side by side.

## Other sites

The plugin is a thin layer on [`@leuria/docs`](../../packages/docs), which works on any site.

At build time, turn your pages into a corpus:

```ts
import { buildCorpus } from "@leuria/docs/build"

const corpus = buildCorpus(
  [{ url: "/docs/intro", title: "Introduction", markdown: readFileSync("docs/intro.md", "utf8") }],
  { site: "My docs" },
)
writeFileSync("public/corpus.json", JSON.stringify(corpus))
```

In the page:

```ts
import { leuria, promptAPI, createAI } from "@leuria/client"
import { createDocs, setupDocs } from "@leuria/docs"

const ai = createAI({ providers: [leuria({ app: "My docs" }), promptAPI()] })
const docs = createDocs(ai, {
  corpus: () => fetch("/corpus.json").then((r) => r.json()), // fetched on first use
  navigate: (url) => router.push(url), // optional: your router, instead of a page load
})
setupDocs(docs, { suggestions: ["How do I get started?"] })
docs.expose() // the docs tools for the browser's agents (WebMCP)
```

```html
<leuria-search-button></leuria-search-button>
<leuria-ask-button></leuria-ask-button>
```

- `openAsk(question?)` and `openSearch(query?)` open the panel and the search from your own buttons.
- `docs.search(query)` returns hits by words and by meaning, for your own search UI; `docs.tools` gives the assistant's tools to your own conversation.
- `createDocs` options: `version` (the version the reader is on), `meaning: false` (words only), `indexName` and `storage` (where vectors are kept).
- Set `--leuria-ask-top` on `leuria-ask` to open the panel below your header.
