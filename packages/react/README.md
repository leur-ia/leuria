# @leuria/react

React hooks for [Leuria](https://github.com/leur-ia/leuria): the visitor's AI, conversations and the connect flow, as React state. Headless: bring your own UI, or use [`@leuria/react-connect`](../react-connect) for Leuria's.

```tsx
import { leuria, promptAPI, createAI } from "@leuria/client"
import { LeuriaProvider, useConnect, useConversation } from "@leuria/react"

const ai = createAI({ providers: [leuria({ app: "My shop" }), promptAPI()] })

<LeuriaProvider client={ai}><App /></LeuriaProvider>

function Assistant() {
  const { messages, status, send, stop } = useConversation({ system, tools: [searchProducts] })
  …
}
```

| Hook | What |
| --- | --- |
| `useLeuriaState(selector?)` | Every provider's state, `active` (what answers now) and `pending` (what a click would enable) |
| `useProvider(id)` | One provider's state |
| `useConnect(id = "bridge")` | `status` (`checking`, `not-running`, `not-connected`, `connecting`, `declined`, `connected`), `model`, `connect()` (call it from a click), `disconnect()`, `retry()`, `alternatives` and `chooseInstead(id)` (another AI for this page, when the visitor prefers), `manage()` (Leuria's settings for this site: its AI and model). It follows `connection()` from `@leuria/client`, so it shows the same attempt as every other component and Leuria's Connect UI |
| `useConversation(options)` | A conversation that lives as long as the component: its state (`messages`, `status`, `session`, `pendingInputs`…) plus `send`, `stop`, `reset`, `warm`, `submitToolResult`, `rejectToolCall`. Options are read on the first render; remount with a new `key` to change them |
| `useConversationState(conversation)` | Follow a conversation created elsewhere |
| `useExposedTools(tools)` | Offers page tools to the browser's own agents (WebMCP, `document.modelContext`) while the component is mounted |
| `useChat()` | One-shot requests: `start(request)` returns the run (`await run.object()`), with `status`, streamed `text`, `provider` and `error` as state |

Create the client once, outside render. The hooks read the client's immutable snapshots through `useSyncExternalStore`, so they work with React 18 and 19, StrictMode included. Apache-2.0.
