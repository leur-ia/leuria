# Leuria desktop

The app visitors install: it runs the Leuria engine, keeps a tray icon, and gives them onboarding ("Which AI do you use?", then sign in, then a check), connected sites, and a native window to allow sites.

## How it is built

| Part | Where | What |
| --- | --- | --- |
| Shell | `src-tauri/` (Rust, Tauri 2) | Tray, single instance, `leuria://` links, launch at login, close-to-tray. Starts the engine sidecar with a random admin token and relays its events |
| Engine | `packages/engine`, compiled by `scripts/build-engine.mjs` | The same engine as the `leuria` CLI, compiled with Bun into `src-tauri/binaries/leuria-engine-<target-triple>`. Run with `start --app` |
| UI | `src/` (React, Sinux stores, Radix Themes with `@leuria/pearl`) | Talks to the engine's admin API (`/admin/*`, see `packages/engine/src/admin.ts`) with the token from the shell |

State lives in Sinux stores (`src/stores/`): `app` (view, status, pending site requests), `onboarding`, and `home`. Engine events are bound once at startup (`bindEngineEvents`), not in React effects.

With Bun inside the app, visitors need neither Node nor npm: the engine installs agents from the ACP registry with its own Bun.

## Develop

You need Rust (https://rustup.rs), Bun (https://bun.sh), Node 22+ and pnpm.

```sh
pnpm install
pnpm desktop              # builds the engine sidecar, then runs `tauri dev`
```

To keep your real `~/.leuria` out of it, set `LEURIA_HOME` (the sidecar inherits it):

```sh
LEURIA_HOME=/tmp/leuria-dev pnpm desktop
```

Debug builds accept a fixed admin token, so the admin API can be exercised from a shell:

```sh
LEURIA_DEV_ADMIN_TOKEN=$(printf 'd%.0s' {1..40}) pnpm desktop
curl -H "Authorization: Bearer $LEURIA_DEV_ADMIN_TOKEN" http://127.0.0.1:19570/admin/status
```

### The UI in a browser

`preview.html` loads the real UI in a browser with the Tauri shell mocked, against a real engine. Handy for screenshots and design review:

```sh
TOKEN=$(printf 'p%.0s' {1..40})
LEURIA_HOME=/tmp/leuria-preview LEURIA_ADMIN_TOKEN=$TOKEN src-tauri/binaries/leuria-engine-<triple> start --app --port 19571 &
pnpm ui:dev
open "http://localhost:1420/preview.html?port=19571&token=$TOKEN"          # add &theme=dark for Night
```

## Build

```sh
pnpm desktop:build        # .app and .dmg on macOS, a -setup.exe installer on Windows
```

On Windows the installer installs for the current user, without administrator rights, and registers `leuria://` links (`src-tauri/tauri.windows.conf.json`).

## Release

`.github/workflows/release.yml` runs on a `v*` tag and builds a draft release: the Mac apps (ad-hoc signed) and the Windows installer, with the update file (`latest.json`) running apps check. On Windows it builds in three steps, the app, then its installer, then the update signature, so that code signing (through SignPath, when the repository's `SIGNPATH_*` settings are set) covers the programs, the installer, and what updates verify.
