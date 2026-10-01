# The Prompt API, in every browser

Write your AI feature for the web standard, the [Prompt API](https://github.com/webmachinelearning/prompt-api) (`LanguageModel`), and it works for more of your visitors. Where the browser has a built-in model that can run, that model answers. Elsewhere, `@leuria/prompt-api` provides `LanguageModel`, and the visitor's own AI answers through Leuria: ChatGPT, Claude, Mistral or a model on their computer. This covers browsers without a built-in model, and computers that can't run one.

```sh
npm install @leuria/prompt-api
```

```js
import { installPromptAPI } from "@leuria/prompt-api"

await installPromptAPI({ app: "My notes" })

const availability = await LanguageModel.availability()
if (availability !== "unavailable") showSummarizeButton()

// In the button's click handler: the first time, the visitor approves your site in Leuria.
summarizeButton.onclick = async () => {
  const session = await LanguageModel.create({
    initialPrompts: [{ role: "system", content: "You summarize notes in three bullet points." }],
  })
  for await (const chunk of session.promptStreaming(note.text)) output.append(chunk)
}
```

The rest of your code is plain Prompt API: nothing else to learn, and nothing to change if you remove the package later.

Without a bundler:

```html
<script type="module">
  import { installPromptAPI } from "https://cdn.jsdelivr.net/npm/@leuria/prompt-api/+esm"
  await installPromptAPI({ app: "My notes" })
</script>
```

## Who answers

`installPromptAPI()` leaves the browser's own `LanguageModel` in place wherever it can run, even if its model must download first. It steps in only where there is none, or where `availability()` says `"unavailable"`. The `when` option changes this:

| `when` | Leuria provides `LanguageModel` |
| --- | --- |
| `"unavailable"` (default) | Where the browser has none, or has one that can't run on this device |
| `"missing"` | Only where the browser has none |
| `"always"` | Always, in place of the browser's |

It resolves with `"browser"` or `"leuria"`, if you want to know. To get the class without touching the global, use `createLanguageModel(options)`.

## How the API behaves with Leuria

| Prompt API | With Leuria |
| --- | --- |
| `availability()` | `"available"` once your site is connected, `"downloadable"` before, `"unavailable"` when the visitor has no Leuria |
| `create()` | Connecting is the "download": call it from a click the first time. Leuria asks the visitor to approve your site, and `monitor` gets `downloadprogress` 0, then 1. Without a click, it rejects with `NotAllowedError` |
| `prompt()`, `promptStreaming()` | Each `LanguageModel` is one session of the visitor's AI, which keeps the context: a prompt sends only what's new. Prompts run one after the other |
| `initialPrompts` | The system message becomes the AI's instructions; the others are the conversation so far |
| `tools` | Your tools' `execute` functions run in your page, called by the visitor's AI with the arguments object |
| `responseConstraint` | A JSON Schema or a RegExp. The AI gets it as an instruction and the answer is checked; an answer that doesn't match goes back to the AI to fix, twice at most, and then the prompt rejects |
| `append()`, `clone()`, `destroy()` | Supported. `destroy()` ends the AI session, and so does leaving the page |
| `signal` | Cancels the prompt at once; the AI stops its turn |
| Images | Accepted when the visitor's AI takes them (`expectedInputs: [{ type: "image" }]`) |
| Audio | Not supported: `availability()` says `"unavailable"` |
| `contextUsage`, `contextWindow`, `measureContextUsage()` | Estimates, about 4 characters per token. The visitor's AI manages its own context, so `contextoverflow` never fires |
| `topK`, `temperature`, `samplingMode` | Accepted and ignored: the visitor's AI uses its own settings |

The first prompt of a session takes a few seconds while the visitor's AI starts; later ones answer at once. Create the session when the feature opens, not at the last moment.

## Options

`installPromptAPI(options)` and `createLanguageModel(options)` take:

| Option | Default | What |
| --- | --- | --- |
| `app` | none | The name Leuria shows when the visitor connects your site |
| `needs` | none | What your features need (`tools`, `images`, `effort`, `context`), so Leuria recommends an AI and model that fit. See [Providers](guides/providers.md) |
| `skills` | none | Skills that guide the visitor's AI on your site. See [Skills](guides/skills.md) |
| `system` | built in | Instructions for the AI when your page gives no system message |
| `maxSteps` | 20 | Most tool calls per prompt |
| `retries` | 2 | How many times an answer that misses the `responseConstraint` goes back to the AI |
| `provider` | `leuria()` | Another provider from `@leuria/client`, e.g. `server({ url })` |

## The Prompt API or the SDK?

Both reach the same AI. Pick by how you want to write your feature:

- **The Prompt API** (`@leuria/prompt-api`): your code is the web standard, and the browser's own model answers where it can. Good for features already written for Chrome's built-in AI, and for code you want to keep free of any library.
- **The SDK** (`@leuria/client`, see the [Quickstart](quickstart.md)): one client over several AIs in the order you choose, including your server as a fallback. It adds conversations that survive a change of AI, tool middleware, turn context, structured output with validation, embeddings, and the Connect UI.

A page that uses both doesn't count the visitor's AI twice: `promptAPI()` in the SDK ignores the `LanguageModel` that `@leuria/prompt-api` installs.
