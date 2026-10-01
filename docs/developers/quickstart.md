# Quickstart

Add an AI feature that runs on your visitor's own AI. Pick the path that fits your site; each one is complete.

## Plain HTML

No bundler, no build. One script from a CDN brings the SDK and the Connect UI.

```html
<!doctype html>
<leuria-connect-button></leuria-connect-button>
<p><input id="question" placeholder="Ask something"> <button id="ask">Ask</button></p>
<p id="answer"></p>

<script type="module">
  import { leuria, promptAPI, createAI, setDefaultClient } from "https://cdn.jsdelivr.net/npm/@leuria/connect/dist/standalone.js"

  // The visitor's own AI first, then the browser's built-in model.
  const ai = createAI({ providers: [leuria({ app: "My site" }), promptAPI()] })
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

`<leuria-connect-button>` handles the whole connect flow: it finds Leuria, asks the visitor to approve your site, and explains how to get Leuria when it isn't installed.

## With a bundler

```sh
npm install @leuria/client @leuria/connect
```

```ts
import { leuria, promptAPI, createAI, defineTool } from "@leuria/client"
import { setDefaultClient } from "@leuria/connect" // defines <leuria-connect-button>

const ai = createAI({ providers: [leuria({ app: "Mug shop" }), promptAPI()] })
setDefaultClient(ai)

const MUGS = [{ name: "Celadon", price: 24 }, { name: "Tenmoku", price: 31 }]

// Runs in the page. The AI only sees what the tool returns.
const listMugs = defineTool({
  name: "list_mugs",
  description: "List the mugs for sale, with their price in euros.",
  inputSchema: { type: "object", properties: {} },
  execute: () => MUGS,
})

const answer = await ai.chat({ prompt: "Which mug is cheapest?", tools: [listMugs] }).text()
```

Put `<leuria-connect-button></leuria-connect-button>` somewhere in your page. Tools need an AI that can call them, such as the visitor's own AI through Leuria. See [Page tools](guides/tools.md).

## React

```sh
npm install @leuria/client @leuria/react @leuria/react-connect
```

```tsx
import { leuria, promptAPI, createAI } from "@leuria/client"
import { LeuriaProvider, useConversation } from "@leuria/react"
import { ConnectButton } from "@leuria/react-connect"

// Once, outside render.
const ai = createAI({ providers: [leuria({ app: "My app" }), promptAPI()] })

function Assistant() {
  const { messages, status, send } = useConversation({ system: "Answer in one short paragraph." })
  return (
    <>
      {messages.map((m) => <p key={m.id}>{m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}</p>)}
      <button disabled={status === "running"} onClick={() => send("What can you do?")}>Ask</button>
    </>
  )
}

export const App = () => (
  <LeuriaProvider client={ai}>
    <ConnectButton />
    <Assistant />
  </LeuriaProvider>
)
```

See [React](guides/react.md) for every hook.

## Try it with your own AI

Your page already answers with the browser's built-in model where there is one (Chrome with its AI features on). To answer with your own AI:

1. Run Leuria: the [desktop app](https://leuria.eu/download), or `npx @leuria/cli` in a terminal ([Run Leuria from a terminal](cli.md)).
2. Open your page and click **Connect your AI**.
3. Allow your site in the window Leuria opens.

The next request goes to your AI, and the conversation carries on where it was.

## Next

- [Examples](examples/index.md): small recipes you can run on this site.
- [Providers and the cascade](guides/providers.md): who answers, and what happens when nobody can.
- [Page tools](guides/tools.md), [Conversations](guides/conversations.md), [Structured output](guides/structured-output.md).
- [Ask AI for your Docusaurus site](docusaurus.md): one plugin.
- [Going to production](production.md).
