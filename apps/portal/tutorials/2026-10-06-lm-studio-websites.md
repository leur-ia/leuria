---
slug: lm-studio-websites
title: "Use LM Studio models on any website, without CORS"
sidebar_label: Leuria × LM Studio
description: "Let websites use the model in LM Studio on the visitor's computer, with their consent: no Enable CORS switch, no API key, no cost to the site."
keywords: [lm studio website, lm studio web app, lm studio cors, lm studio local server, lm studio api javascript, local llm in browser, lms server start, lm studio tool calling, bring your own ai]
authors: [jb]
tags: [lm-studio, local-ai, tools]
date: 2026-10-06T13:00:00Z
---

LM Studio users have capable models loaded on their own machine. With Leuria, those models can answer on your website, with your page's tools, at no cost to you. The visitor allows your site once. Nobody turns on CORS or exposes LM Studio's server.

<!-- truncate -->

**In short:** add Leuria to your site. A visitor with LM Studio starts its local server, installs the Leuria app and picks a model. Your AI features then run on that model, on their computer.

## Why not call LM Studio from the page?

You could turn on **Enable CORS** in LM Studio and `fetch("http://localhost:1234/v1/chat/completions")` from your page. It works on your machine. For real visitors:

- each one has to find that switch, and then **every** page they open can use their model, without asking;
- visitors who use Ollama, ChatGPT or Claude get nothing.

With Leuria, the browser never calls LM Studio. The Leuria app does, from the same computer, for the sites the visitor allowed, with only the tools your page offers. LM Studio's settings stay as they are.

## Part 1, for site builders

Add Leuria to your page. With a bundler:

```sh
npm install @leuria/client @leuria/connect
```

```ts
import { createAI, leuria, promptAPI, defineTool } from "@leuria/client"
import { setDefaultClient } from "@leuria/connect" // defines <leuria-connect-button>

const ai = createAI({
  providers: [
    leuria({ app: "Recipe box", needs: { tools: true, effort: "light" } }),
    promptAPI(),
  ],
})
setDefaultClient(ai)

const findRecipes = defineTool<{ ingredient: string }>({
  name: "find_recipes",
  description: "Find recipes that use an ingredient. Returns titles and links.",
  inputSchema: { type: "object", properties: { ingredient: { type: "string" } }, required: ["ingredient"] },
  execute: ({ ingredient }) => recipes.filter((r) => r.ingredients.includes(ingredient)),
})

const answer = await ai.chat({ prompt: "What can I cook with leeks?", tools: [findRecipes] }).text()
```

Put `<leuria-connect-button></leuria-connect-button>` in your page. Without a bundler, the [Ollama tutorial](/tutorials/ollama-web-app#part-1-for-site-builders-add-leuria-to-your-page) has a one-file version from a CDN.

### Say what your feature needs

`needs` matters more with LM Studio than anywhere else. Leuria reads what LM Studio reports about each model (loaded or not, trained for tool use, reads images, context length, size) and recommends the smallest one that fits your site. A visitor with a 70B model and a 4B model loaded gets the 4B one recommended for a light task, and their machine stays responsive.

- `tools: true` if your feature uses tools.
- `effort`: `light` (answer, extract, summarize), `standard` (several steps with tools), `deep` (long reasoning).

See [Declare what your features need](/docs/developers/guides/providers#declare-what-your-features-need).

## Part 2, for LM Studio users

### 1. Start LM Studio's local server

In LM Studio, open the **Developer** tab and start the server. Or from a terminal:

```sh
lms server start
```

Leave the port at 1234. Download a chat model if you have none yet: for sites with tools, one trained for tool use (LM Studio marks them).

### 2. Install Leuria

From [leuria.eu/download](https://leuria.eu/download) (Mac and Windows), or with Homebrew:

```sh
brew tap leur-ia/leuria https://github.com/leur-ia/leuria
brew install --cask leuria
```

### 3. Choose your LM Studio model

Open Leuria, **Add an AI**, **A model on this computer**. Leuria lists your LM Studio models and suggests one that is already loaded. Pick one. When a site asks, Leuria shows which model it recommends for that site, and why.

### 4. Allow a site

On a site that uses Leuria (try [demo.leuria.dev](https://demo.leuria.dev)), click **Connect your AI** and allow it in Leuria's window.

## Search by meaning with an LM Studio embedding model

Download an embedding model in LM Studio (for example a `nomic-embed-text` build). Leuria finds it, and sites that search by meaning use it on your computer. Embeddings only ever use a model on your computer.

## Troubleshooting

**Leuria says "No model found on this computer".**
LM Studio's server isn't running. Start it in the Developer tab or with `lms server start`, then click **Look again**.

**Do I need to turn on "Enable CORS" or "Serve on local network"?**
No. Leuria calls LM Studio from the same computer, at `127.0.0.1:1234`.

**LM Studio runs on another port or another machine.**
Add it as a service: **Add an AI** → **An AI service with a key** → **Another service**, with its address (`http://<host>:<port>/v1`).

**The first answer is slow.**
The model is loading. Leuria prefers models that are already loaded: load the one you use most in LM Studio.

## FAQ

**Does anything leave my computer?**
No. The page sends the question to Leuria, Leuria to LM Studio, both on your computer.

**Can sites use my model without asking?**
No. Each site must ask, and you allow it in Leuria's own window. You can disconnect it at any time.

**Can I use a different model per site?**
Yes. In Leuria's Websites tab, change the AI for one site.

## Next

- [Use Ollama in a web app, without CORS or API keys](/tutorials/ollama-web-app).
- [Run oMLX models on websites, on Apple Silicon](/tutorials/omlx-apple-silicon).
- [Page tools](/docs/developers/guides/tools).

*Written for Leuria 0.1.4 and `@leuria/client` 0.1.4.*
