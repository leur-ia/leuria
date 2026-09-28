# @leuria/client

Browser SDK for [Leuria](https://github.com/leur-ia/leuria). Write each AI feature once. Each request is served by the visitor's own AI (through the Leuria engine), the browser's built-in model, or your server, whichever this visitor has. Tools run in the page.

```ts
import { createLeuria, bridge, browserAI, server } from "@leuria/client"

const ai = createLeuria({ providers: [bridge({ app: "My shop" }), browserAI(), server({ url: "/api/ai" })] })
const answer = await ai.chat({ prompt: "Which mug is cheapest?", tools: [searchProducts] }).text()
const order = await ai.chat({ prompt: freeText, schema: orderSchema }).object()
const convo = ai.conversation({ system, tools })   // multi-turn, keeps history
exposeTools([searchProducts])                     // the same tools for the browser's own agents (WebMCP)
```

Visitors run the engine with `npx @leuria/cli`. Docs: [docs/sdk.md](https://github.com/leur-ia/leuria/blob/main/docs/developers/sdk.md). Apache-2.0.
