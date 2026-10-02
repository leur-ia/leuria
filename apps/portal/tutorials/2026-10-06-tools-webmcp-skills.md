---
slug: tools-webmcp-skills
title: "Page tools, WebMCP and agent skills for every AI"
sidebar_label: Tools, WebMCP and skills
description: "Write page tools once: the visitor's own AI uses them through Leuria, the browser's agents through WebMCP. Then guide the AI with agent skills."
keywords: [webmcp, webmcp tutorial, navigator.modelContext, document.modelContext, ai page tools, function calling in the browser, agent skills, SKILL.md, well-known agent-skills, ai agents website, bring your own ai]
authors: [jb]
tags: [webmcp, tools, agent-skills]
date: 2026-10-06T11:00:00Z
---

AI on a website is more than a chat box when the AI can act on the page: search the catalog, fill the form, open the right doc. This tutorial writes those actions once, as page tools, and offers them to two kinds of AI: the visitor's own AI through Leuria, and the agents built into the browser through WebMCP. Then it adds agent skills, so the AI knows how your site works.

<!-- truncate -->

**In short:** define tools with `defineTool`. Pass them to `ai.chat()` or a conversation for the visitor's AI, and to `exposeTools()` for the browser's agents. Add `skills` to `leuria()` to give the visitor's AI your site's know-how.

## Step 1: define a tool

A tool is a name, a description, a JSON Schema for its arguments, and a function that runs in the page:

```ts
import { defineTool } from "@leuria/client"

export const searchProducts = defineTool<{ query: string }>({
  name: "search_products",
  description: "Search the catalog. Returns name, price in euros and stock.",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  annotations: { readOnlyHint: true },
  execute: ({ query }, { signal }) => catalog.search(query, { signal }),
})

export const addToCart = defineTool<{ sku: string; quantity: number }>({
  name: "add_to_cart",
  description: "Add a product to the visitor's cart.",
  inputSchema: {
    type: "object",
    properties: { sku: { type: "string" }, quantity: { type: "integer", minimum: 1 } },
    required: ["sku", "quantity"],
  },
  annotations: { consequentialHint: true },
  execute: ({ sku, quantity }) => cart.add(sku, quantity),
})
```

The AI never runs code of its own on your page. It asks for a tool call, your function runs with the page's rights, and the AI sees only what it returns. Validate arguments as you would a form.

## Step 2: the visitor's own AI uses them

```ts
import { createAI, leuria, promptAPI } from "@leuria/client"

const ai = createAI({
  providers: [leuria({ app: "Kiln & Co.", needs: { tools: true, effort: "standard" } }), promptAPI()],
})

const chat = ai.conversation({
  system: "You are the shop's assistant. Use the tools; never invent a product.",
  tools: [searchProducts, addToCart],
})

await chat.send("Add two of your cheapest blue mugs to my cart").result()
```

The visitor's AI (ChatGPT, Claude, an Ollama or LM Studio model) gets these tools and only these: through Leuria it runs with its own tools off, in an empty folder.

### Ask before anything that matters

Leave out `execute`, and the call waits for your UI. The visitor confirms, then you answer the call:

```ts
const placeOrder = defineTool<{ total: number }>({
  name: "place_order",
  description: "Place the order. The visitor confirms first.",
  inputSchema: { type: "object", properties: { total: { type: "number" } }, required: ["total"] },
})

chat.subscribe(() => {
  for (const input of chat.getState().pendingInputs)
    confirmDialog(input.args, (ok) => (ok ? chat.submitToolResult(input.callId, { placed: true }) : chat.rejectToolCall(input.callId)))
})
```

## Step 3: the browser's agents use them too (WebMCP)

WebMCP lets a page offer tools to the agent built into the browser. The same tool objects work there:

```ts
import { exposeTools } from "@leuria/client"

const takeBack = exposeTools([searchProducts, addToCart])
// later, to withdraw them: takeBack()
```

- Where the browser has no WebMCP, nothing happens.
- The `annotations` tell the browser's agent which tools only read (`readOnlyHint`), which do something that matters (`consequentialHint`), and which return text you don't control (`untrustedContentHint`).
- Tools without `execute` are left out: they need your UI.
- In React: `useExposedTools(tools)` from `@leuria/react`.

To try it, Chrome ships WebMCP behind `chrome://flags/#enable-webmcp-testing`, and to sites through an origin trial from Chrome 149.

On Docusaurus, the [Ask AI plugin](/tutorials/docusaurus-ask-ai) already offers its docs tools through WebMCP (`webmcp: true` by default).

## Step 4: guide the AI with skills

Tools say what the AI can do. Skills say how your site works: how returns go, what to ask first, which tool to call when. A skill is a folder with a `SKILL.md`, in the [Agent Skills](https://agentskills.io) format:

```markdown title="static/.well-known/agent-skills/returns/SKILL.md"
---
name: returns
description: "How to prepare a return request, from the order number to the label."
---

Ask for the order number, then call `find_order`. Returns are free within 30 days.
```

Then list your skills in `.well-known/agent-skills/index.json` (see the [discovery index](https://agentskills.io)), and pass them to `leuria()`:

```ts
leuria({
  app: "Kiln & Co.",
  skills: [
    "/",                                                       // your own, from /.well-known/agent-skills
    "vercel-labs/agent-skills@web-design-guidelines#9f2c1e4",  // a shared skill, pinned to a commit
  ],
})
```

On Docusaurus: `["@leuria/docusaurus", { skills: ["/"] }]`.

What happens next:

- When your site asks to connect, Leuria fetches the skills and shows them to the visitor ("This site uses 2 skills to guide your AI", with **See details**).
- The AI gets each skill's name and description, and a `read_skill` tool to read the full instructions when a request matches. Long skills cost nothing until they're needed.
- Pin shared skills to a commit (`#<sha>`): a branch can change under you.

Skills only reach the visitor's own AI, through Leuria. For the browser's model and your server, put what they need in `system`.

## Which AI gets what

| | Visitor's AI (Leuria) | Browser's agent (WebMCP) | Browser's model | Your server |
| --- | --- | --- | --- | --- |
| Page tools | yes | yes, through `exposeTools` | with `promptAPI({ tools: true })` | yes |
| Tools the visitor answers | yes | no | no | yes |
| Skills | yes | no | no | no |
| Cost to you | none | none | none | per request |

## FAQ

**What's the difference between WebMCP and MCP?**
MCP connects an AI to tools on a server. WebMCP lets a web page offer tools to an AI in the browser, running in the page with the visitor's session.

**Can the AI call my tools with any arguments?**
Yes. Treat arguments as untrusted input. Take the account or the page from the turn's context (`send(text, { context })`), never from the model's arguments.

**Do skills give the AI new permissions?**
No. Skills are instructions. The AI can still only call your page's tools.

## Next

- [Page tools](/docs/developers/guides/tools): middleware, terminal tools, limits.
- [Skills](/docs/developers/guides/skills): refs, the discovery index, caching.
- [Tool builder](/tool-builder): write a tool's schema in the browser.

*Written for `@leuria/client` 0.1.4.*
