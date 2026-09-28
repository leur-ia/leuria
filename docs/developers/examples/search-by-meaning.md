# Search by meaning

Index your content in the browser, then find it by what it means rather than its words. This needs an embedding model: the one on your computer through Leuria (LM Studio or Ollama), or a small one in the page.

Your content comes from somewhere: an API, the page, the visitor's own data. Whatever the source, turn each record into a document, `{ id, text, meta }`, and give the list to `createIndex`.

```js leuria-run
import { createIndex } from "@leuria/store"

// Records as your API returns them.
const glazes = [
  { id: 1, name: "Celadon", notes: "A pale green glaze, iron fired in reduction.", cone: 10 },
  { id: 2, name: "Crawling", notes: "The glaze pulled back into beads, leaving bare clay.", cone: 6 },
  { id: 3, name: "Tenmoku", notes: "Dark brown to black, breaking rust red where it runs thin.", cone: 10 },
]

const index = createIndex(ai, {
  name: "glazes",
  documents: glazes.map((glaze) => ({
    id: String(glaze.id),
    text: `${glaze.name}. ${glaze.notes}`,
    meta: { name: glaze.name, cone: glaze.cone },
  })),
})

try {
  await index.ready()
  const hits = await index.search("why did my glaze shrink into little drops?", { k: 2 })
  print(hits.map((hit) => `${hit.meta.name} (${hit.score.toFixed(2)})`))

  // Only cone 10 glazes.
  const hot = await index.search("a glaze that looks like jade", { k: 1, filter: (doc) => doc.meta.cone === 10 })
  print(hot.map((hit) => hit.meta.name))
} catch {
  const pending = ai.getState().embedPending
  print(pending ? `Search by meaning needs a model first: ${pending.label}.` : "No embedding model is available on this device.")
} finally {
  // Only because this example runs once. In your app, keep the index as long as the page.
  index.destroy()
}
```

## Make good documents

- **`id`: stable.** Use the record's own id, never its position in the list. Unchanged documents are then never embedded again.
- **`text`: what it means.** The words a visitor would search for: a name, a description, notes. Leave out SKUs, prices and dates; they don't carry meaning and blur the vector.
- **`meta`: what you show.** Anything you need to display a hit or to filter: a title, a link, a category. It isn't embedded.
- **Long texts: in chunks.** A vector sums up its whole text, so a long page matches everything a little. Split it (below).

## From an API

Fetch your records, turn each into a document, and index them. When your data changes, give the index the whole new list with `setDocuments`.

```js
const toDocument = (product) => ({
  id: String(product.id),                                   // your database id: the same product keeps the same id
  text: `${product.name}. ${product.description}`,          // what gets embedded and searched
  meta: { url: product.url, category: product.category },   // kept as is, to show and filter hits
})

const loadProducts = () => fetch("/api/products").then((res) => res.json())

const index = createIndex(ai, { name: "products", documents: (await loadProducts()).map(toDocument) })

// Later, when the catalog may have changed (a refetch, an edit, a timer):
await index.setDocuments((await loadProducts()).map(toDocument))
```

`setDocuments` compares the new list with what is indexed, by `id` and by a fingerprint of `text`:

- a new product is embedded;
- a product whose `text` changed is embedded again;
- an unchanged product is skipped, with no call to the model;
- a product missing from the list is removed from the index.

So calling it after every refetch is cheap: only the difference is embedded.

**It replaces the list; it doesn't add to it.** Always pass every document you want searchable. If you load products page by page, keep the pages you have and pass all of them:

```js
const loaded = []

async function loadPage(page) {
  const products = await fetch(`/api/products?page=${page}`).then((res) => res.json())
  loaded.push(...products)
  await index.setDocuments(loaded.map(toDocument))   // every page so far, not just this one
}
```

With React Query, SWR or your own store, the same rule holds: call `setDocuments` with the full current data whenever it changes, e.g. in an effect on `data`.

## From the page

The page's own content, for a "search this page" box. Each heading with the paragraph that follows it becomes a document, and a hit links to its anchor.

```js
const documents = [...document.querySelectorAll("main h2[id], main h3[id]")].map((heading) => ({
  id: heading.id,
  text: `${heading.textContent}. ${heading.nextElementSibling?.textContent ?? ""}`,
  meta: { title: heading.textContent, href: `#${heading.id}` },
}))

const index = createIndex(ai, { name: "this-page", documents })
```

## From the visitor's own data

Notes, drafts, saved items, files they open: data that lives in their browser can be searched without ever reaching your server. It is embedded by their own model or the one in the page, and the vectors stay in IndexedDB, private to your site.

```js
const notes = JSON.parse(localStorage.getItem("notes") ?? "[]")

const index = createIndex(ai, {
  name: "my-notes",
  documents: notes.map((note) => ({ id: note.id, text: note.body, meta: { title: note.title } })),
})
```

A file the visitor picks works the same way: read it with `await file.text()`, then split it.

## Long texts

`chunkMarkdown` splits Markdown by heading, then by paragraph (1,200 characters by default). Give each chunk its own id, and keep the page in `meta` so a hit leads back to it.

```js
import { chunkMarkdown, createIndex } from "@leuria/store"

const documents = pages.flatMap((page) =>
  chunkMarkdown(page.markdown).map((chunk, i) => ({
    id: `${page.slug}#${i}`,
    text: chunk.heading ? `${chunk.heading}. ${chunk.text}` : chunk.text,
    meta: { slug: page.slug, title: page.title, heading: chunk.heading },
  })),
)
```

## When there is no model yet

`index.ready()` and `search()` reject while no embedding model is available. `ai.getState().embedPending` is the one a click would turn on: show a button that calls `ai.connect(pending.id)`, and the index builds by itself once it's on. Meanwhile, search by words.

```js
const pending = ai.getState().embedPending
if (pending) button.onclick = () => ai.connect(pending.id)

index.subscribe(() => {
  const { status, done, total } = index.getState()
  if (status === "indexing") progress.textContent = `Getting search by meaning ready… ${total ? Math.round((done / total) * 100) : 0}%`
})
```

## How it works

- `createIndex` embeds each document with the visitor's model and keeps the vectors in IndexedDB, private to your site. Only new or changed texts are embedded again.
- Vectors from different models can't be compared, so each model gets its own set, and the index is rebuilt when the model changes.
- Search compares the query with every document: fast enough for thousands of them, nothing to tune.
- `ai.getState().embedder` is the model in use; `embedPending` is one a click would turn on. See [Embeddings](../guides/embeddings.md).
