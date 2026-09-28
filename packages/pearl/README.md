# @leuria/pearl

Leuria Pearl, the design system, as code for Leuria's own surfaces: the desktop app today, then the browser extension. `@leuria/connect` builds its tokens from `src/tokens.css`, scoped to each element's shadow root.

It follows the design system's Radix guide: the product builds on **Radix Themes** with Pearl's tokens mapped onto it, and adds only what Radix doesn't have.

| File | What |
| --- | --- |
| `src/tokens.css` | Pearl and Night tokens, copied from the design system (`design_system/tokens.css`, generated from `tokens.json`). Update them there, then copy |
| `src/radix.css` | Lavender and Pearl scales mapped onto Radix accent and gray, fonts, radii (pills for actions, 12/16/24px for inputs, cards and dialogs), the ink button, focus rings |
| `src/pearl.css` | Pearl-only pieces: logo, Pearl atmosphere, status dot, toast, eyebrow |
| `src/styles.css` | Everything, in the right order. **Radix comes first**: it declares its own colour scales (including a `sage`) on `:root`, and Pearl's must win |

Components: `PearlTheme` (the Radix `Theme` root, following the system's light or dark appearance), `InkButton` (the one primary action per view), `Logo` / `Mark`, `PearlSurface`, `BridgeStatus`, `Icon`, `Toast`. For everything else, use Radix Themes directly: `Card`, `Button` (`soft` / `surface` / `ghost`), `RadioCards`, `Dialog`, `Switch`, `Select`, `Callout`, `Badge`.

```tsx
import "@leuria/pearl/styles.css";
import { PearlTheme, InkButton } from "@leuria/pearl";

<PearlTheme>
  <InkButton>Allow</InkButton>
</PearlTheme>
```

Rules worth remembering from the design system: one ink action per view; the Pearl atmosphere only for first impressions (onboarding, empty states), never behind dense UI; status colour always with words; no jargon ("bridge", "ACP", "provider") in anything a visitor reads.
