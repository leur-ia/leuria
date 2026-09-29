/**
 * Dev-only: the app's UI in a normal browser, against a real engine
 * started with `leuria start --app` (see README). The Tauri shell is
 * mocked: `engine_info` returns the engine's port and token, events
 * never arrive, launch at login is a no-op. Not part of the build.
 */
import { mockIPC } from "@tauri-apps/api/mocks";

const params = new URLSearchParams(location.search);
const port = Number(params.get("port") ?? 19570);
const token = params.get("token") ?? "";

let autostart = false;
mockIPC((cmd) => {
	if (cmd === "engine_info") return { port, token };
	if (cmd === "plugin:autostart|is_enabled") return autostart;
	if (cmd === "plugin:autostart|enable") autostart = true;
	if (cmd === "plugin:autostart|disable") autostart = false;
	if (cmd === "plugin:app|version") return "0.1.1";
	// ?update=ready|latest|failed previews "Check for updates".
	if (cmd === "check_update") {
		const outcome = params.get("update");
		return new Promise((resolve, reject) =>
			setTimeout(() => (outcome === "failed" ? reject(new Error("offline")) : resolve(outcome === "ready" ? "0.2.0" : null)), 1500),
		);
	}
	if (cmd === "plugin:event|listen") return Math.floor(Math.random() * 1e6);
	return null;
});

// ?theme=dark|light previews the Night or Pearl theme whatever the system says.
const theme = params.get("theme");
if (theme === "dark" || theme === "light") {
	const matches = theme === "dark";
	const original = window.matchMedia.bind(window);
	window.matchMedia = (query: string) =>
		query.includes("prefers-color-scheme")
			? ({
					matches: query.includes(theme),
					media: query,
					onchange: null,
					addEventListener: () => undefined,
					removeEventListener: () => undefined,
					addListener: () => undefined,
					removeListener: () => undefined,
					dispatchEvent: () => false,
				} as MediaQueryList)
			: original(query);
	document.documentElement.dataset.theme = matches ? "dark" : "light";
}

await import("./main");
