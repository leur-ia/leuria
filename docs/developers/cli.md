# Run Leuria from a terminal

People who use Leuria install the [desktop app](https://leuria.eu/download). While you build a site, you can run the same engine from a terminal instead, with `@leuria/cli`:

- to try your site with your own AI, without installing the app;
- in automated tests, on a machine without a screen;
- on Linux, until the desktop app is available there.

It needs [Node.js](https://nodejs.org) 22 or later.

## Start it

```sh
npx @leuria/cli@latest
```

The first run sets everything up and says what is missing. The engine then runs in that window: keep it open while you test, and press Ctrl+C to stop. To have a `leuria` command instead, install it once with `npm i -g @leuria/cli`.

To check that the engine and your AI work before opening your site:

```sh
npx @leuria/cli test
```

It asks your AI a question only a test tool can answer, and checks that your AI can't use tools of its own.

## Choose the AI

The engine uses the same AIs as the app:

- **A model on your computer**, with [LM Studio](https://lmstudio.ai) or [Ollama](https://ollama.com). Start LM Studio's local server or Ollama with a chat model loaded, and the engine finds it.
- **An AI service with a key**: any OpenAI-compatible API.
  ```sh
  npx @leuria/cli providers add <name> <address> --key <key>
  ```
- **An agent** from the [ACP registry](https://agentclientprotocol.com). `npx @leuria/cli agents` lists them. For ChatGPT:
  ```sh
  npx @leuria/cli setup --agent codex-acp
  npx @leuria/cli login
  ```
  The sign-in stays separate from any Codex you already use. Claude Code works once it is installed and signed in (run `claude` once), or with `ANTHROPIC_API_KEY`.

## Connect your site

Click **Connect your AI** on your page. The terminal engine can't receive the `leuria://` link the app uses, so it opens its approval page in your browser instead; if no page opens, the terminal prints a link.

**For development only.** The terminal engine answers every site that asks to connect, so any page can tell it is running. The desktop app stays silent until the visitor clicks Connect on that site. See [Security notes](../security.md).

## Manage sites

```sh
npx @leuria/cli sites                                        # connected sites, last used
npx @leuria/cli sites revoke https://shop.example            # disconnect a site
npx @leuria/cli sites use https://docs.example codex-acp     # this site uses another AI
npx @leuria/cli sites use https://docs.example default       # back to the default AI
```

## Troubleshooting

`npx @leuria/cli doctor` lists each requirement and how to fix what is missing.

| Problem | Fix |
| --- | --- |
| "Port 19570 is in use" | The desktop app or another engine is running. Quit it, or start with `--port <n>` |
| "Claude Code sign-in: not signed in" | Run `claude` and sign in, or set `ANTHROPIC_API_KEY` |
| The site says Leuria is not running | Start the engine, keep the window open, and reload the page |
| The site keeps asking to connect | The browser blocks storage for the site (private window, strict settings) |
| Chrome asks to access devices on your local network | That is the page reaching the engine on your computer: allow it |
| Anything else | `npx @leuria/cli -v` logs every request; `npx @leuria/cli test -v` details a round trip |

## Where it keeps its state

In `~/.leuria` (settings, connected sites, installed agents), shared with the desktop app. To start over, stop the engine and delete that folder.
