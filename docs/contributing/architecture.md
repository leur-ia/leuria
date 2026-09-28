# Architecture

Leuria has two sides and one contract: an **engine** on the visitor's machine, a **browser SDK** in the website, and the **engine protocol** between them ([protocol](../developers/protocol.md)).

```
 website (any origin)                       visitor's machine
┌──────────────────────────┐  HTTP + SSE  ┌─────────────────────────────────────┐
│ @leuria/client           │ ───────────▶ │ leuria engine  127.0.0.1:19570      │
│  Leuria (cascade, state) │              │  server.ts   host/origin/token gate │
│  Conversation (turns)    │ ◀─ WebSocket │  pairing.ts  approval page, grants  │
│  providers:              │  (tool calls)│  routes.ts   /session/*             │
│   bridge ──────────────┐ │              │  session-manager.ts                 │
│   browserAI (Prompt API)│ │              │  webmcp-server.ts  page tools ⇄ MCP │
│   server (site's API)   │ │              │  acp/  agent process over stdio     │
└─────────────────────────┴─┘              │  policy.ts  what the agent may do   │
                                           └──────────────┬──────────────────────┘
                                                          │ ACP (JSON-RPC, stdio)
                                                          ▼
                                            Claude Code adapter (pinned, sandboxed)
```

## Desktop app (`apps/desktop`)

A Tauri 2 shell (Rust) around the same engine, compiled with Bun as a sidecar and started with `start --app`: the engine then prints JSON events on stdout and serves an admin API (`admin.ts`) to the app's UI, authenticated with a random token the shell generates. The UI is React with Sinux stores. See [apps/desktop/README.md](../../apps/desktop/README.md).

## Engine (`packages/engine`, npm `leuria`)

| File | Role |
| --- | --- |
| `cli.ts` | Commands: `start` (default), `setup`, `doctor`, `test`, `sites`, `agents` |
| `server.ts` | The only door: loopback bind, `Host` check, and caller identification. Callers are **local** (no `Origin`), **self** (the approval page) or **site** (needs a grant token) |
| `pairing.ts` | A `leuria://connect` link, registered by the app (`link()`), or (CLI) the page's first claim → the visitor decides (the app, or the engine's page: `decide`, self origin only) → `POST /connect/claim` hands the token to the named origin, with the link's nonce, once |
| `grants.ts` | One grant per origin with a SHA-256 of its token; reloads when another process edits the file |
| `routes.ts` | The `/session/*` API; sessions are only visible to their origin |
| `session-manager.ts` | Session lifecycle, a sandbox folder per session, SSE fan-out, limits |
| `webmcp-server.ts` | Page tools: WebSocket from the page, MCP over HTTP for the agent |
| `acp/acp-client.ts` | Starts the agent and runs the ACP handshake (`initialize`, `authenticate`, `session/new`), then prompts, cancels, streams updates and answers permission requests |
| `acp/registry.ts` | The [ACP registry](https://github.com/agentclientprotocol/registry) (see its FORMAT.md): agents, their distribution (npx, uvx, binary archive) and renamed ids |
| `detect.ts` | Agent CLIs already on the machine, to suggest one |
| `agents.ts` | Installs any registry agent under `~/.leuria/agents/<id>@<version>` (npm or Bun for npx, sha256-checked archives for binaries) and launches it |
| `auth.ts` | Sign-in through ACP v1: agent methods via `authenticate`; terminal methods (only in a TTY, with `auth.terminal`) by re-running the agent with the method's args; signed in means `session/new` succeeds |
| `profiles.ts`, `codex.ts` | Extra hardening for agents whose defaults are unsafe. Codex gets its own `CODEX_HOME`, an all-features-off config, a sandbox `HOME`, and page tools through `CODEX_CONFIG` |
| `admin.ts` | Admin API for the desktop app: status, agents, sign-in, sites, site approvals, check |
| `llm/providers.ts` | LLM providers: LM Studio and Ollama at their default addresses, the visitor's OpenAI-compatible APIs (`~/.leuria/providers.json`), model discovery (LM Studio's native API for loaded models, Ollama's for cloud models), AI ids `llm:<provider>/<model>` |
| `llm/llm-session.ts` | The engine's own agent loop for LLMs: streams `/chat/completions` with the page tools, runs tool calls through the relay, repeats until the model answers. Same surface as the ACP session |
| `mcp-stdio.ts` | `leuria mcp-stdio`: page tools over stdio, for agents without HTTP MCP (stdio is the transport ACP requires) |
| `policy.ts` | Session options that switch off the agent's own tools; permission handler that refuses anything but `mcp__webmcp__*` |
| `doctor.ts`, `self-test.ts` | Setup checks, and the real round trip behind `leuria test` |

**State:** `~/.leuria/config.json` (port, agent), `grants.json`, `agents/`. Tests override the location with `LEURIA_HOME`.

## SDK (`packages/client`, npm `@leuria/client`)

| File | Role |
| --- | --- |
| `leuria.ts` | `createLeuria`: provider cascade (`select`), state snapshot, `connect`, global middleware and events, close on unload |
| `conversation.ts` | Turns: queue, turn context, timeouts, tool runner (middleware, budget, `endTurn`, tools the visitor answers), structured output routing, provider session switching |
| `run.ts` | `ChatRun`: an async-iterable turn with `text()`, `object()`, `result()` |
| `structured.ts` | `submit_result` tool route and JSON extraction |
| `messages.ts` | Message parts, files, context rendering, transcripts |
| `types.ts` | The contracts: `Provider`, `ProviderSession`, `TurnContext`, messages, events |
| `providers/bridge.ts` | Engine provider: warm sessions, prompt with attachments, cancel grace |
| `providers/browser.ts` | Prompt API provider |
| `providers/server.ts` | OpenAI-compatible Chat Completions with a page-side tool loop |
| `bridge/transport.ts` | Low-level engine client: detect, pair, sessions, SSE and tool channel with reconnects |

**Design rules**
- Tools always run in the page, through `TurnContext.runTool`, whatever the provider. That keeps events, message parts, middleware and budgets identical everywhere.
- The history belongs to the conversation, not to the provider, so a turn can move to a better provider.
- State is immutable snapshots plus `subscribe`, for `useSyncExternalStore` and assistant-ui's external store.
- The page never chooses what runs on the visitor's machine.
