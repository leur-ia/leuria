# @leuria/docusaurus

Ask AI for any Docusaurus site, on the reader's own AI: an assistant that answers from your docs with links to the pages. No API keys, nothing to pay per question.

```sh
npm install @leuria/docusaurus
```

```js
// docusaurus.config.js
plugins: [["@leuria/docusaurus", { suggestions: ["How do I get started?"] }]]
```

- **Ask AI** in the navbar: answers from your docs, knows the page the reader has open and the text they selected.
- **Search** (`search: true`): ⌘K, by words at once and by meaning once the reader has an embedding model.
- **WebMCP**: the same docs tools for the browser's own agents.
- **Next to your search**: no theme component is replaced, so Algolia DocSearch and local search plugins keep working.

Every option, and what readers see: [Ask AI for your Docusaurus site](../../docs/developers/docusaurus.md). Built on [`@leuria/docs`](../docs). Docusaurus 3.6+. Apache-2.0.
