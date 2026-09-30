# Leuria

**Bring your own AI to the web.** Leuria lets a website offer AI features that run on the visitor's own AI (ChatGPT, Claude, or a model on their computer) instead of the site's API keys.

The site's code stays in the page: the visitor's agent can only call tools the page provides. It can't read files or run commands on the visitor's machine.

> Status: early. The desktop app is for Mac and Windows; on Linux, run the engine from a terminal. AIs: ChatGPT (through Codex), Claude Code and other ACP agents, models in LM Studio and Ollama, and any OpenAI-compatible API.

## Use it

Get the app from [leuria.eu](https://leuria.eu/download), or with Homebrew:

```sh
brew tap leur-ia/leuria https://github.com/leur-ia/leuria
brew install --cask leuria
```

Choose your AI in the app. When a site offers **Connect your AI**, Leuria asks you in its own window, and you can disconnect any site there.

Building a site? You can also run the engine from a terminal, without the app: see [Run Leuria from a terminal](docs/developers/cli.md).

## Add it to a site (developers)

```sh
npm install @leuria/client
```

```ts
import { createLeuria, bridge, browserAI, server, defineTool } from "@leuria/client"

// The visitor's own AI first, then the browser's model, then your server.
const ai = createLeuria({ providers: [bridge({ app: "My shop" }), browserAI(), server({ url: "/api/ai" })] })

const searchProducts = defineTool({
  name: "search_products",
  description: "Search products. Returns name, price and stock.",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
  execute: ({ query }) => searchCatalog(query), // runs in the page
})

const convo = ai.conversation({ system: "You are the shop's assistant. Use the tools; never guess.", tools: [searchProducts] })
for await (const event of convo.send("Which mug is cheapest?")) {
  if (event.type === "text-delta") output.textContent += event.text
}

// Structured output
const order = await ai.chat({ prompt: freeText, schema: orderSchema }).object()

// Nothing ready? ai.getState().pending says what a click would fix
connectButton.onclick = () => ai.connect()
```

Start with the [Quickstart](docs/developers/quickstart.md), then the [SDK overview](docs/developers/sdk.md) and its guides: the cascade, conversations, turn context, tools the visitor answers, structured output, embeddings. Docs sites get Ask AI in one line with [`@leuria/docusaurus`](docs/developers/docusaurus.md).

The demos (a shop, a notes site with search by meaning, a field guide with a team builder) live in their own repository, `leuria-demo`.

## How it works

```
 web page (any origin)                    visitor's machine
┌────────────────────┐   HTTP + SSE    ┌──────────────────────────────┐
│ @leuria/client     │ ──────────────▶ │ leuria engine 127.0.0.1:19570│
│  page tools        │ ◀── WebSocket ─ │  pairing · sessions · policy │
└────────────────────┘   (tool calls)  │        │ ACP (stdio)         │
                                       │        ▼                     │
                                       │  Claude Code (sandboxed:     │
                                       │  page tools only, empty dir) │
                                       └──────────────────────────────┘
```

1. **Pairing.** Unknown sites get nothing but `/health`. A site asks to connect, and the engine shows its own approval page. On Allow, the site gets a token that only works for its origin.
2. **Sessions.** The site sends prompts; the engine starts the visitor's configured agent. The page can't choose the command.
3. **Tools.** The page registers tools over a WebSocket (WebMCP). The agent sees them as an MCP server and calls them; each call runs in the page.
4. **Policy.** The agent runs in an empty temporary folder with its built-in tools, settings, plugins and extra MCP servers switched off. Any permission request for a tool other than the page's is refused.

Details: [engine protocol](docs/developers/protocol.md). Threat model notes: [security](docs/security.md). All docs: [docs/](docs/README.md).

## Repository

| Path | Package | What |
| --- | --- | --- |
| `packages/engine` | [`leuria`](packages/engine) | The engine and CLI |
| `packages/client` | [`@leuria/client`](packages/client) | Browser SDK |
| `packages/react` | [`@leuria/react`](packages/react) | React hooks |
| `packages/connect` | [`@leuria/connect`](packages/connect) | Connect UI as web components, in Leuria Pearl, for any page |
| `packages/react-connect` | [`@leuria/react-connect`](packages/react-connect) | The Connect UI as React components |
| `packages/store` | [`@leuria/store`](packages/store) | Search by meaning in the visitor's browser |
| `packages/web-embed` | [`@leuria/web-embed`](packages/web-embed) | A small embedding model in the page |
| `packages/docs` | [`@leuria/docs`](packages/docs) | Ask AI and search by meaning for any docs site |
| `packages/docusaurus` | [`@leuria/docusaurus`](packages/docusaurus) | The same, as a Docusaurus plugin |
| `packages/pearl` | [`@leuria/pearl`](packages/pearl) | Leuria Pearl design system on Radix Themes |
| `apps/desktop` | | The desktop app: Tauri shell, engine sidecar, onboarding UI |
| `apps/portal` | | The developer portal (Docusaurus, on `@leuria/docusaurus`): the docs, runnable examples, the API reference |
| `docs/` | | [User, developer and contributor docs](docs/README.md) |

```sh
pnpm install
pnpm check && pnpm test   # types and tests (no agent needed)
pnpm build
node packages/engine/dist/cli.js test   # real round trip with your Claude
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

Licensed under [Apache 2.0](LICENSE). See the [privacy policy](https://leuria.eu/privacy-policy) and the [code signing policy](https://leuria.eu/code-signing).
