# Structured output

Turn free text into an object your code can use.

```js leuria-run
const order = await ai.chat({
  prompt: "Two celadon mugs and one tenmoku bowl, delivered to Lyon please.",
  schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { product: { type: "string" }, quantity: { type: "integer" } },
          required: ["product", "quantity"],
        },
      },
      city: { type: "string" },
    },
    required: ["items", "city"],
  },
  signal,
}).object()

print(order)
```

## How it works

- `schema` is a JSON Schema; `.object()` returns the parsed result.
- Add `validate` (for example a zod `parse`) to check and type the result. When the check fails with an AI that uses tools, it sees the error and tries again.
- Providers with native support get the schema directly (the browser's model, or your server with `jsonSchema: true`). Others return it through a `submit_result` tool. See [Structured output](../guides/structured-output.md).
