# Security notes (R1)

This is the working threat model. Every website is untrusted until the visitor allows it, and even then it only reaches an agent that can do nothing but call that page's tools.

## What R0 does

| Risk | Mitigation | Where |
| --- | --- | --- |
| A site detects that Leuria is installed (fingerprinting) | With the desktop app, the engine gives a site it doesn't know no readable answer on any route, `/health` and preflights included: an empty `403` without CORS headers, which the browser reports like a closed port. It answers a site only once the visitor connected it, or once a `leuria://connect` link, opened from the visitor's click, names it. The admin API answers only the app's own webview. The SDK sends nothing to the engine before the site has a token | `server.ts`, `transport.ts` |
| A site uses the engine uninvited | Every route but `/connect/claim` needs the origin's grant token. WebSocket upgrades need a grant for the origin | `server.ts` |
| A site pairs itself without the visitor | Only the visitor's click creates a grant: in the desktop app's own window, or (CLI) on the engine's page, checked by its `Origin` and never framed (`X-Frame-Options: DENY`, `frame-ancestors 'none'`) | `pairing.ts`, `apps/desktop` |
| A site forges a link for another site | The token goes only to the origin the link names (the browser sets `Origin`), and only to the claim with the link's secret nonce, which the forger can't send from that origin and the named site never saw. A retry replaces the nonce: only the latest claim is answered | `pairing.ts` |
| A site steals another site's token | The token goes only to the origin that was asked about, only once | `pairing.ts` |
| A site nags the visitor with prompts | One question per site at a time (a new link updates it); after a No, the site can't ask again for 30 s; at most 20 questions pending | `pairing.ts` |
| DNS rebinding | Loopback bind plus a `Host` check | `server.ts` |
| A site picks the command to run | `prepare` ignores `agent` and `agentArgs`. The agent comes from the visitor's config | `routes.ts`, `agents.ts` |
| The agent uses the visitor's machine (Claude) | No built-in tools, no settings or plugins, and an empty temporary folder. Permission requests for anything but page tools are refused | `policy.ts` |
| The agent uses the visitor's machine (Codex) | Leuria's own `CODEX_HOME` holding only the sign-in and a generated config. That config sets a read-only sandbox (on Windows, Codex's sandbox that needs no administrator rights) and no web search, and turns off every feature of the pinned version except the code-mode host. `HOME` points at the empty sandbox, and the page tools are the only MCP server | `codex.ts` |
| A site reads another site's sessions | Sessions are keyed by origin; other origins get `404` | `routes.ts` |
| A site spawns agents in a loop | At most 4 live sessions per origin | `session-manager.ts` |
| Token theft from disk | Only SHA-256 hashes are stored, in files readable by the user only | `grants.ts`, `home.ts` |
| A site points the engine at the visitor's network through its skills | Skill refs are fetched only from GitHub (through its API) or the site's own origin. A site on the internet whose name resolves to a loopback, private or other non-public address is refused; redirects are refused. Downloads are size- and time-capped | `skill-sources.ts` |
| A site's skills run code | Only text files are kept; scripts and binaries are dropped. Skills reach the agent as text through `read_skill`, and the agent still has only the page's tools | `skill-sources.ts`, `skills.ts` |
| A site's skills reach another site | Each grant keeps its own list; a session gets only its origin's skills. The cache is shared by content, but only the grant says which entries a site may use | `skills.ts` |
| Adapter supply chain | The adapter version is pinned and installed into `~/.leuria/agents`, not fetched with `npx` on each session | `agents.ts` |

`leuria test` checks each agent against the policy with the real model. It asks the agent to list and read files in the home folder "with any tool you have". The test fails if any tool other than a page tool runs, or if the answer contains entries of the real home folder.

**Why Codex needs isolation rather than options:** Codex 0.156 ships about 150 feature flags, including a shell, unified exec, browser and computer use, plugins, apps, subagents, hooks, memories and skills discovered from the user's home. In `read-only` mode it still ran `ls ~` without asking. Leuria therefore starts from "everything off" for the pinned version. It regenerates the config when the pinned version changes, and a new version is only pinned after `leuria test` passes.

## Known gaps

- **Fingerprinting with the CLI.** The CLI engine (`npx @leuria/cli`, for developers) can't receive `leuria://` links, so it answers every origin's claim, and a site can tell it runs. The desktop app, which visitors use, is silent.
- **Timing and port probes.** A page can still time a request to the loopback port. Chrome's local network access permission, which asks the visitor, now stands in front of that; the SDK makes no such request before the visitor clicks Connect.
- **Skills from a branch.** A ref without a commit follows the branch as it was when Leuria fetched it; whoever controls that repository controls what the site tells the AI. The guide says to pin shared skills to a commit. DNS is checked before fetching a site's skills, not at connection time, so a fast DNS rebind remains possible (a page in the browser has the same reach).
- **Spending.** There are no per-site rate limits or spending caps yet, and no audit log beyond `-v` output.
- **Plain HTTP sites.** They can pair. The approval page warns when a non-local site doesn't use HTTPS, but on such a site the token can be read by anyone on the network path.
- **Agent environment.** The agent inherits the visitor's environment variables. It can't run tools, but it could print a variable in its answer if a site's prompt asked for it. To do: pass an allow-list of environment variables.
- **Other registry agents** (anything but `claude-acp` and `codex-acp`) get what ACP offers: client file and terminal access off, an empty working folder, and permission requests refused unless they are for page tools. What an agent does with its own built-in tools is up to that agent. Run `leuria test` before relying on one: it fails when a non-page tool runs.
- **Codex tool approval** is pre-granted for page tools, because Codex's own approval prompt cannot reach the visitor through ACP. Site-level consent (pairing) is the approval.
- **Claude subscriptions.** Running Claude Code for a website with a Pro or Max login is an open question in the design doc. The API-key route (`ANTHROPIC_API_KEY`) is always fine.
