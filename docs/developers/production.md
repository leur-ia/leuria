# Going to production

What to decide before your AI feature meets real visitors.

## Choose the cascade

Providers are tried in order, for each request. A common order:

```ts
const ai = createAI({
  providers: [
    leuria({ app: "Mug shop" }),                  // the visitor's own AI
    promptAPI(),                                  // the browser's built-in model
    server({ url: "/api/ai/chat/completions" }),  // yours, as the last resort
  ],
})
```

- **`leuria()` first.** The visitor's own AI is usually the most capable, and costs you nothing. `app` is the name the visitor sees when they approve your site.
- **`promptAPI()` next.** Chrome's built-in model: free, on the device, small. It streams text and returns structured output natively. It doesn't get your tools unless you pass `promptAPI({ tools: true })`, and small models use them poorly.
- **`server()` last, or not at all.** It speaks the Chat Completions API. Your endpoint holds the API key and pays for every call, so put your own limits there: authentication, rate limits, a spending cap. Never put a key in the page.

When nothing can answer, the request rejects with `NoProviderError`. Its `actionable` names a provider a click would fix (usually `bridge`): offer the Connect button then, not an error. See [Providers and the cascade](guides/providers.md).

## Declare what your features need

Pass `needs` to `leuria()` (`tools`, `images`, `effort`, `context`). Leuria then recommends the cheapest of the visitor's AIs that is enough, and marks bigger ones "More than this site needs". Your visitors spend less of their plan, and a free model on their computer often does the job. See [Providers](guides/providers.md#declare-what-your-features-need).

## What the visitor sees

Visitors don't know what a provider or an engine is, and don't need to. Keep your words about what they get:

- Use the Connect UI ([`<leuria-connect-button>`](guides/connect-ui.md), or `ConnectButton` in React). It covers every state in plain words: looking for their AI, waiting for their approval, connected (with the model's name), not connected, and how to get Leuria when it isn't installed.
- Say which AI answers with `<leuria-ai-status>` ("Your AI · Codex", "This browser's AI", "No AI yet"). People trust an answer more when they know where it comes from.
- Show errors as sentences, not codes. A `TimeoutError` or a failed turn is "The assistant couldn't answer this time. Try again."
- Don't hide the feature when there is no AI yet: show it, and the Connect button next to it.

## Privacy

| Provider | Where the prompt and tool results go |
| --- | --- |
| `leuria()` | The AI the visitor chose in Leuria: a model on their computer (LM Studio, Ollama), or a service they already use (ChatGPT through Codex, Claude Code, an API key of theirs). Never through your server |
| `promptAPI()` | Nowhere: the model runs in the browser |
| `server()` | Your server, and whatever model it calls |

- `localOnly: true` (per request or per conversation) skips providers that run on your side, so the request never reaches your server. It doesn't restrict which AI the visitor chose in Leuria: that's their decision.
- Embeddings through Leuria only use models on the visitor's computer (LM Studio or Ollama), never a network service. `@leuria/store` keeps the index in the browser (IndexedDB, private to your origin).
- The grant token Leuria gives your site is kept in `localStorage`. `ai.disconnect()` forgets it; visitors can also disconnect your site from Leuria.

## Content-Security-Policy

With a CSP, allow the page to reach Leuria on the visitor's machine:

```
connect-src 'self' http://127.0.0.1:19570 ws://127.0.0.1:19570
```

The SDK calls the engine over HTTP (`/health`, pairing, sessions, embeddings) and opens WebSockets for your page tools. It sends nothing to the engine before the visitor clicks Connect: that click opens a `leuria://connect` link, and Leuria asks the visitor in its own window. The browser may ask once whether to open Leuria, and whether the site may reach the visitor's computer (local network access).

If you use the in-page embedding model from a CDN (`@leuria/web-embed/cdn`, which the Docusaurus plugin uses), also allow `worker-src blob:`, `https://cdn.jsdelivr.net` in `script-src` and `connect-src`, and `https://huggingface.co` plus its file hosts in `connect-src`. Use `remoteHost` to serve the model from your own site instead.

## Tool safety

Tools are how the AI acts on your page, so treat them like an API you expose:

- **They run in the page, with the page's rights.** The AI can call nothing else: through Leuria it runs with its own tools switched off, in an empty folder. It can still call your tools with any arguments.
- **Treat arguments as untrusted input.** Validate them as you would a form. Take the current account, page or selection from the turn context (`send(text, { context })`, read as `ctx.context`), never from the model's arguments.
- **Ask the visitor before anything that matters.** Leave out `execute` and the call waits for your UI (`submitToolResult` or `rejectToolCall`). See [Page tools](guides/tools.md).
- **Bound retries.** `ctx.callCount` says how often a tool ran in this turn; `maxSteps` (default 10) caps the calls per turn.
- **Stop when the work is done.** `ctx.endTurn(outcome)` ends the turn from a tool, for tools whose result is the answer.
- **Redact on the way out.** Middleware (`createAI({ middleware })`) wraps every tool call. Use it to log, block, trim results, or mark text you don't control as data, not instructions.
- Mark tools for the browser's agents with `annotations` (`readOnlyHint`, `consequentialHint`, `untrustedContentHint`) when you offer them through WebMCP.

## Sessions and the page's life

- A conversation keeps one session with the visitor's AI, so follow-ups are fast. `convo.warm()` starts it before the first message.
- Sessions close when the page goes away (`pagehide`). Turn that off with `closeOnUnload: false`, and close them yourself with `ai.closeAll()`.
- Histories belong to the page: store `conversation.getState().messages` and pass them back as `messages` to carry a conversation over a reload. A running agent session isn't re-attached.
- A site may hold 4 live sessions at once. Close conversations you no longer need (`convo.close()`).

## Test without an AI

A provider is a small class, so tests can script the AI. Extend `BaseProvider` and answer each turn yourself, calling your tools through `context.runTool`, as the SDK's own tests do:

```js
import { BaseProvider, createAI } from "@leuria/client"

class ScriptedAI extends BaseProvider {
  constructor() { super("scripted", "Scripted", "device", { status: "ready", capabilities: ["chat", "tools"] }) }
  async detect() {}
  async createSession() {
    return {
      send: async (message, context) => {
        const found = await context.runTool({ name: "list_mugs", args: {} })
        const text = found.ok ? `We have ${found.result.length} mugs.` : "No mugs."
        context.text(text)
        return { text }
      },
      close() {},
    }
  }
}

const ai = createAI({ providers: [new ScriptedAI()], autoDetect: false, closeOnUnload: false })
```

See [Custom providers](guides/custom-providers.md). For a real round trip with the visitor's AI, run `npx @leuria/cli test`.

## Before you ship

- Read the [security notes](../security.md): what Leuria protects against today, and the known gaps.
- Test with Leuria not installed, installed but not connected, and connected. Then with the connection refused, and in a browser without a built-in model.
