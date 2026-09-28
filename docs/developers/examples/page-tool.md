# A page tool

Let the AI call a function of your page, and answer from what it returns. This needs an AI that can use tools, such as your own through Leuria.

```js leuria-run
import { defineTool } from "@leuria/client"

const MUGS = [
  { name: "Celadon", price: 24, stock: 3 },
  { name: "Tenmoku", price: 31, stock: 0 },
  { name: "Shino", price: 19, stock: 12 },
]

const searchMugs = defineTool({
  name: "search_mugs",
  description: "List the mugs for sale: name, price in euros, and how many are in stock.",
  inputSchema: { type: "object", properties: { inStockOnly: { type: "boolean" } } },
  execute: ({ inStockOnly }) => (inStockOnly ? MUGS.filter((m) => m.stock > 0) : MUGS),
})

const run = ai.chat({ prompt: "Which mug in stock is the cheapest?", tools: [searchMugs], signal })
for await (const event of run) {
  if (event.type === "tool-call") print(`→ ${event.name} ${JSON.stringify(event.args)}`)
}
print((await run.result()).text)
```

## How it works

- `execute` runs in the page. The AI sees the tool's name, description and input schema, and gets back what `execute` returns, as JSON. A tool that throws is reported to the AI as an error, so it can try again or explain.
- The AI can't do anything else on the visitor's machine: it only has your page's tools.
- A request with tools only goes to a provider that can use them. See [Page tools](../guides/tools.md).
