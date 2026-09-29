# The core SDK (`@leuria/client`)

A site writes each AI feature once. For each request, the SDK picks the best AI this visitor has.

```ts
import { createLeuria, bridge, browserAI, server, defineTool } from "@leuria/client"

const ai = createLeuria({
  providers: [
    bridge({ app: "Mug shop" }),                      // the visitor's own AI, through the Leuria engine
    browserAI(),                                      // the browser's built-in model (Chrome's Prompt API)
    server({ url: "/api/ai/chat/completions" }),      // your server, as the last resort
  ],
})

const searchProducts = defineTool<{ query: string }>({
  name: "search_products",
  description: "Search products; returns name, price and stock.",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
  execute: ({ query }) => catalog.search(query),      // runs in the page
})

const convo = ai.conversation({ system: "You are the shop's assistant. Use the tools; never guess.", tools: [searchProducts] })
for await (const event of convo.send("Which mug is cheapest?")) {
  if (event.type === "text-delta") output.textContent += event.text
}
```

## How it fits together

- **Providers, in order of preference.** The visitor's own AI through Leuria, the browser's model, your server, or [your own](guides/custom-providers.md). Each request goes to the first one that is ready and can do what the request needs. Nothing ready? The state says what a click would fix.
- **The page owns the work.** Tools run in the page, whichever provider answers. The history belongs to the page too, so a conversation moves to a better AI as soon as the visitor connects one.
- **Plain state.** The client and each conversation expose an immutable snapshot and a `subscribe()`. Any UI framework, and adapters such as React's, follow them directly.

## Guides

| Guide | What |
| --- | --- |
| [Providers and the cascade](guides/providers.md) | The built-in providers, how one is picked, routing, `NoProviderError`, the client's state, connecting |
| [Conversations and turns](guides/conversations.md) | `ai.chat()` and `ai.conversation()`, turn context, queue, timeouts, warm sessions, events, attachments, the conversation's state |
| [Page tools](guides/tools.md) | `defineTool`, tool context, terminal tools, tools the visitor answers, middleware, WebMCP |
| [Skills](guides/skills.md) | Instructions for the visitor's AI on your site, from your origin or shared on GitHub |
| [Structured output](guides/structured-output.md) | A JSON Schema in, a parsed and validated object out, from any provider |
| [Embeddings and search by meaning](guides/embeddings.md) | `ai.embed()`, `@leuria/store` and a model in the page with `@leuria/web-embed` |
| [Connect UI](guides/connect-ui.md) | The connect flow, and Leuria's elements for any page or for React |
| [React](guides/react.md) | `@leuria/react` hooks |
| [Custom providers](guides/custom-providers.md) | Plug another model or API into the cascade |

The engine's own API, for writing another client, is the [engine protocol](protocol.md).

## Packages

| Package | What |
| --- | --- |
| [`@leuria/client`](../../packages/client) | The SDK: providers, conversations, tools, structured output, embeddings |
| [`@leuria/connect`](../../packages/connect) | The Connect UI as web components, for any page and framework |
| [`@leuria/react`](../../packages/react) | React hooks on the client's state |
| [`@leuria/react-connect`](../../packages/react-connect) | The Connect UI elements as React components |
| [`@leuria/store`](../../packages/store) | Search by meaning in the visitor's browser |
| [`@leuria/web-embed`](../../packages/web-embed) | A small embedding model in the page |

The [live demos](https://demo.leuria.dev) use them: a shop (in React and in plain HTML), a notes site with search by meaning and a field guide with a team builder. Their code is in [leur-ia/demo](https://github.com/leur-ia/demo).
