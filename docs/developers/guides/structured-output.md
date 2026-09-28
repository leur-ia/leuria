# Structured output

How to get JSON that matches a schema back from any provider, parsed and typed.

```ts
const order = await ai.chat({ prompt: freeText, schema: orderSchema, validate: Order.parse }).object()
```

## Schema and validation

- `schema` is a JSON Schema. It works on `ai.chat()` and on a whole conversation (`ai.conversation({ schema })`, for every turn).
- `validate` is optional: a function that returns the typed value, or throws to reject it (for example a zod `parse`).
- `run.object()` resolves with the value. It rejects when the request had no schema.
- The value is also in `result().object` and in the `finish` event.

A request with a schema only goes to a provider that has `structured` or `tools` (see [Providers](providers.md#the-cascade)).

## Two routes

The route depends on the provider:
- **Native.** Providers with native support get the schema: the browser model through `responseConstraint`, the server through `response_format` (with `server({ jsonSchema: true })`). The answer is parsed from the model's text, code fences and surrounding prose tolerated.
- **Tool.** The others (agents) get a `submit_result` tool whose input is the schema, and an instruction to call it once. Models are good at filling tool arguments, and the arguments come back already parsed. When validation fails there, the model sees the error and tries again.

A schema that isn't an object is wrapped as `{ value }` for the tool route and unwrapped for you. `submit_result` is reserved: a page tool can't use that name.

## Errors

`StructuredOutputError` means the model didn't return JSON, or its JSON didn't pass `validate` (native route, or a model that answered in text instead of calling the tool). `error.text` holds what the model wrote.

```ts
try {
  const order = await ai.chat({ prompt, schema, validate: Order.parse }).object()
} catch (error) {
  if (error instanceof StructuredOutputError) console.warn("Not an order:", error.text)
}
```

`extractJson(text)` is exported too: it parses the first JSON value in a text, the same way.
