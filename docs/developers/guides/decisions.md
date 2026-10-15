# Decisions

How to ask typed questions about an input and get a choice, a score or a probability back, from a *System One* model: one that decides without writing text, in well under a second.

```ts
import { choice, noul, score } from "@leuria/client"

const { answers } = await ai.decide(
  { ticket: "My flight was cancelled. Can I get a refund?" },
  {
    refund: noul("Does `ticket` ask for a refund?"),
    kind: choice("What is asked in `ticket`?", { refund: "money back", rebooking: "another flight", info: "a question" }),
    anger: score("How angry is `ticket`?", ["calm", "upset", "furious"]),
  },
)
answers.refund.noul        // 0 (no) to 1 (yes)
answers.kind.choice        // "refund" | "rebooking" | "info", with answers.kind.probabilities and .confidence
answers.anger.score        // 0 to 2, possibly between levels
```

Use it where a chat is too slow, too costly or too free-form: routing a message, sorting or scoring a list, a guardrail before an action, deciding whether something deserves a notification.

## `ai.decide()`

`ai.decide(state, questions, options)` asks the first ready provider that offers `decide`. Today that is the visitor's own model through Leuria: a decision model on their computer (LM Studio and Ollama both serve `nimble`, `tev1`… at `/v1/systemone`), or a service they set up: TypeSafe's [Jev](https://typesafe.ai) with their own key, or any other speaking the same API. The page holds no key and pays nothing.

- `state`: what the questions are about. A string, or an object whose fields the questions name in backticks.
- `questions`: an object of question id → question. Three kinds, with helpers that keep the answer types:
  - `noul(instructions, criteria?)`: yes or no. The answer is `{ noul }`, a probability. `criteria` may describe what `true` and `false` mean.
  - `choice(instructions, criteria)`: one option among `criteria` (option → description, or `null`). The answer is `{ choice, probabilities, confidence }`.
  - `score(instructions, criteria)`: a level on `criteria`, 2 to 10 descriptions from low to high. The answer is `{ score, legend, probabilities, confidence }`.
- `options.model`: a model of the service (its latest by default). Ignored when the visitor decides with a model on their computer: that one is their pick. `options.provider`, `options.signal`: as for chat.

The result is `{ answers, model, provider, usage? }`. With nothing ready, it rejects with `NoProviderError`. A question the service refuses (too many options, a missing field) rejects with its message.

The request and the answers are [System One's own shapes](https://typesafe.ai/docs), passed through: what their documentation says about writing questions applies as it is.

## Who decides

- `ai.getState().decider` is the provider and model `decide()` would use now.
- `ai.getState().decidePending` is a decider ahead of it that needs a click (connect Leuria).

Declare it, so Leuria tells the visitor when they connect: `leuria({ needs: { decide: true } })`. Leuria uses the first decision model found on the visitor's computer, or the one they chose (Your AIs › Decisions): a local model, TypeSafe with their key, another service, or off. The visitor can also give one site its own choice (Websites › the site › Decision model). Without one, `leuria()` has no `decide` capability and the page sees no decider. Where the request goes depends on that choice (their computer, or a service), so `localOnly` does not apply; the provider's `locality` stays `device`.
