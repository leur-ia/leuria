# Who answers

See which AIs this visitor has, route a request, and handle the case where none can answer.

```js leuria-run
import { NoProviderError } from "@leuria/client"

const state = ai.getState()
for (const provider of state.providers) print(`${provider.label}: ${provider.status}`)
print(`A plain request would go to: ${state.active?.label ?? "nobody yet"}`)

try {
  // Only the browser's built-in model, whatever else is ready.
  const text = await ai.chat({ prompt: "Say hi in three words.", provider: ["browser"], signal }).text()
  print(text)
} catch (error) {
  if (!(error instanceof NoProviderError)) throw error
  for (const reason of error.reasons) print(`${reason.label}: ${reason.reason}`)
  if (error.actionable) print(`A click would fix it: ai.connect("${error.actionable}")`)
}
```

## How it works

- `ai.getState()` lists every provider with its status (`ready`, `needs-action`, `downloading`, `unavailable`…), plus `active` (what answers now) and `pending` (what a click would turn on). `ai.subscribe()` tells you when it changes.
- `provider` picks providers by id, in order. `localOnly: true` skips the ones that run on your side, such as `server()`.
- `NoProviderError` says, per provider, why it couldn't answer. `actionable` names one that `ai.connect()` would fix: call it from a click, since it may open a window. See [Providers and the cascade](../guides/providers.md).
