# Triage a message

Route a support message without a chat: a decision model answers typed questions with a choice, a score and a probability, in well under a second. This needs a decision model: one on your computer through Leuria (`nimble` or `tev1` in LM Studio or Ollama), or a System One service you set up in Leuria (TypeSafe with your key).

This is the classic Jev example: which team, how frustrated, how urgent, then act on the numbers.

```js leuria-run
import { choice, noul, score } from "@leuria/client"

const message = "Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP."

const { answers, model } = await ai.decide(
  { message },
  {
    department: choice("Which team should handle `message`?", {
      billing: "Payment or subscription issues",
      technical: "Bugs or integration problems",
      sales: "Pricing or account questions",
    }),
    frustration: score("How frustrated does the writer of `message` appear?", [
      "Calm, just stating facts",
      "Frustrated but civil",
      "Very angry, strong language",
    ]),
    is_urgent: noul("`message` conveys urgency or time-sensitivity"),
  },
  { signal },
)

// Numbers your code can act on, not prose to parse.
const { department, frustration, is_urgent } = answers
const queue = is_urgent.noul > 0.7 ? `${department.choice}-urgent` : department.choice
const escalate = frustration.score >= 1.5 || department.confidence < 0.5

print({
  model,
  queue,
  escalate,
  department: `${department.choice} (${Math.round(department.confidence * 100)}% sure)`,
  frustration: `${frustration.score.toFixed(1)} of ${Object.keys(frustration.legend).length - 1}`,
  urgent: `${Math.round(is_urgent.noul * 100)}%`,
})
```

## How it works

- `ai.decide(state, questions)` sends the state and the questions to the first provider that offers `decide`, and returns one answer per question, typed by the question's kind. Questions name fields of `state` in backticks.
- `choice` answers with the most likely option, the probabilities of every option, and a `confidence`; `score` with a level that can fall between two descriptions, and the `legend`; `noul` with a probability.
- The thresholds are yours: `is_urgent.noul > 0.7`, `confidence < 0.5`. Calibrated numbers are what make a decision model worth it over a chat answer.
- Nothing ready: `NoProviderError`, with why. Ask the visitor to connect Leuria, or to load a decision model. See [Decisions](../guides/decisions.md).
