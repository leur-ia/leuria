# Connect UI

How to let visitors bring their own AI to your page: Leuria's ready-made elements, or the connect flow behind them for your own UI.

```html
<leuria-connect-button></leuria-connect-button>
<leuria-ai-status></leuria-ai-status>
<leuria-badge></leuria-badge>

<script type="module">
  import { leuria, promptAPI, createAI, setDefaultClient } from "@leuria/connect/standalone"
  setDefaultClient(createAI({ providers: [leuria({ app: "My shop" }), promptAPI()] }))
</script>
```

## The connect flow: `connection(ai)`

`connection(ai, providerId = "bridge")` follows the connect flow for any UI. There is one per client and provider, so every piece of UI on the page, Leuria's elements included, shows the same attempt.

- `getState()` / `subscribe()` give `{ status, provider, model, error, alternatives }`. `alternatives` are the AIs the visitor may pick instead, for this page (see [Providers](providers.md#the-visitors-own-ai-first)).
- `status` is one of:
  - `checking`: the first look hasn't answered yet (connected sites only);
  - `not-connected`: this site isn't connected. Leuria answers no site it doesn't know, so whether it's installed is only learned by connecting;
  - `connecting`: Leuria was opened with a `leuria://connect` link, and waits for the visitor in its own window;
  - `not-running`: the last connect got no answer from Leuria (it isn't running, or isn't installed), or a connected site can't reach it;
  - `declined`: the visitor didn't allow it, or closed the window (`error` says why);
  - `connected`: the site can use the visitor's AI.
- `model` is the visitor's AI in their words (e.g. "Codex"), once known.
- `connect()` asks the visitor to allow the site. Call it from a click: it opens Leuria with a link. Call it again to try again, e.g. after the visitor installed or started Leuria.
- `chooseInstead(id)` records the visitor's pick of another AI for this page, and downloads it if needed. Call it from a click.
- `manage()` opens Leuria on this site's settings, where the visitor changes its AI and model (with Leuria's recommendation, when you [declared your needs](providers.md#declare-what-your-features-need)). Call it from a click. `canManage` says whether the provider has settings. The site never chooses the model itself: the visitor does, in Leuria's own window.
- `disconnect()` forgets the site's connection in this browser; `retry()` looks again (for a connected site whose Leuria was closed).

When Leuria doesn't answer within a few seconds, `status` becomes `not-running`, and the attempt keeps waiting in the background: an app that starts late, or is installed meanwhile, still connects.

```ts
import { connection } from "@leuria/client"

const flow = connection(ai)
flow.subscribe(() => render(flow.getState().status))
button.onclick = () => flow.connect()
```

## `@leuria/connect`: web components

[`@leuria/connect`](../../../packages/connect) is Leuria's Connect UI as web components, in the Leuria Pearl design system. They work in any page and any framework. Importing the package defines the elements.

| Element | What |
| --- | --- |
| `<leuria-connect-button>` | "Connect your AI", one per page. Waiting for your approval → Connected (with the visitor's AI, and a menu to change the AI or model in Leuria, or disconnect the site), or Not connected · Try again. When Leuria doesn't answer, it opens a dialog: Download Leuria first, Try again, and, small, the other AIs the visitor may use instead for this page |
| `<leuria-ai-status>` | Which AI answers right now, as a dot and words: "Your AI · Codex", "This browser's AI", "No AI yet" |
| `<leuria-badge>` | A small footer link, "Runs on your AI · leuria". Its content replaces the text |

`<leuria-connect-button>` attributes:
- `size`: `1` (36 px, for navigation bars), `2` (48 px, the default) or `3` (56 px);
- `hide-byline`: no "by leuria" beside "Connect your AI".

It fires `leuria-disconnect` after the visitor disconnects the site, e.g. to clear a conversation.

`<leuria-ai-status>` takes a `labels` property: names by provider id that replace the defaults. `<leuria-badge>` takes `href`.

**Client.** Every element uses the client given to `setDefaultClient(ai)`, or its own (`element.client = ai`).

**Appearance.** Every element takes `appearance` (`light` or `dark`); by default it follows the visitor's system. On a page with its own light/dark switch, call `setDefaultAppearance("light" | "dark")` whenever it changes: elements without their own `appearance` follow it. `setDefaultAppearance(undefined)` goes back to the system.

**Inside someone else's page.** Each element keeps Pearl's tokens and styles in its own shadow root: the host page's CSS neither reaches it nor is changed by it. Hosts may position and size the elements, not recolour them. The font (Plus Jakarta Sans, SIL OFL) is declared once on the page under its own family name, `Leuria Sans`, and loaded from the package, never from a third party.

**Without a bundler.** `@leuria/connect/standalone` is a single file with the client and the elements, for a plain `<script type="module">`, e.g. `https://cdn.jsdelivr.net/npm/@leuria/connect/dist/standalone.js`. With a bundler, import the client from `@leuria/client` and the elements from `@leuria/connect`.

## `@leuria/react-connect`: the same, in React

[`@leuria/react-connect`](../../../packages/react-connect) wraps the same elements as React components, given the client of the nearest `LeuriaProvider` from `@leuria/react` (see [React](react.md)). One implementation, so the button looks and behaves the same in React as on any other page.

```tsx
import { LeuriaProvider } from "@leuria/react"
import { AIStatus, ConnectButton, LeuriaBadge } from "@leuria/react-connect"

<LeuriaProvider client={ai}>
  <ConnectButton onDisconnect={() => setSession((n) => n + 1)} />
  <AIStatus />
  <LeuriaBadge />
</LeuriaProvider>
```

| Component | Props |
| --- | --- |
| `ConnectButton` | `size` (1, 2 or 3), `byline` (default true), `onDisconnect` |
| `AIStatus` | `labels` (names by provider id) |
| `LeuriaBadge` | `href`, `children` (replaces "Runs on your AI") |

All take `appearance` (`light` / `dark`), `className` and `style` (position and size only). `setDefaultAppearance` is exported here too, for apps with their own light/dark switch. Works with React 18 and 19.

For your own UI in React, `useConnect()` gives the connect flow as state (see [React](react.md#useconnect)).
