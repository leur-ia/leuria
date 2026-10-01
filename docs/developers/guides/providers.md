# Providers and the cascade

How the SDK picks the AI that answers each request, and how a page follows that choice.

```ts
import { createAI, leuria, promptAPI, server } from "@leuria/client"

const ai = createAI({
  providers: [
    leuria({ app: "Mug shop" }),                      // the visitor's own AI, through the Leuria engine
    promptAPI(),                                      // the browser's built-in model (Chrome's Prompt API)
    server({ url: "/api/ai/chat/completions" }),      // your server, as the last resort
  ],
})
```

## The cascade

Providers are tried in the order you give them. A request goes to the first one that:
1. is `ready`;
2. has the capabilities the request needs: `tools` when tools are given (unless the conversation has `withoutTools`), `images` when a message has an image, and `structured` or `tools` when a schema is given;
3. passes the routing options (below).

### The visitor's own AI first

Leuria is the preferred way: the visitor's own AI, with no cost to you. When you declare `leuria()`, the providers after it wait while it isn't ready. They answer only once the visitor picks one instead, from the Connect UI's secondary choices ("use this browser's AI", "use this site's AI"). The pick lasts for this page: next time, their own AI is proposed again.

- `ai.chooseInstead(id)` records the visitor's pick. The Connect UI calls it for you; call it from your own UI's click otherwise.
- `ai.getState().alternatives` lists what could answer once picked: ready providers, and ones a click would download.
- `createAI({ fallback: "auto" })` skips the question: the others answer at once, as plain fallbacks.
- A provider you name in `provider` (see [Routing](#routing)) is your own choice, and never waits.
- Providers listed *before* `leuria()` are never held back. A site that doesn't want to propose Leuria simply doesn't declare `leuria()`.

The page never needs to know which provider answered, but it can: every run starts with a `start` event naming it, and each assistant message keeps it in `metadata.provider`.

## Built-in providers

| Provider | Id | Locality | Capabilities | Visitor action |
| --- | --- | --- | --- | --- |
| `leuria()` | `bridge` | device | chat, tools, agent, images; embed when the visitor has a local embedding model (structured output through the tool route) | `connect`: a `leuria://connect` link opens Leuria, which asks in its own window |
| `promptAPI()` | `browser` | device | chat, structured; tools with `promptAPI({ tools: true })` | `download`: fetch the browser's model |
| `server({ url })` | `server` | site | chat, tools (unless `tools: false`); structured natively with `jsonSchema: true`; images with `images: true` | none |

**`leuria(options)`**: the visitor's own AI, through the Leuria engine on their computer. Until the site is connected it sends nothing (Leuria wouldn't answer a site it doesn't know), so it starts as `needs-action` / `connect`, and becomes `unavailable` only when a connect gets no answer.
- `app`: the name shown to the visitor in the approval window.
- `needs`: what your features need, so Leuria recommends an AI and model that fit, and no bigger (see [Declare what your features need](#declare-what-your-features-need)).
- `url`: the engine's address (default `http://127.0.0.1:19570`).
- `storage`: where the site's token is kept (default `localStorage`, else memory).
- `id`: default `bridge`.

**`promptAPI(options)`**: the browser's built-in model (`LanguageModel`, Gemini Nano in Chrome). Free and on the device, but small: good for short answers, extraction and structured output.
- `tools`: pass page tools to the model. Default false, because browser support varies: Chrome's model accepts them but may not call them. To let it answer a conversation that has tools, use `withoutTools` (see [Tools](tools.md#an-ai-that-cant-use-tools)).
- `languages`: e.g. `["en"]`, for the model's expected inputs and outputs.
- `id` (default `browser`), `label`.

**`server(options)`**: your own endpoint that speaks the OpenAI Chat Completions API with streaming, and adds the API key on the server. Never put a key in the page. Tools still run in the page.
- `url` (required), `model`, `headers` (an object, or a function called per request).
- `jsonSchema`: supports `response_format: { type: "json_schema" }`. Default false.
- `tools`: supports tool calls. Default true. `images`: accepts images. Default false.
- `id` (default `server`), `label`, `fetch`.

Each provider has a `locality`: `device` (the visitor's machine), `visitor-cloud` (a service the visitor chose, reached from their machine) or `site` (your server). Use it to tell visitors where their data goes.

To add your own provider (an in-page model, another API), see [Custom providers](custom-providers.md).

### Declare what your features need

Visitors often run a model far stronger (and costlier) than a site's features need. Tell Leuria what they need, and it guides the visitor to the cheapest of their AIs that is enough:

```ts
leuria({ app: "Kiln & Co.", needs: { tools: true, effort: "light" } })
```

- `tools`, `images`: the capabilities your features use.
- `effort`: how hard the tasks are. `light` (answer, extract, summarize), `standard` (several steps with tools), `deep` (long reasoning, agentic work).
- `context`: about how much text one turn sends, in tokens.

When the visitor connects, and whenever they change the site's AI, Leuria shows "Recommended for this site", with a reason ("On this computer: free, and enough for this site"). It marks other models "More than this site needs" or "May struggle here". It's guidance only: the visitor decides. Declare what your features really need: over-declaring shows up to the visitor as models marked "More than this site needs". There are no model names in this vocabulary, on purpose.

## Routing

Every request and conversation takes routing options:

- `localOnly: true` keeps data on the device: providers whose locality isn't `device` are skipped (so `server` is).
- `provider: "browser"` or `provider: ["browser", "server"]` picks providers explicitly, in that order.

```ts
const summary = await ai.chat({ prompt, localOnly: true }).text()
```

## When nothing can answer

The run rejects with `NoProviderError`:
- `needs` lists the capabilities the request needed;
- `reasons` says, per provider, why it could not answer (`{ id, label, state, reason }`);
- `choices` lists the providers that would answer once the visitor picks one instead of their own AI;
- `actionable` names a provider that a click would fix, such as `bridge`, which needs a connect.

```ts
try {
  await ai.chat({ prompt, tools }).text()
} catch (error) {
  if (error instanceof NoProviderError && error.actionable) showConnectButton()
}
```

## State, for the UI and for adapters

`ai.getState()` / `ai.subscribe(listener)` is an immutable snapshot. It fits `useSyncExternalStore` directly.

- `providers`: every provider's state: `id`, `label`, `locality`, `offers`, `status` (`unknown`, `detecting`, `unavailable`, `needs-action`, `downloading`, `ready`), `capabilities`, `model` (e.g. "Claude Code", "Gemini Nano"), `action` (`connect` or `download`), `progress` (0 to 1 while downloading), `detail` (why, in words), `embedModel`.
- `active`: the provider a plain chat request would use now.
- `pending`: a provider that needs a visitor action and is preferred over the active one (or none is ready). Offer it, even while a fallback answers, so the visitor can bring their own AI back.
- `embedder` and `embedPending`: the same, for embeddings (see [Embeddings](embeddings.md)).
- `alternatives`: providers waiting for the visitor to pick them instead of their own AI (see [The visitor's own AI first](#the-visitors-own-ai-first)).

Providers are detected at creation, again when the page regains focus, and every `watchMs` (default 5000 ms) while the page is visible, so the page follows what the visitor does in Leuria. `autoDetect: false` turns this off; `ai.detect()` checks again by hand.

## Connecting and disconnecting

- `ai.connect(providerId?)` runs the pending visitor action: opening Leuria to connect, or a model download. Without an id, it takes the first chat provider that needs one. Call it from a click, because it may open a window.
- `ai.disconnect(providerId?)` forgets the site's grant in this browser.

For a ready-made button, or to follow the connect flow in your own UI, see [Connect UI](connect-ui.md).

## Other options

`createAI({ … })` also takes:
- `middleware`: wraps every tool call of every conversation (see [Tools](tools.md#middleware));
- `closeOnUnload`: end provider sessions when the page goes away. Default true (see [Conversations](conversations.md#unload)).

`ai.destroy()` stops watching providers and closes every session.
