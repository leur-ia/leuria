/**
 * @leuria/docs: Ask AI and search by meaning for any docs site, on the
 * reader's own AI. The site pays for no model and holds no keys.
 *
 *   import { createDocs, setupDocs } from "@leuria/docs"
 *   const docs = createDocs(ai, { corpus: () => fetch("/corpus.json").then((r) => r.json()) })
 *   setupDocs(docs, { suggestions: ["How do I add a tool?"] })
 *
 *   <leuria-ask-button floating></leuria-ask-button>
 *
 * Build the corpus with `@leuria/docs/build`. Importing this module
 * defines the elements.
 */

import { LeuriaAsk, LeuriaAskButton } from "./ask.js";
import { LeuriaSearch, LeuriaSearchButton } from "./search.js";

export { LeuriaAsk, LeuriaAskButton, openAsk, pageDocs, setupDocs } from "./ask.js";
export { LeuriaSearch, LeuriaSearchButton, openSearch } from "./search.js";
export type { AskOptions } from "./ask.js";
export { createDocs, Docs, plain } from "./docs.js";
export type { DocsHit, DocsOptions, DocsSearchOptions } from "./docs.js";
export { pagePath } from "./corpus.js";
export type { DocsCorpus, DocsPage, DocsSection } from "./corpus.js";
export { renderMarkdown } from "./render.js";

if (typeof customElements !== "undefined") {
	if (!customElements.get("leuria-ask")) customElements.define("leuria-ask", LeuriaAsk);
	if (!customElements.get("leuria-ask-button")) customElements.define("leuria-ask-button", LeuriaAskButton);
	if (!customElements.get("leuria-search")) customElements.define("leuria-search", LeuriaSearch);
	if (!customElements.get("leuria-search-button")) customElements.define("leuria-search-button", LeuriaSearchButton);
}
