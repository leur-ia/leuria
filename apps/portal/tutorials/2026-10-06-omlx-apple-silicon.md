---
slug: omlx-apple-silicon
title: "Run oMLX models on websites, on Apple Silicon"
sidebar_label: Leuria × oMLX
description: "Use oMLX, the MLX model server for Apple Silicon, to answer on the websites you allow, on your Mac. Plus oMLX as a site's own fallback AI."
keywords: [omlx, mlx server, mlx openai compatible, apple silicon llm, mac local llm website, mlx-lm server, local ai mac, m4 llm, bring your own ai]
authors: [jb]
tags: [omlx, apple-silicon, local-ai]
date: 2026-10-06T12:00:00Z
---

[oMLX](https://github.com/jundot/omlx) serves MLX models on Apple Silicon through an OpenAI-compatible API, from a menu bar app. Add it to Leuria once, and the websites you allow can use your oMLX model for their AI features, on your Mac.

<!-- truncate -->

**In short:** start oMLX (it listens on `http://localhost:8000/v1`), then in Leuria add it as a service with that address. Sites you allow then answer with your MLX model.

## Why MLX for this

MLX runs models on the Mac's unified memory and GPU, and is often the fastest way to run a model on an M-series Mac. oMLX adds what a website's AI features need: streaming, tool calling, and continuous batching, so two sites can ask at once.

## Part 1: start oMLX

Install the app from [oMLX's releases](https://github.com/jundot/omlx/releases), or with Homebrew:

```sh
brew tap jundot/omlx https://github.com/jundot/omlx
brew install jundot/omlx/omlx
```

Start the server with a folder of MLX models:

```sh
omlx serve --model-dir ~/models
```

Or start it from the menu bar app. Download a model from its dashboard (`http://localhost:8000/admin`). For sites with tools, pick one trained for tool calling, such as a Qwen 3 MLX build.

Check that it answers:

```sh
curl http://localhost:8000/v1/models
```

oMLX needs macOS 15 or later on Apple Silicon.

## Part 2: add oMLX to Leuria

Install Leuria from [leuria.eu/download](https://leuria.eu/download), or:

```sh
brew tap leur-ia/leuria https://github.com/leur-ia/leuria
brew install --cask leuria
```

Then open Leuria:

1. **Add an AI** → **An AI service with a key**.
2. **Service**: **Another service (your company's AI…)**.
3. **Name**: `oMLX`. **Address**: `http://localhost:8000/v1`. Leave **API key** empty, unless you set one in oMLX.
4. **Connect this service**, then pick a model.

From a terminal instead:

```sh
npx @leuria/cli providers add oMLX http://localhost:8000/v1
```

Leuria lists oMLX with your AI services. You can make it your default, or use it for some sites only.

## Part 3: allow a site

On a site that uses Leuria (try [demo.leuria.dev](https://demo.leuria.dev)), click **Connect your AI** and allow it. Leuria asks oMLX, on your Mac. Nothing leaves it.

## For site builders: oMLX as your site's fallback

A Mac mini running oMLX can also be your site's own AI, for visitors who have none. Put it behind the proxy from the [LiteLLM tutorial](/tutorials/litellm-docs-fallback), never straight on the internet: the proxy holds the key, allows only your site and caps usage. oMLX itself refuses to listen beyond your Mac without an API key.

```ts
server({ url: "https://docs-ai.<you>.workers.dev", model: "<your oMLX model id>", label: "Acme's AI" })
```

Set `model` to the id `curl http://localhost:8000/v1/models` returns.

## Troubleshooting

**"Connected, but this service lists no chat model."**
oMLX found no model in its folder. Download one from its dashboard, or check `--model-dir`.

**Leuria can't reach oMLX.**
Check that `curl http://localhost:8000/v1/models` answers. If you started oMLX on another port, use that port in the address.

**Search by meaning doesn't use my oMLX embedding model.**
Leuria uses embedding models from LM Studio or Ollama. Sites that search by meaning still work by words, or with their own in-page model.

## FAQ

**Is oMLX better than Ollama or LM Studio for this?**
Use the one you already have. Leuria works with all three, and you can switch per site.

**Does it work on Intel Macs?**
No: MLX needs Apple Silicon. Use Ollama or LM Studio there.

## Next

- [Use LM Studio models on any website](/tutorials/lm-studio-websites).
- [Page tools, WebMCP and skills](/tutorials/tools-webmcp-skills): what your site can give the visitor's AI.

*Written for Leuria 0.1.4.*
