# @leuria/web-embed

A small embedding model that runs in the page, as a Leuria provider: search by meaning for visitors whose own AI can't embed. It uses [Transformers.js](https://huggingface.co/docs/transformers.js) in a Web Worker, so the page stays responsive.

```ts
import { bridge, browserAI, createLeuria } from "@leuria/client"
import { pageEmbedder } from "@leuria/web-embed"

const ai = createLeuria({ providers: [bridge(), browserAI(), pageEmbedder()] })
// Later, from a click (the visitor agrees to the download):
await ai.connect("page-embed")
```

- **Asks first.** Until the visitor agrees, the provider is `needs-action` with `action: "download"`. The model and its runtime are about 40 MB, downloaded once and kept in the browser's cache. `autoLoad: true` skips the question.
- **Default model:** `Xenova/bge-small-en-v1.5` (English, made for search), with the query instruction from its model card. Choose another with `model` (and `queryPrefix`).
- **Where files come from:** Hugging Face by default; set `remoteHost` to serve the model from your own site. Texts never leave the page.

Apache-2.0.
