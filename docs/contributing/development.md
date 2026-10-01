# Development

## Setup

You need Node.js 22+ (see `.nvmrc`) and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm check      # types, both packages, tests included
pnpm test       # unit and integration tests; no real agent needed
pnpm build      # dist/ for both packages
```

## Tests

| Where | What | Agent |
| --- | --- | --- |
| `packages/engine/test/server.test.ts` | Host, origin and token checks, pairing, session ownership, limits, warm start, attachments, thoughts | `test/fixtures/fake-agent.mjs` |
| `packages/engine/test/grants.test.ts`, `policy.test.ts` | Grant storage; the permission policy | none |
| `packages/client/test/core.test.ts`, `turns.test.ts` | Cascade, tools, structured output, conversations, queue, context, `endTurn`, middleware, tools the visitor answers, warm, attachments | scripted providers (`test/helpers.ts`) |
| `packages/client/test/providers.test.ts` | Server provider (mocked `fetch`), browser provider (fake `LanguageModel`), bridge provider against a real engine | fake agent |
| `packages/client/test/bridge-transport.test.ts` | Low-level engine client | fake agent |

**The fake agent** speaks the agent protocol on stdio. It calls the first page tool, and reacts to magic words in the prompt:

| Word | Reaction |
| --- | --- |
| `SUBMIT {json}` | Calls `submit_result` with that JSON |
| `BLOCKS` | Describes the prompt's content blocks |
| `THINK` | Emits a thought |
| `SLOW` | Waits for a cancel |
| `bash` | Asks permission for a built-in tool |

Extend it when a test needs a new agent behavior.

Client tests act as a web page by adding an `Origin` header to Node's `fetch`. Without it the engine treats requests as a local process.

## With a real agent

```sh
pnpm build
LEURIA_HOME=/tmp/leuria-dev node packages/engine/dist/cli.js test    # round trip with your Claude Code
LEURIA_HOME=/tmp/leuria-dev node packages/engine/dist/cli.js -v      # run the engine
```

The demos are in the `leuria-demo` repository, next to this one; they load these packages from source.

Use a throwaway `LEURIA_HOME` so development grants and adapters stay out of your real `~/.leuria`.

To test what a new user gets, pack the engine and run it with `npx`:

```sh
cd packages/engine && pnpm pack --pack-destination /tmp
LEURIA_HOME=/tmp/clean npx -y --package=/tmp/leuria-0.1.0.tgz leuria test
```

## Pairing with the desktop app in development

On macOS, `leuria://connect` links reach only a bundled app that the system knows, not the one `pnpm desktop` runs. So a debug build starts its engine with `--dev-pairing`: a site's claim asks the visitor itself (as with the CLI), and the engine answers every site, so it isn't silent. To try the real deep link, build the app (`pnpm desktop:build`), quit the dev app, and open `apps/desktop/src-tauri/target/release/bundle/macos/Leuria.app`. On Windows the installer registers the links: run the `-setup.exe` from `bundle/nsis/`.

## The developer portal

`apps/portal` is the developer portal: Docusaurus with `@leuria/docusaurus`, reading the Markdown in `docs/`. The API reference is generated from the packages' TSDoc into `apps/portal/api/` (not committed).

```sh
pnpm build            # the portal loads the packages' dist/
pnpm portal           # http://localhost:5180, reloads when docs/ changes
pnpm portal:build     # the static site, in apps/portal/build
```

Pages in `docs/` must still read well on GitHub: plain Markdown, relative links. A ```` ```js leuria-run ```` block becomes a playground on the portal, and `pnpm test` runs every one of them against a fake AI (`apps/portal/test/recipes.test.ts`).

## Changing things

- **Protocol changes:** update [the protocol](../developers/protocol.md), the engine, `bridge/transport.ts`, and a test on each side.
- **A new SDK feature:** document it in its guide under [docs/developers/guides](../developers/sdk.md), with a runnable example when it helps. Keep tools going through `runTool`, and keep state immutable.
- **A new supported agent:** add it to `SUPPORTED_AGENTS` in `agents.ts` with a pinned version and a sign-in check. Check it against `policy.ts` with `leuria test`.
- **Security-relevant changes:** update [security notes](../security.md).

## Commits

Small, focused commits whose messages explain why. CI (`.github/workflows/ci.yml`) runs check, build and test on Ubuntu and macOS, with Node 22 and 24.
