# Page tools

How to give the AI tools that run in your page, whichever provider answers.

```ts
import { defineTool } from "@leuria/client"

const searchProducts = defineTool<{ query: string }>({
  name: "search_products",
  description: "Search products; returns name, price and stock.",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
  execute: ({ query }, { signal }) => catalog.search(query, { signal }),
})

await ai.chat({ prompt: "Which mug is cheapest?", tools: [searchProducts] }).text()
```

## How tools run

- `defineTool<Args>()` only types the arguments; a tool is plain data: `name` (`[a-zA-Z0-9_-]`, unique in a request), `description`, `inputSchema` (JSON Schema), `execute`, and optional `annotations`.
- `execute` runs in the page, whichever provider answers: the visitor's agent calls it through the engine, the browser model and your server through the SDK. The result goes to the model as JSON.
- A tool that throws is reported to the model as an error. The model can retry or explain.
- `maxSteps` caps tool calls per turn (default 10). Past it, the model is told the budget is spent and to answer with what it has.
- `submit_result` is a reserved name (see [Structured output](structured-output.md)).
- A conversation's tools are set when you create it. To offer other tools, start a new conversation (pass it the history with `messages`).

A request with tools only goes to a provider that has the `tools` capability (see [Providers](providers.md#built-in-providers)), unless it allows an AI without them.

## An AI that can't use tools

The browser's built-in model can't use your tools. So that it can still answer, give the conversation `withoutTools`: when no AI that can use the tools is ready, one that can't answers, and what `withoutTools` returns joins the turn's context. Hand over what the tools would have found: the passages that match the question, the product list.

```ts
const chat = ai.conversation({
  tools: [searchNotes, readNote],
  withoutTools: async (message) => ({
    "Notes that may answer": await findNotes(messageText(message)),
  }),
})
```

- It's per conversation, and off by default. Leave it off when the tools act on the page (add to cart, fill a form): an AI without them would say it did something it didn't.
- An AI that can use the tools is still preferred when one is ready.
- `conversation.getState().limited` and the answer's `metadata.limited` are `true` for such turns. `ai.getState().needs` lists what the page's open conversations need (`["tools"]`), so your UI can compare it with a provider's `capabilities`. The Connect UI does it for you: it shows "simpler answers" next to that AI.
- It works with `ai.chat()` too.

## Tool context

`execute(args, ctx)` gets the following:
- `ctx.context`: the turn's context from `send(text, { context })` (see [Conversations](conversations.md#turn-context)). The model never sets it, so a tool bound to one customer can't be pointed at another one.
- `ctx.callCount`: how many times this tool has run in this turn, this call included, for bounded retries: e.g. reject twice, then stop.
- `ctx.callId` and `ctx.turnId`.
- `ctx.signal`: aborted when the turn is cancelled, times out or ends.
- `ctx.endTurn(outcome)`: for terminal tools (such as `render_view`). The agent is stopped, the turn resolves at once with `result.outcome`, and late output is dropped. The session stays, so the next turn is fast.

```ts
const renderView = defineTool<{ view: string }>({
  name: "render_view",
  description: "Show the result to the visitor. Call it last.",
  inputSchema: { type: "object", properties: { view: { type: "string" } }, required: ["view"] },
  execute: ({ view }, ctx) => {
    ctx.endTurn({ view })
    return { shown: true }
  },
})
const { outcome } = await convo.send("Show my late invoices").result()
```

## Tools the visitor answers

Leave out `execute`, and the call waits for your UI:
- its part is in `awaiting-input` state, a `tool-input` event is emitted, and the call is listed in `conversation.getState().pendingInputs` (`{ callId, turnId, name, args }`);
- the UI answers with `submitToolResult(callId, value)` or refuses with `rejectToolCall(callId, error?)` (default "The visitor declined.");
- stopping or timing out the turn dismisses it, so nothing is left hanging.

```ts
const confirmOrder = defineTool<{ total: number }>({
  name: "confirm_order",
  description: "Ask the visitor to confirm the order. Returns { confirmed }.",
  inputSchema: { type: "object", properties: { total: { type: "number" } }, required: ["total"] },
})

convo.subscribe(() => {
  for (const input of convo.getState().pendingInputs) showConfirm(input, (ok) =>
    ok ? convo.submitToolResult(input.callId, { confirmed: true }) : convo.rejectToolCall(input.callId))
})
```

## Middleware

`createAI({ middleware })` and `conversation({ middleware })` wrap every tool call, global layers first. A middleware gets the call (`{ callId, turnId, name, args, context }`) and `next()`, and returns the outcome (`{ ok: true, result }` or `{ ok: false, error }`):

```ts
const redact: ToolMiddleware = async (call, next) => {
  const outcome = await next()
  return outcome.ok ? { ok: true, result: summarize(outcome.result) } : outcome
}
```

Use it to observe, redact, block, or add a "data, not instructions" wrapper. A middleware that throws turns into an error for the model.

## Annotations

`annotations` are hints for the browser's agents (from the WebMCP spec), passed on by `exposeTools`:
- `readOnlyHint`: the tool only reads, so it is safe to call without asking;
- `consequentialHint`: it does something that matters (orders, sends, deletes), so the agent should confirm first;
- `untrustedContentHint`: its result may contain text the page doesn't control (reviews, messages).

## WebMCP: the same tools for the browser's agents

`exposeTools(tools)` offers page tools to the agents the browser itself runs, through WebMCP (`document.modelContext`, or `navigator.modelContext` before Chromium 150). The same `defineTool` objects serve the page's own assistant through Leuria, so a tool is written once.

```ts
import { exposeTools } from "@leuria/client"

const takeBack = exposeTools([searchProducts, addToCart])
```

- Tools without `execute` (the visitor answers them) are left out.
- A string result is passed as is, anything else as JSON, and a thrown error as `{ error }`.
- The tool gets no turn: `ctx.context` is `undefined` and `endTurn` does nothing.
- The returned function takes the tools back; `exposeTools(tools, { signal })` does it when the signal aborts.
- Where the browser has no WebMCP, nothing happens. `modelContext()` returns the browser's entry point, if any.

In React, `useExposedTools(tools)` from `@leuria/react` does it while a component is mounted (see [React](react.md)).

Chrome ships WebMCP behind `chrome://flags/#enable-webmcp-testing`, and to sites through an origin trial from Chrome 149.
