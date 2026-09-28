# @leuria/connect

Leuria's Connect UI as web components, in the Leuria Pearl design system: the pieces a site shows so visitors can bring their own AI. They work in any page and any framework. React apps can use [`@leuria/react-connect`](../react-connect) instead.

```html
<leuria-connect-button></leuria-connect-button>
<leuria-ai-status></leuria-ai-status>
<leuria-badge></leuria-badge>

<script type="module">
  import { bridge, browserAI, createLeuria, setDefaultClient } from "@leuria/connect/standalone"
  setDefaultClient(createLeuria({ providers: [bridge({ app: "My shop" }), browserAI()] }))
</script>
```

With a bundler, import the client from `@leuria/client` and the elements from `@leuria/connect`. Without one, `@leuria/connect/standalone` is a single file with both (e.g. `https://cdn.jsdelivr.net/npm/@leuria/connect/dist/standalone.js`).

| Element | What |
| --- | --- |
| `<leuria-connect-button>` | "Connect your AI", one per page. Waiting for your approval → Connected (with the visitor's AI, and a menu to disconnect the site), or Not connected · Try again. A click opens Leuria with a `leuria://connect` link; when Leuria doesn't answer, a dialog offers Download Leuria first, Try again, and, small, the other AIs the visitor may use instead for this page. Attributes: `size` (1, 2 or 3), `hide-byline`. Event: `leuria-disconnect` |
| `<leuria-ai-status>` | Which AI answers right now, as a dot and words: "Your AI · Codex", "This browser's AI", "No AI yet". Property: `labels` |
| `<leuria-badge>` | A small footer link, "Runs on your AI · leuria". Its content replaces the text. Attribute: `href` |

Every element takes `appearance` (`light` or `dark`; the visitor's system by default) and uses the client given to `setDefaultClient`, or its own (`element.client = ai`). The connect flow is `connection()` from `@leuria/client`, so every piece of UI on the page, these elements included, shows the same attempt.

**Inside someone else's page.** Each element keeps Pearl's tokens and styles in its own shadow root: the host page's CSS neither reaches it nor is changed by it. Hosts may position and size the elements, not recolour them. The font (Plus Jakarta Sans, SIL OFL, in `fonts/`) is declared once on the page under its own family name, `Leuria Sans`, and loaded from the package, never from a third party.

`src/tokens.ts` and `fonts/` are generated from `packages/pearl/src/tokens.css` and `@fontsource-variable/plus-jakarta-sans` by `scripts/prepare.mjs` (run on build). Apache-2.0.
