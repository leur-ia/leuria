# Embeddings and search by meaning

How to turn text into vectors with the visitor's own model, and search your site's content by meaning in their browser.

```ts
const { vectors, model } = await ai.embed(["celadon glaze", "tea bowl"], { kind: "document" })
```

## `ai.embed()`

`ai.embed(texts, options)` embeds with the first ready provider that offers `embed`:
1. the visitor's own model through Leuria (LM Studio or Ollama on their computer);
2. a small model in the page ([`@leuria/web-embed`](../../../packages/web-embed)), which downloads about 40 MB once, when the visitor asks.

Options:
- `kind`: `query` for what the visitor searches, `document` (default) for what is searched. Some models embed them differently.
- `localOnly`, `provider`: the same routing as chat (see [Providers](providers.md#routing)).
- `signal`.

The result is `{ vectors, model, provider }`, one vector per text, in order. It names its `model`: vectors from different models can't be compared, so keep `model` with them. With nothing ready, it rejects with `NoProviderError`.

## Who embeds

Providers say what they serve with `offers`: `["chat"]` by default, `["chat", "embed"]` for the bridge, `["embed"]` for the page model. Chat never goes to a provider that only embeds.

- `ai.getState().embedder` is the provider and model `embed()` would use now.
- `ai.getState().embedPending` is an embedder ahead of it that needs a click (connect Leuria, or download the page model).

`ai.connect()` without an id only turns on chat providers. Name the embedder: `ai.connect("page-embed")`.

## `@leuria/store`: search by meaning

[`@leuria/store`](../../../packages/store) is a vector index in the visitor's browser (IndexedDB, private to the site's origin, never leaves the device), built with whatever model the visitor has.

```ts
import { createIndex, chunkMarkdown } from "@leuria/store"

const notes = createIndex(ai, { name: "notes", documents: [{ id: "celadon", text, meta: { title } }] })
notes.subscribe(() => render(notes.getState()))
const hits = await notes.search("a glaze that looks like jade", { k: 5 })   // [{ id, score, text, meta }]
const close = await notes.similar("celadon")                                 // no embedding needed
```

- **State.** `getState()` is `{ status, model, done, total, error }`, with `status` one of `waiting` (no embedding model yet), `indexing` (`done` of `total`), `ready` and `error` (tried again when the model changes; `retry()` tries now).
- **Follows the model.** When the visitor's embedder changes, the index is built again. `search()` and `similar()` wait for it (`ready()` too) and reject while no model is available.
- **One set per model.** Vectors from different models can't be compared, so each model gets its own set. Switching back to a model is instant.
- **Only what changed.** `setDocuments(documents)` embeds new and changed documents only (by a hash of their text), and drops removed ones.
- **Brute force, on purpose.** Search compares against every vector: fast enough for thousands of documents, nothing to tune.
- `search(query, { k, filter })` and `similar(id, { k, filter })` take a `filter(doc)`; `k` defaults to 5.
- Options: `name` (one per kind of content), `documents`, `storage` (default IndexedDB, or memory where there is none: `memoryStorage()`, `indexedDbStorage()`), `batchSize` (texts per embedding request, default 32).
- `chunkMarkdown(markdown, { maxChars })` splits long pages by heading, then by paragraph (default 1200 characters). Each chunk keeps its heading.
- `destroy()` stops following the model.

## `@leuria/web-embed`: a model in the page

For visitors whose own AI can't embed. It runs [Transformers.js](https://huggingface.co/docs/transformers.js) in a Web Worker, so the page stays responsive.

```ts
import { bridge, browserAI, createLeuria } from "@leuria/client"
import { pageEmbedder } from "@leuria/web-embed"

const ai = createLeuria({ providers: [bridge(), browserAI(), pageEmbedder()] })
// Later, from a click (the visitor agrees to the download):
await ai.connect("page-embed")
```

- **Asks first.** Until the visitor agrees, it is `needs-action` with `action: "download"`. The model and its runtime are about 40 MB, downloaded once and kept in the browser's cache. `autoLoad: true` skips the question.
- **Default model:** `Xenova/bge-small-en-v1.5` (English, made for search), with the query instruction from its model card. Choose another with `model` (and `queryPrefix`).
- **Where files come from:** Hugging Face by default; set `remoteHost` to serve the model from your own site. Texts never leave the page.
- Other options: `id` (default `page-embed`), `label`, `size` (what the visitor is told, default "about 40 MB").

**`@leuria/web-embed/cdn`.** The same provider, with Transformers.js loaded from a CDN when the visitor asks for it instead of bundled with the page. Use it when your bundler can't pack Transformers.js (Docusaurus, for one).

```ts
import { pageEmbedder, TRANSFORMERS_URL } from "@leuria/web-embed/cdn"

pageEmbedder({ transformersUrl: TRANSFORMERS_URL })   // the default: jsDelivr, the version this package is tested with
```
