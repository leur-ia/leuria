# The visitor answers

A tool without `execute` waits for your page to answer: here, the visitor confirms an order. This needs an AI that can use tools.

```js leuria-run
import { defineTool } from "@leuria/client"

const placeOrder = defineTool({
  name: "place_order",
  description: "Place an order. The visitor confirms it first.",
  inputSchema: {
    type: "object",
    properties: { product: { type: "string" }, quantity: { type: "integer" } },
    required: ["product", "quantity"],
  },
  // No execute: the call waits for submitToolResult or rejectToolCall.
})

const convo = ai.conversation({ tools: [placeOrder] })
const run = convo.send("Order two celadon mugs for me.", { signal })

for await (const event of run) {
  if (event.type !== "tool-input") continue
  const { product, quantity } = event.args
  if (confirm(`Order ${quantity} × ${product}?`)) convo.submitToolResult(event.callId, { orderId: "A-1024" })
  else convo.rejectToolCall(event.callId, "The visitor cancelled the order.")
}
print((await run.result()).text)
convo.close()
```

## How it works

- The `tool-input` event, and `convo.getState().pendingInputs`, list the calls waiting for the page. In React, render them from the conversation's state.
- `submitToolResult(callId, value)` sends `value` to the AI; `rejectToolCall(callId, reason)` sends an error it can explain.
- Stopping the turn, or its timeout, dismisses the waiting call. See [Page tools](../guides/tools.md).
