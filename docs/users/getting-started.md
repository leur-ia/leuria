# Use your own AI on websites

Leuria lets websites you approve use your own AI: ChatGPT (through Codex) or Claude Code. The website pays nothing, and you decide which sites may use your AI.

## What you need

- A Mac or a Linux computer. Windows is not tested yet.
- [Node.js](https://nodejs.org) 22 or later.
- An AI. Leuria works with:
  - **A model on this computer**, with [LM Studio](https://lmstudio.ai) or [Ollama](https://ollama.com): private and free. Start LM Studio's local server or Ollama, download a chat model, and Leuria finds it.
  - **An AI service with your key**: any OpenAI-compatible API (your OpenAI key, a company gateway…). Add it in the app ("Another AI service") or with `npx @leuria/cli providers add <name> <address> --key <key>`.
  - **An agent** from the [ACP registry](https://agentclientprotocol.com); list them with `npx @leuria/cli agents`. For example:
  - **ChatGPT:** run `npx @leuria/cli setup --agent codex-acp`, then `npx @leuria/cli login` to sign in in your browser. Leuria keeps this sign-in separate from any Codex you already use.
  - **Claude Code:** installed and signed in (run `claude` once). An `ANTHROPIC_API_KEY` works too.

## Start Leuria

```sh
npx @leuria/cli@latest
```

The first run sets everything up and tells you if something is missing. Then Leuria runs in that window. Keep the window open while you use Leuria sites, and press Ctrl+C to stop.

To check that everything works before visiting a site:

```sh
npx @leuria/cli test
```

This asks your AI a question that only a test tool can answer, and checks that your AI can't use tools of its own.

## Connect a site

When a site offers **Connect your AI**, click it. The first time, your browser asks whether to open Leuria: say yes (you can tick "always allow" for that site). Leuria then asks you in its own window, which shows:

- the site's address;
- what the site can do: talk to your AI, through tools its own page provides;
- what it can't do: read your files or run commands.

Click **Allow** or **Don't allow**. Your browser may also ask once whether the site may reach devices on your computer (local network access): allow it, or the site can't talk to Leuria.

With `npx @leuria/cli` instead of the desktop app, Leuria opens this question as a page in your browser. If no page opens, the terminal prints a link to open instead.

A site you haven't connected can't tell whether you have Leuria: the desktop app doesn't answer it until you click **Connect your AI** on it.

## What a connected site can and can't do

| It can | It can't |
| --- | --- |
| Send prompts to your AI and show the answers | Read your files, run commands, or use your AI's own tools |
| Let your AI use tools that run in its own page, such as searching its products | Choose which AI or which program runs on your computer |
| Keep up to 4 conversations open at once | See other sites' conversations |

Your AI runs in an empty temporary folder for each conversation, and the folder is deleted afterwards.

## Manage sites

```sh
npx @leuria/cli sites                       # connected sites and when they were last used
npx @leuria/cli sites revoke https://shop.example   # disconnect a site and end its conversations
```

A disconnected site has to ask you again.

**One AI per site, if you want.** Your default AI answers every site. To use another one for a particular site, pick it next to the site in the Leuria app (on the site, **Connect your AI** → **Change AI or model…** opens it there), or:

```sh
npx @leuria/cli sites use https://docs.example codex-acp   # this site uses Codex
npx @leuria/cli sites use https://docs.example default     # back to your default AI
```

**Leuria's recommendation.** A site can say what its features need: quick tasks, its own tools… Leuria then marks the cheapest of your AIs that is enough as **Recommended for this site**, and models stronger than needed as **More than this site needs**: they would use more of your plan for nothing. Click **Use it** to take the recommendation, or keep your choice.

## Troubleshooting

Start with `npx @leuria/cli doctor`: it lists each requirement and how to fix what is missing.

| Problem | Fix |
| --- | --- |
| "Port 19570 is in use" | Leuria is probably already running in another window. Check with `npx @leuria/cli doctor`, or start with `--port <n>` |
| "Claude Code sign-in: not signed in" | Run `claude` and sign in, or set `ANTHROPIC_API_KEY` |
| The site says Leuria is not running | Start `npx @leuria/cli` and keep the window open, then reload the site |
| The site keeps asking to connect | Your browser may block storage for that site (private window, strict settings), so the site can't keep its connection |
| Chrome asks to allow access to devices on your local network | That is Chrome asking whether the site may reach Leuria on your computer. Allow it for sites you connect |
| Something else | Run `npx @leuria/cli -v` to see every request, and `npx @leuria/cli test -v` for a detailed round trip |

## Privacy

- **Where your data goes.** Your prompts and the site's tool results go from the page to Leuria and then to your AI, over your own computer. With Claude Code, your AI sends them to Anthropic under your own account, as it does when you use Claude Code directly.
- **What Leuria keeps.** Nothing about your conversations. It stores only the list of connected sites, in `~/.leuria`.
- **Telemetry.** Leuria sends none.

## Uninstall

Stop Leuria, then delete its folder:

```sh
rm -rf ~/.leuria
```
