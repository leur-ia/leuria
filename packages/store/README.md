# @leuria/store

Search by meaning over a site's own content, in the visitor's browser. The index is built with whatever embedding model the visitor has (their own through Leuria, or a small one in the page with [`@leuria/web-embed`](../web-embed)), kept in IndexedDB (private to the site's origin, never leaves the device), and rebuilt when the model changes.

```ts
import { createIndex, chunkMarkdown } from "@leuria/store"

const notes = createIndex(ai, { name: "notes", documents: [{ id: "celadon", text, meta: { title } }] })
notes.subscribe(() => render(notes.getState()))   // waiting · indexing (done/total) · ready (model) · error
const hits = await notes.search("a glaze that looks like jade", { k: 5 })   // [{ id, score, text, meta }]
const close = await notes.similar("celadon")                                 // no embedding needed
```

- **One set per model.** Vectors from different models can't be compared, so each model gets its own set. Switching back to a model is instant.
- **Only what changed.** `setDocuments()` embeds new and changed documents only (by a hash of their text).
- **Brute force, on purpose.** Search compares against every vector: fast enough for thousands of documents, nothing to tune.
- `chunkMarkdown(markdown, { maxChars })` splits long pages by heading, then by paragraph.

Apache-2.0.
