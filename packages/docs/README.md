# @leuria/docs

Ask AI and search by meaning for any docs site, on the reader's own AI. The site holds no keys and pays for no model. [`@leuria/docusaurus`](../docusaurus) wires it into Docusaurus in one line; this package works anywhere.

```ts
import { buildCorpus } from "@leuria/docs/build"          // at build time
const corpus = buildCorpus(pages, { site: "My docs" })     // pages: { url, title, markdown }[]

import { createDocs, setupDocs } from "@leuria/docs"       // in the page
const docs = createDocs(ai, { corpus: () => fetch("/corpus.json").then((r) => r.json()) })
setupDocs(docs, { suggestions: ["How do I get started?"] })
```

```html
<leuria-search-button></leuria-search-button>
<leuria-ask-button></leuria-ask-button>
```

| Piece | What |
| --- | --- |
| `buildCorpus(pages)` | Pages to a corpus: cleaned Markdown, and sections with the site's anchors |
| `createDocs(ai, options)` | The docs in the page: `search()` by words and by meaning (with [`@leuria/store`](../store)), `tools` for an assistant, `expose()` for the browser's agents (WebMCP) |
| `<leuria-ask-button>`, `openAsk()` | The Ask panel. AIs that can use tools search and read the docs; others (the browser's small model) get the best passages with the question |
| `<leuria-search-button>`, `openSearch()` | The ⌘K search, with "Ask AI" for the query |

The elements keep Leuria Pearl's styles in their shadow root, as [`@leuria/connect`](../connect) does. Full guide: [Ask AI for your Docusaurus site](../../docs/developers/docusaurus.md#other-sites). Apache-2.0.
