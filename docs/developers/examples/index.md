# Examples

Small recipes, each one complete. On the portal you can edit and run them in the page, with your own AI once you connect it, or your browser's built-in model before that.

| Recipe | What it shows | Needs |
| --- | --- | --- |
| [A first answer](first-answer.md) | Ask, get text back, see who answered | Any AI |
| [A page tool](page-tool.md) | The AI calls a function of your page | An AI that uses tools |
| [Structured output](structured-output.md) | Free text in, a typed object out | Any AI |
| [A conversation with context](conversation-context.md) | Follow-ups, and values bound to a turn | Any AI |
| [The visitor answers](visitor-answers.md) | A tool that waits for the visitor's confirmation | An AI that uses tools |
| [Search by meaning](search-by-meaning.md) | An index of your content in the browser | An embedding model |
| [Middleware](middleware.md) | Watch and redact every tool call | An AI that uses tools |
| [Who answers](routing.md) | The cascade, routing options, and what to do when no AI can answer | Nothing |

In the runnable blocks, `ai` is the page's Leuria client, `print(value)` shows a value, and `signal` stops the run when you press Stop. In your own code, create the client with `createAI` (see the [Quickstart](../quickstart.md)).
