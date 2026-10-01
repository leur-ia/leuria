# Custom providers

How to plug another AI into the cascade: an in-page model (Transformers.js, WebLLM), another API, anything that can chat or embed.

```ts
import { BaseProvider } from "@leuria/client"

class MyProvider extends BaseProvider {
  constructor() { super("in-page", "Small in-page model", "device", { status: "unknown", capabilities: [] }) }
  async detect() { this.setState({ status: "ready", capabilities: ["chat"] }) }
  async createSession(options) {
    return {
      send: async (message, context) => {
        // stream with context.text(delta); run page tools with context.runTool({ name, args })
        return { text }
      },
      close() {},
    }
  }
}

const ai = createAI({ providers: [leuria(), new MyProvider(), promptAPI()] })
```

## The provider

Implement `Provider`, or extend `BaseProvider`, which keeps the state and notifies changes: implement `detect()` and `createSession()`, and call `setState(patch)`.

- `id`, `label` and `locality` (`device`, `visitor-cloud` or `site`). Ids are unique in a client.
- `getState()` returns `{ status, capabilities, model?, action?, progress?, detail?, embedModel? }`; `onChange(listener)` notifies changes. The core reads the state again after each change.
- `detect()` checks availability. Keep it cheap: it runs at creation, on focus and every few seconds while the page is visible.
- `connect()` (optional) resolves `needs-action`: pair, start a download… It is called from a click. Set `action` to `connect` or `download` so the UI can say what a click does.
- `disconnect()` (optional) forgets the visitor's grant in this browser.
- `offers` (optional): `["chat"]` by default; `["embed"]` for an embedder only, `["chat", "embed"]` for both.
- `embed({ texts, kind, signal })` (for `embed`): returns `{ vectors, model }`, one vector per text. Set `capabilities` to include `embed` and `embedModel` to the model's name when ready.

Capabilities decide what the cascade sends it: `chat`, `tools`, `structured` (native schemas), `agent`, `images`, `embed` (see [Providers](providers.md#the-cascade)).

## The session

`createSession(options)` opens a provider-side conversation. It receives:
- `system`;
- `tools`: descriptors only (`name`, `description`, `inputSchema`);
- `schema`: only when the provider declared native `structured` support (otherwise the core uses the tool route, see [Structured output](structured-output.md));
- `history`: the conversation so far, before the first `send`;
- `maxSteps`.

The core owns the history. A session gets each new user message through `send(message, context)`, with the turn context already rendered into the text. It may keep its own context (an agent session) or resend the history (a stateless HTTP API).

- It streams through `context.text(delta)` and `context.reasoning(delta)`, and may report progress with `context.status(message)`.
- Tool execution always goes through `context.runTool({ name, args, callId? })`, so events, message parts, middleware and the tool budget stay consistent across providers. It never throws: failures come back as `{ ok: false, error }`, to hand to the model.
- When `context.signal` aborts (cancel, timeout, a tool's `endTurn`), it stops the turn, settles soon after, and keeps itself usable if it can.
- `send` resolves with `{ text }` when the turn ends.
- An optional `warm()` prepares it ahead of the first turn (start an agent, load a model).
- `close()` ends it.
- `closed` (optional): set it when the provider ended the session on its own (e.g. the visitor changed the AI or model): the conversation opens a new one, history included.
