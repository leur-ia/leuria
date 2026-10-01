# React

How to use Leuria from React: the visitor's AI, conversations and the connect flow, as React state.

```tsx
import { leuria, promptAPI, createAI } from "@leuria/client"
import { LeuriaProvider, useConnect, useConversation } from "@leuria/react"

// Create the client once, outside render.
const ai = createAI({ providers: [leuria({ app: "My shop" }), promptAPI()] })

export function App() {
  return (
    <LeuriaProvider client={ai}>
      <Assistant />
    </LeuriaProvider>
  )
}
```

[`@leuria/react`](../../../packages/react) is headless: bring your own UI, or use [`@leuria/react-connect`](connect-ui.md#leuriareact-connect-the-same-in-react) for Leuria's. The hooks read the client's immutable snapshots through `useSyncExternalStore`, so they work with React 18 and 19, StrictMode included.

## `LeuriaProvider` and `useLeuria`

`<LeuriaProvider client={ai}>` makes a client available to the hooks below it. `useLeuria()` returns it, and throws when there is no provider above.

## `useLeuriaState`

Every provider's state, `active` (what answers now) and `pending` (what a click would enable): the snapshot from `ai.getState()` (see [Providers](providers.md#state-for-the-ui-and-for-adapters)). Pass a selector to re-render only when part of it changes. `useProvider(id)` returns one provider's state.

```tsx
const active = useLeuriaState((s) => s.active?.label)
const bridge = useProvider("bridge")
```

## `useConnect`

The connect flow of one provider, by default the visitor's own AI through Leuria (`connection()` from `@leuria/client`, see [Connect UI](connect-ui.md#the-connect-flow-connectionai)). It shows the same attempt as every other component and Leuria's Connect UI.

```tsx
function Connect() {
  const { status, model, connect, alternatives, chooseInstead, manage } = useConnect()
  if (status === "connected") return <button onClick={manage}>Your AI · {model} · Change</button>
  if (status === "not-running")
    return (
      <p>
        <a href="https://leuria.eu" target="_blank" rel="noopener">Get Leuria</a>, then <button onClick={connect}>try again</button>
        {alternatives.map((p) => <button key={p.id} onClick={() => chooseInstead(p.id)}>or use {p.label}</button>)}
      </p>
    )
  return <button onClick={connect} disabled={status === "connecting"}>Connect your AI</button>
}
```

`status` is `checking`, `not-running`, `not-connected`, `connecting`, `declined` or `connected`. Call `connect()` from a click. `disconnect()` forgets the site's grant.

## `useConversation`

A conversation that lives as long as the component: its state (`messages`, `status`, `error`, `provider`, `session`, `queued`, `pendingInputs`) plus `send`, `stop`, `reset`, `warm`, `submitToolResult` and `rejectToolCall` (see [Conversations](conversations.md)).

```tsx
function Assistant() {
  const { messages, status, send, stop } = useConversation({ system, tools: [searchProducts] })
  return (
    <>
      {messages.map((m) => <Message key={m.id} message={m} />)}
      <Composer onSend={(text) => send(text)} onStop={stop} running={status === "running"} />
    </>
  )
}
```

- Options are read on the first render. To change the system prompt or tools, remount (give the component a new `key`) or call `reset`.
- The conversation's session closes on unmount and on `pagehide`; the history stays, and a later `send` opens a new session.
- `conversation` is the underlying `Conversation`, e.g. for `conversation.on()`.

`useConversationState(conversation)` follows a conversation created elsewhere.

## `useChat`

One-shot requests (summaries, structured output) with their progress as state. `start(request)` returns the run, and stops a running one; `stop()` cancels.

```tsx
function Summary({ page }: { page: string }) {
  const { text, progress, start } = useChat()
  return (
    <>
      <button onClick={() => start({ prompt: `Summarize:\n${page}` })}>Summarize</button>
      {progress && <p>{progress}</p>}
      <p>{text}</p>
    </>
  )
}
```

`status` is `idle`, `running`, `done` or `error`; `text` streams in; `progress` is worth showing while it starts (e.g. "Starting Codex…"). Stopping is not an error: the status goes back to `idle`. For structured output, `await start({ prompt, schema }).object()`.

## `useExposedTools`

Offers page tools to the browser's own agents (WebMCP) while the component is mounted (see [Tools](tools.md#webmcp-the-same-tools-for-the-browsers-agents)). Pass a stable array, defined outside render or memoized.

```tsx
const tools = [searchProducts, addToCart]

function Shop() {
  useExposedTools(tools)
  …
}
```
