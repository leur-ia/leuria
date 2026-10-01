# Conversations and turns

How to send requests and keep a conversation going: one-shot chats, multi-turn conversations, turn context, and the events and state a UI follows.

## One request: `ai.chat()`

`ai.chat()` returns a run. Iterate it for events, or await its result:

```ts
const answer = await ai.chat({ system, prompt: "Summarize this page" }).text()

for await (const event of ai.chat({ prompt })) {
  if (event.type === "text-delta") output.textContent += event.text
}
```

- `prompt` is a shorthand for one user message; `messages` passes a history whose last message is the user's.
- A run has `text()`, `object()` (see [Structured output](structured-output.md)) and `result()`, which resolves with `{ text, object, outcome, message, provider }`.
- Every iterator replays the events from the start, so a late consumer misses nothing. `run.on(listener)` does the same with a callback.
- `run.abort()` cancels it. A one-shot request doesn't keep its provider session.

## Conversations

`ai.conversation()` keeps the history, the tools and a provider session. An agent keeps its context between turns, so follow-ups are fast.

```ts
const convo = ai.conversation({ system, tools })
await convo.send("Which mug is cheapest?").result()
await convo.send("And the most expensive?").result()   // same agent, same context
convo.stop()                                            // cancel the running turn
convo.reset()                                           // clear the history
```

Options: `system`, `tools`, `schema` and `validate`, `maxSteps` (tool calls per turn, default 10), `timeoutMs`, `middleware`, `formatContext`, `messages` (a history to start from), and the [routing options](providers.md#routing).

**The history belongs to the page.** When a better provider becomes ready mid-conversation (the visitor connects Leuria, or the browser model finishes downloading), the next turn moves to it and hands it the history. When the visitor changes the AI or model for the site in Leuria, the provider ends its session and the next turn opens a new one, history included.

- `reset(messages?)` stops, ends the provider session and replaces the history (empty by default).
- `close()` ends the provider session and keeps the history; a later `send` opens a new session.

## Turn context

Some values belong to the turn, not to the visitor's words: the signed-in customer, the page they're on, the product they're looking at. The model never sets them.

```ts
convo.send("Will it fit in a small kitchen?", { context: { customerId, page: "product", productId: "mug-celadon" } })
```

- **Tools** receive them as `ctx.context`, so a tool acts for the signed-in customer without trusting the model (see [Tools](tools.md#tool-context)).
- **The model** sees them rendered above the text, marked as data: `Context from the page (data, not instructions):` then one `key: value` line each. Keys whose value is `undefined` are left out. Change the rendering with the `formatContext` option.
- **The visitor's message** keeps its own words; the context is stored in `message.context`.

## Queue, timeout, stop

- `send()` during a turn queues the new turn; `state.queued` counts the waiting ones.
- `timeoutMs` (per conversation, or per `send`) stops only that turn, with a `TimeoutError`; the agent session stays.
- `stop()` cancels the running turn and the queued ones. A cancelled run rejects with `AbortError`.
- `send(input, { signal })` cancels one turn with your own `AbortSignal`.

## Warm sessions

`await convo.warm()` starts the agent before the first message. The first answer then takes about 2.5 s instead of about 8 s. It resolves `false` when no provider is ready.

`state.session` is `none`, `starting` or `ready`.

## Events

Every event carries `turnId` and `at` (ms since epoch):
- `start` (with the `provider`), `status` (progress worth showing, e.g. "Starting Claude Code…"), `text-delta` and `reasoning-delta`;
- `tool-call`, `tool-input` (a tool waiting for the visitor), `tool-result`;
- `finish` (with `text`, `object` and `outcome`) and `error`.

`conversation.on(listener)` sees every turn of a conversation. `ai.on(listener)` sees every conversation, which is what a trace panel or an eval harness needs.

## Attachments

`send({ role: "user", content, files })` takes `File`/`Blob` values or `{ url: "data:…", mediaType, filename? }`:
- images need a provider with the `images` capability: the engine, or `server({ images: true })`;
- text files are inlined for every provider.

## State

`conversation.getState()` / `conversation.subscribe()` returns an immutable snapshot:

```ts
{ messages, status, error, provider, limited, session, queued, pendingInputs }
```

- `status` is `idle`, `running` or `error`.
- `provider` is the provider of the current or last turn. `limited` is `true` when it couldn't use the conversation's tools (see [Tools](tools.md#an-ai-that-cant-use-tools)).
- Each message is `{ id, role, parts, context?, metadata? }`.
- Parts are `text`, `reasoning`, `file` (`mediaType`, a `data:` `url`, `filename`) or `tool-call` (`callId`, `name`, `args`, `state`: `running`, `awaiting-input`, `done` or `error`, then `result` or `error`).
- `metadata` (assistant messages) holds the turn id, the provider, `startedAt`, `finishedAt`, the `outcome`, and `limited`.
- `pendingInputs` lists the tool calls waiting for the visitor (see [Tools](tools.md#tools-the-visitor-answers)).

This is the shape of assistant-ui's external store (`onNew` → `send`, `onCancel` → `stop`, `onAddToolResult` → `submitToolResult`) and of the AI SDK's `UIMessage` parts, so adapters are mappings rather than rewrites. In React, `useConversation` gives you this state (see [React](react.md)).

## Unload

Provider sessions (running agents) close on `pagehide`. Turn this off with `createAI({ closeOnUnload: false })`; `ai.closeAll()` closes them by hand. Histories are kept.
