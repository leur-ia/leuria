# Leuria documentation

Leuria lets a website offer AI features that run on the visitor's own AI, instead of the site's API keys.

## Build with Leuria

- [Quickstart](developers/quickstart.md): a first AI feature in plain HTML, with a bundler, or in React.
- [The core SDK](developers/sdk.md): how `@leuria/client` fits together, and where to go next.
- [Ask AI for your Docusaurus site](developers/docusaurus.md): an assistant and search by meaning for your docs, on each reader's own AI.
- Guides: [providers and the cascade](developers/guides/providers.md), [conversations](developers/guides/conversations.md), [tools](developers/guides/tools.md), [structured output](developers/guides/structured-output.md), [embeddings and search](developers/guides/embeddings.md), [the Connect UI](developers/guides/connect-ui.md), [React](developers/guides/react.md), [your own provider](developers/guides/custom-providers.md).
- [Going to production](developers/production.md): the cascade to ship, what visitors see, privacy, CSP, tool safety.
- [Examples](developers/examples/index.md): small recipes you can run with your own AI on the portal.
- [Engine protocol](developers/protocol.md): the HTTP, SSE and WebSocket API between pages and the engine, for writing another client.

## Use Leuria

- [Getting started](users/getting-started.md): install, connect a site, manage sites, troubleshooting, privacy.

## Security

- [Security notes](security.md): what Leuria protects against today, and the known gaps.

## Contribute

- [Architecture](contributing/architecture.md): how the engine and the SDK are organized.
- [Development](contributing/development.md): setup, tests, the fake agent, running with a real agent.
