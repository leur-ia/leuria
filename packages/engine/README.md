# leuria

The Leuria engine: lets websites you approve use the AI on your computer (Claude Code today) through tools their page provides. The agent can't read your files or run commands.

```sh
npx @leuria/cli@latest          # set up on first run, then keep running
npx @leuria/cli doctor          # what's missing, and how to fix it
npx @leuria/cli test            # real round trip with your agent
npx @leuria/cli sites           # connected sites; `sites revoke <origin>` to disconnect
```

Needs Node.js 22+ and Claude Code, signed in (or `ANTHROPIC_API_KEY`). State lives in `~/.leuria`.

For developers: run the engine without the app, to test a site, in CI, or on Windows and Linux. People who use Leuria install the app from https://leuria.eu. Guide: https://leuria.dev/docs/developers/cli. The protocol, the browser SDK (`@leuria/client`) and security notes are in the same repository. Apache-2.0.
