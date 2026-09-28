/**
 * `leuria://connect` links: a site asks to use the visitor's AI. The page
 * opens the link on the visitor's click; the system hands it to Leuria
 * (starting it if needed), and the engine asks the visitor in this window.
 * The Rust shell keeps each link until it is taken here, so a link that
 * started the app isn't lost while the engine starts.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { parseConnectLink, parseSiteLink } from "./connect-link";
import { engine } from "./engine";
import { appStore } from "./stores/app.store";
import { homeStore } from "./stores/home.store";

async function takeLinks(): Promise<void> {
	const urls = (await invoke<string[] | null>("take_links").catch(() => null)) ?? [];
	for (const url of urls) {
		// A connected site's "Change AI or model…": open its settings (nothing is sent back to the site).
		const site = parseSiteLink(url);
		if (site) {
			void homeStore.focusSite(site.origin);
			continue;
		}
		const link = parseConnectLink(url);
		if (!link) continue;
		try {
			await engine.link(link);
		} catch {
			void appStore.showToast({ tone: "blocked", title: "This website couldn't connect", description: "Go back to it and try again." });
		}
	}
}

/** Called once at startup, outside React. */
export function bindLinks(): void {
	void listen("deep-link", () => void takeLinks());
	void takeLinks();
}
