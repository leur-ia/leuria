# @leuria/react-connect

Leuria's Connect UI for React: the [`@leuria/connect`](../connect) web components as React components, given the client of the nearest `LeuriaProvider` from [`@leuria/react`](../react). One implementation, so the button looks and behaves the same in React as on any other page.

```tsx
import { LeuriaProvider } from "@leuria/react"
import { AIStatus, ConnectButton, LeuriaBadge } from "@leuria/react-connect"

<LeuriaProvider client={ai}>
  <ConnectButton onDisconnect={() => setSession((n) => n + 1)} />
  <AIStatus />
  <LeuriaBadge />
</LeuriaProvider>
```

| Component | Props |
| --- | --- |
| `ConnectButton` | `size` (1, 2 or 3), `byline`, `onDisconnect` |
| `AIStatus` | `labels` (names by provider id) |
| `LeuriaBadge` | `href`, `children` (replaces "Runs on your AI") |

All take `appearance` (`light` / `dark`), `className` and `style` (position and size only). Works with React 18 and 19. Apache-2.0.
