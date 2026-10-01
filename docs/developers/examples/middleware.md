# Middleware

Wrap every tool call: log it, block it, or change what the AI gets back. This needs an AI that can use tools.

```js leuria-run
import { defineTool } from "@leuria/client"

const findCustomer = defineTool({
  name: "find_customer",
  description: "Find a customer by name. Returns their name, city and email.",
  inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  execute: ({ name }) => ({ name, city: "Lyon", email: "ada@example.com" }),
})

// Logs each call, and hides email addresses from the AI.
const redact = async (call, next) => {
  print(`→ ${call.name} ${JSON.stringify(call.args)}`)
  const outcome = await next()
  if (!outcome.ok) return outcome
  const clean = JSON.parse(JSON.stringify(outcome.result).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[hidden]"))
  return { ok: true, result: clean }
}

const answer = await ai.chat({
  prompt: "Where does Ada live, and what is her email?",
  tools: [findCustomer],
  middleware: [redact],
  signal,
}).text()
print(answer)
```

## How it works

- A middleware gets the call (`name`, `args`, `callId`, the turn's `context`) and `next()`, which runs the tool. It returns `{ ok: true, result }` or `{ ok: false, error }`.
- Put it on one request or conversation (`middleware`), or on every call of the page (`createAI({ middleware })`); the page-wide layers run first.
- Use it for audit logs, to block a call in some state, or to mark text you don't control as data, not instructions. See [Page tools](../guides/tools.md).
