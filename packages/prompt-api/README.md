# @leuria/prompt-api

The [Prompt API](https://github.com/webmachinelearning/prompt-api) (`LanguageModel`) where the browser can't run it, served by the visitor's own AI through [Leuria](https://leuria.eu). Write your feature for the web standard once: where the browser has a built-in model that runs, it answers; elsewhere, the visitor's AI does (ChatGPT, Claude, Mistral or a local model), in any browser.

```ts
import { installPromptAPI } from "@leuria/prompt-api"

await installPromptAPI({ app: "My notes" })

if ((await LanguageModel.availability()) !== "unavailable") {
  // From a click the first time: the visitor approves your site in Leuria.
  const session = await LanguageModel.create({ initialPrompts: [{ role: "system", content: "You are concise." }] })
  console.log(await session.prompt("Summarize this note: …"))
}
```

`installPromptAPI` keeps the browser's own `LanguageModel` wherever it can run (`when: "unavailable"`, the default). Use `when: "missing"` to step in only where the browser has none, or `createLanguageModel()` to get the class without touching the global.

## How the API maps onto Leuria

| Prompt API | With Leuria |
| --- | --- |
| `availability()` | `"available"` once the site is connected, `"downloadable"` before (connecting is the "download"), `"unavailable"` without Leuria |
| `create()` | From a click the first time: Leuria asks the visitor to approve the site. `downloadprogress` reports 0, then 1 |
| `prompt()`, `promptStreaming()` | One session of the visitor's AI per `LanguageModel`; each prompt sends only what's new |
| `tools` | Run in your page, called by the visitor's AI |
| `responseConstraint` | JSON Schema or RegExp, given to the AI and checked; a mismatch goes back to the AI to fix |
| `append()`, `clone()`, `destroy()`, `signal` | Supported |
| Images | Supported when the visitor's AI takes them. Audio is not supported |
| `contextUsage`, `measureContextUsage()` | Estimates (about 4 characters per token) |
| `topK`, `temperature`, `samplingMode` | Accepted and ignored: the visitor's AI sets its own |

Docs: [leuria.dev](https://leuria.dev). Apache-2.0.
