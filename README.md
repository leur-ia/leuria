# Leuria

**AI features that run on your visitors' own AI.** Add an assistant, search by meaning or a form that fills itself to your site. Each visitor's own AI answers: an AI app they already sign in to, a model on their computer, or an AI service they pay for. You hold no API keys and pay nothing per question.

- **No AI bill, no keys.** Nothing to protect in your page or on your server.
- **Your code stays in your page.** The AI can only call the tools your page gives it, and each call runs in the page. It can't read the visitor's files or run anything on their computer.
- **Visitors say yes first.** Leuria asks them in its own window, shows what your site can and can't do, and lets them disconnect in one click.
- **Something always answers.** When a visitor has no Leuria, the same code falls back to the browser's built-in AI (in Chrome) or to your own server.

Docs, live examples and the API reference are on [leuria.dev](https://leuria.dev).

## Try it in a page

No bundler, no build. One script brings the SDK and the Connect button:

```html
<!doctype html>
<leuria-connect-button></leuria-connect-button>
<p><input id="question" placeholder="Ask something"> <button id="ask">Ask</button></p>
<p id="answer"></p>

<script type="module">
  import { bridge, browserAI, createLeuria, setDefaultClient } from "https://cdn.jsdelivr.net/npm/@leuria/connect/dist/standalone.js"

  // The visitor's own AI first, then the browser's built-in model.
  const ai = createLeuria({ providers: [bridge({ app: "My site" }), browserAI()] })
  setDefaultClient(ai)

  document.querySelector("#ask").onclick = async () => {
    const answer = document.querySelector("#answer")
    answer.textContent = ""
    for await (const event of ai.chat({ prompt: document.querySelector("#question").value })) {
      if (event.type === "text-delta") answer.textContent += event.text
    }
  }
</script>
```

`<leuria-connect-button>` handles the whole connect flow: it finds Leuria on the visitor's computer, asks them to approve your site, and explains how to get Leuria when they don't have it.

## With a bundler

```sh
npm install @leuria/client @leuria/connect
```

```ts
import { bridge, browserAI, createLeuria, defineTool, server } from "@leuria/client"
import { setDefaultClient } from "@leuria/connect" // defines <leuria-connect-button>

// The visitor's own AI first, then the browser's model, then your server.
const ai = createLeuria({ providers: [bridge({ app: "My shop" }), browserAI(), server({ url: "/api/ai" })] })
setDefaultClient(ai)

// Runs in the page. The AI only sees what the tool returns.
const searchProducts = defineTool({
  name: "search_products",
  description: "Search products. Returns name, price and stock.",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
  execute: ({ query }) => searchCatalog(query),
})

const convo = ai.conversation({ system: "You are the shop's assistant. Use the tools; never guess.", tools: [searchProducts] })
for await (const event of convo.send("Which mug is cheapest?")) {
  if (event.type === "text-delta") output.textContent += event.text
}

// Structured output: a form filled from free text
const order = await ai.chat({ prompt: message, schema: orderSchema }).object()
```

Next: the [Quickstart](docs/developers/quickstart.md) (plain HTML, a bundler, React), the [SDK overview](docs/developers/sdk.md) and its guides (the fallback order, conversations, page tools, structured output, search by meaning), and [Going to production](docs/developers/production.md).

### A docs site?

Docusaurus sites get Ask AI, on each reader's own AI, with one plugin: [`@leuria/docusaurus`](docs/developers/docusaurus.md).

## Test with your own AI

Install the Leuria app from [leuria.eu](https://leuria.eu/download) (Mac and Windows), as your visitors will, and choose your AI in it. Or run the same engine from a terminal while you build, on Mac, Windows or Linux:

```sh
npx @leuria/cli@latest
```

See [Run Leuria from a terminal](docs/developers/cli.md). Then open your page and click **Connect your AI**.

To see it on real sites first: a shop whose assistant fills in an order, a notes site with search by meaning, and a field guide with a team builder, at [demo.leuria.dev](https://demo.leuria.dev) (source in [leur-ia/demo](https://github.com/leur-ia/demo)).

## How it works

```
 your page (any origin)                   the visitor's computer
┌────────────────────┐   HTTP + SSE    ┌──────────────────────────────────┐
│ @leuria/client     │ ──────────────▶ │ Leuria (127.0.0.1:19570)         │
│  your page tools   │ ◀── WebSocket ─ │  approval · sessions · policy    │
└────────────────────┘   (tool calls)  │        │                         │
                                       │        ▼                         │
                                       │  the visitor's AI, in an empty   │
                                       │  folder, with your tools only    │
                                       └──────────────────────────────────┘
```

1. **Approval.** With the app, Leuria doesn't answer sites it doesn't know. Your site asks to connect; Leuria asks the visitor in its own window. On Allow, your site gets a token that only works for its origin.
2. **Sessions.** Your page sends prompts, and Leuria starts the AI the visitor chose. Your page can't choose what runs.
3. **Tools.** Your page registers its tools over a WebSocket (WebMCP). The AI sees them as an MCP server and calls them; each call runs in your page.
4. **Policy.** The AI runs in an empty temporary folder, with its own tools, settings, plugins and other MCP servers switched off. Leuria refuses any request to use a tool other than your page's.

Details: the [engine protocol](docs/developers/protocol.md) and the [security notes](docs/security.md). All docs: [docs/](docs/README.md).

## Using Leuria on websites?

Get the app at [leuria.eu](https://leuria.eu/download), or with Homebrew on a Mac:

```sh
brew tap leur-ia/leuria https://github.com/leur-ia/leuria
brew install --cask leuria
```

Choose your AI in the app. When a site offers **Connect your AI**, Leuria asks you first, in its own window, and you can disconnect any site there.

## Repository

| Path | Package | What |
| --- | --- | --- |
| `packages/client` | [`@leuria/client`](packages/client) | The SDK for your page |
| `packages/connect` | [`@leuria/connect`](packages/connect) | The Connect button and status, as web components |
| `packages/react` | [`@leuria/react`](packages/react) | React hooks |
| `packages/react-connect` | [`@leuria/react-connect`](packages/react-connect) | The Connect button and status, as React components |
| `packages/store` | [`@leuria/store`](packages/store) | Search by meaning in the visitor's browser |
| `packages/web-embed` | [`@leuria/web-embed`](packages/web-embed) | A small embedding model in the page |
| `packages/docs` | [`@leuria/docs`](packages/docs) | Ask AI and search by meaning for any docs site |
| `packages/docusaurus` | [`@leuria/docusaurus`](packages/docusaurus) | The same, as a Docusaurus plugin |
| `packages/engine` | [`@leuria/cli`](packages/engine) | The engine, and the `leuria` command |
| `packages/pearl` | | Leuria Pearl, the design system on Radix Themes |
| `apps/desktop` | | The Leuria app for Mac and Windows |
| `apps/portal` | | [leuria.dev](https://leuria.dev): the docs, runnable examples, the API reference |
| `docs/` | | [Developer and contributor docs](docs/README.md) |

```sh
pnpm install
pnpm check && pnpm test                   # types and tests (no AI needed)
pnpm build
node packages/engine/dist/cli.js test     # a real round trip with your AI
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

Licensed under [Apache 2.0](LICENSE). See the [privacy policy](https://leuria.eu/privacy-policy) and the [code signing policy](https://leuria.eu/code-signing).
