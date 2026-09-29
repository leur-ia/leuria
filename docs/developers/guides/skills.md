# Skills

How to give the visitor's AI instructions for tasks on your site, as skills. Leuria fetches them, shows them to the visitor, and gives them to the AI in your site's conversations only.

```ts
import { bridge, createLeuria } from "@leuria/client"

const ai = createLeuria({
  providers: [
    bridge({
      app: "Kiln & Co.",
      skills: [
        "/",                                                  // your own, from /.well-known/agent-skills
        "vercel-labs/agent-skills@web-design-guidelines#9f2c1e4", // a shared skill, pinned to a commit
      ],
    }),
  ],
})
```

A skill is a folder with a `SKILL.md`: YAML front matter with a `name` and a `description`, then the instructions. It may hold other text files that the instructions mention. This is the [Agent Skills](https://agentskills.io) format, the same one `npx skills` installs:

```markdown
---
name: returns
description: How to prepare a return request, from the order number to the label.
---

Ask for the order number, then call `find_order`. Returns are free within 30 days; see policy.md.
```

## Where skills come from

`skills` takes the refs you would give `npx skills add`:

| Ref | What |
| --- | --- |
| `owner/repo` | Every skill in a GitHub repository |
| `owner/repo@name` | One skill, by name |
| `owner/repo/path/to/skills` | The skills under a folder |
| `…#ref` | At a branch, tag or commit. Without it, the default branch |
| `https://github.com/owner/repo/tree/ref/path` | The same, as a URL |
| `/` or a URL on your site | Your own skills: `.well-known/agent-skills/index.json` under that path ([discovery index](https://agentskills.io), v0.1 or v0.2), or a `SKILL.md` URL |

Only GitHub and your site's own origin are accepted; any other address is skipped. Only text files are kept (`.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.csv`): scripts and binaries are dropped, since the AI has no shell to run them. Leuria takes up to 16 refs and 16 skills per site. When two skills share a name, the first one wins.

**Pin shared skills to a commit** (`#<sha>`). A branch can change under you: whoever controls the repository then changes what your site tells the visitor's AI. Your own skills in a v0.2 index carry a `sha256` digest, which Leuria checks.

## What the visitor sees

The approval window says "This site uses 3 skills to guide your AI." Under **See details** it lists each skill: its name, what it's for, and whether it comes from your site or is shared (with the repository's name). The site's row in Leuria's Websites tab shows the same, and marks skills you add later as new.

Skills are guidance, not permissions. The AI can still only call your page's tools, so they need no extra approval.

## When Leuria fetches them

- **On connect.** When your site asks to connect, Leuria fetches the skills to show them before the visitor answers.
- **When your list changes.** The SDK sends `skills` with each conversation. When the list differs from what Leuria has, Leuria fetches the new one in the background; the next conversation gets it. `skills: []` removes them; leaving `skills` out keeps what Leuria has.
- **Never while a conversation starts.** Sessions read skills from Leuria's cache (`~/.leuria/skills`), shared by every site: a skill two sites use is stored once.

A ref that fails (not found, network down, bad `SKILL.md`) is skipped, and the others still apply. Leuria keeps fetched content as it was: to pick up changes to a branch, change the ref (a new commit, say).

## What the AI gets

- In its instructions, after your `system` prompt: that the site gives it skills, and each skill's name and description.
- A `read_skill` tool: `{ name, file? }` returns the skill's instructions, or one of its files. The AI calls it when a request matches a skill, so long skills cost nothing until they are needed.

`read_skill` sits next to your page tools and shows up in `tool_call` events like them. It replaces a page tool of the same name.

Skills only work with the visitor's own AI (the `bridge` provider). The browser's model and your server don't get them: put what they need in `system`.
