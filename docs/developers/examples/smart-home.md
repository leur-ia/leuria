# A smart home that decides first

A command for the house goes through a decision model before anything writes text. One call asks every question at once, speculatively: which kind of request, which rooms, which devices, which action, and whether it is really several requests. Code filters what doesn't apply. A chat model only steps in for the two things a decision model can't do: split a compound request, or answer a question in words.

This is TypeSafe's [smart home demo](https://docs.typesafe.ai/demos/smart-home), in a page. It needs a decision model (through Leuria) and, for the chat parts, any AI.

The same logic as a complete site, with rooms, devices and a Connect button, is the Hearth demo in the [demo repo](https://github.com/leur-ia/demo) (`home/`).

```js leuria-run
import { choice, noul } from "@leuria/client"

// The house, as the page knows it. Every action below only edits this.
const house = {
  lights: { kitchen: "on", living: "on", bedroom: "off" },
  thermostat: { living: 19, bedroom: 18 },
  blinds: { living: "open", bedroom: "open" },
}

// Every question, asked at once. Most won't apply: that's the point.
const questions = (request) => ({
  category: choice("What kind of request is `request`?", {
    command: "Do something with a device: lights, heating, blinds",
    status: "Ask about the state of a device",
    conversation: "A question or remark about anything else",
  }),
  compound: noul("`request` asks for more than one action, on different devices or rooms"),
  rooms: choice("Which rooms does `request` concern?", {
    all: "The whole house, or no room named",
    kitchen: "The kitchen",
    living: "The living room",
    bedroom: "The bedroom",
  }),
  device: choice("Which device does `request` concern?", {
    lights: "Lights, lamps",
    thermostat: "Heating, temperature",
    blinds: "Blinds, shutters, curtains",
  }),
  action: choice("What should happen, if `request` is a command?", {
    on: "Turn on, open, raise, warmer",
    off: "Turn off, close, lower, colder",
  }),
})

// One decision, then plain code.
async function handle(request, { split = true } = {}) {
  const { answers } = await ai.decide({ request }, questions(request), { signal })
  const { category, compound, rooms, device, action } = answers

  if (category.choice === "conversation") {
    // Words need a chat model; the decision above cost almost nothing.
    return ai.chat({ prompt: request, system: "You are a brief home assistant.", signal }).text()
  }
  if (split && compound.noul > 0.6) {
    // Several actions: a chat model lists them, and each one is decided on its own.
    const { commands } = await ai.chat({
      prompt: request,
      system: "Split the request into single-device commands, one per item, in the user's words.",
      schema: { type: "object", properties: { commands: { type: "array", items: { type: "string" } } }, required: ["commands"] },
      signal,
    }).object()
    return Promise.all(commands.map((c) => handle(c, { split: false })))
  }

  const targets = rooms.choice === "all" ? Object.keys(house[device.choice]) : [rooms.choice]
  if (category.choice === "status") return targets.map((room) => `${device.choice} in ${room}: ${house[device.choice][room]}`)
  for (const room of targets) {
    if (device.choice === "thermostat") house.thermostat[room] += action.choice === "on" ? 2 : -2
    else house[device.choice][room] = device.choice === "blinds" ? (action.choice === "on" ? "open" : "closed") : action.choice
  }
  return `${action.choice}: ${device.choice} in ${targets.join(", ")} (${Math.round(device.confidence * 100)}% sure)`
}

print(await handle("Turn off all the lights in the house"))
print(await handle("Close the bedroom blinds and make the living room warmer"))
print(await handle("Is the kitchen light on?"))
print(house)
```

## How it works

- **Speculative fan-out.** `action` is asked before anyone knows the request is a command, `rooms` before anyone knows it concerns a device. One round trip answers everything; the code reads only the answers that apply. Asking them one after the other would cost a call each.
- **Compound requests.** A single `noul` says whether there is more than one action. Only then does a chat model split the text, with a schema, and each piece goes through the same decision.
- **Conversation.** A request that is neither a command nor a status question goes to `ai.chat()`. The decision that found this out took a fraction of the chat's time.
- **The cascade still applies.** `decide()` goes to the first provider offering `decide` (the visitor's model through Leuria); `chat()` to the first chat provider, the browser's model included. See [Decisions](../guides/decisions.md) and [Providers](../guides/providers.md).
