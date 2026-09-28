# A conversation with context

Keep a conversation going, and bind values to each turn that the AI reads but never sets.

```js leuria-run
const convo = ai.conversation({
  system: "You are the support assistant of a mug shop. Answer in one or two sentences.",
})

// What the page knows about this turn: shown to the AI as data, apart from the question.
const context = { customer: "Ada", plan: "Pro", "Page open": "Orders" }

const first = await convo.send("Which plan am I on?", { context, signal }).text()
print(first)

const second = await convo.send("And what's my name?", { context, signal }).text()
print(second)

print(`${convo.getState().messages.length} messages in the history`)
convo.close()
```

## How it works

- `ai.conversation()` keeps the history, so follow-ups work. With the visitor's own AI, the same agent session answers every turn, so they're fast.
- `context` belongs to the turn, not to the visitor's words: the AI sees it above the question, marked as data. Tools get it as `ctx.context`, so a tool can use the current account without trusting the AI.
- If a better AI becomes ready mid-conversation (the visitor connects theirs), the next turn moves to it with the history. See [Conversations](../guides/conversations.md).
