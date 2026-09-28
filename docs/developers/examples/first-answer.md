# A first answer

Ask a question and get the text back, from whichever AI this visitor has.

```js leuria-run
const result = await ai.chat({
  system: "Answer in one short sentence.",
  prompt: "Why is the sky blue?",
  signal,
}).result()

print(result.text)
print(`Answered by: ${result.provider.label}`)
```

## How it works

- `ai.chat()` returns a run. `await run.text()` gives the text, `await run.result()` also says which provider answered, and `for await (const event of run)` streams it (`text-delta` events).
- The request goes to the first provider that is ready: the visitor's own AI through Leuria, then the browser's built-in model, then your server if you added one. See [Providers and the cascade](../guides/providers.md).
- `signal` cancels the request; the run rejects with an `AbortError`.
