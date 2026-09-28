/**
 * The client module: starts Leuria in the browser once, and keeps the Ask
 * panel and its conversation across the site's page changes. Nothing runs
 * while Docusaurus renders pages at build time.
 */

import ExecutionEnvironment from "@docusaurus/ExecutionEnvironment";
import config from "@leuria-docusaurus/config";
import loadEmbedder from "@leuria-docusaurus/embedder";

import type { Leuria, Provider } from "@leuria/client";
import type { Docs } from "@leuria/docs";

import type { ClientConfig } from "../index.js";

/** Show a page with the site's router: push it, then tell the router the address changed. */
function navigate(url: string): void {
	const target = new URL(url, location.href);
	if (target.origin !== location.origin) {
		location.assign(target.href);
		return;
	}
	if (target.pathname === location.pathname && target.search === location.search) {
		location.hash = target.hash;
		return;
	}
	history.pushState(null, "", `${target.pathname}${target.search}${target.hash}`);
	dispatchEvent(new PopStateEvent("popstate", { state: null }));
}

/** Follow the site's light/dark switch. */
function followTheme(setDefaultAppearance: (value: "light" | "dark" | undefined) => void): void {
	const html = document.documentElement;
	const apply = () => setDefaultAppearance(html.dataset.theme === "dark" ? "dark" : "light");
	apply();
	new MutationObserver(apply).observe(html, { attributes: true, attributeFilter: ["data-theme"] });
}

let started: (value: { ai: Leuria; docs: Docs }) => void;

/**
 * The site's Leuria client and docs, once started in the browser (never
 * during the build). For the site's own components:
 *
 *   import { leuria } from "@leuria/docusaurus/client"
 *   const { ai } = await leuria
 */
export const leuria = new Promise<{ ai: Leuria; docs: Docs }>((resolve) => {
	started = resolve;
});

async function start(settings: ClientConfig): Promise<void> {
	const [{ bridge, browserAI, createLeuria, server }, { setDefaultAppearance, setDefaultClient }, { createDocs, setupDocs }] = await Promise.all([
		import("@leuria/client"),
		import("@leuria/connect"),
		import("@leuria/docs"),
	]);
	const providers: Provider[] = [bridge({ app: settings.app, needs: settings.needs }), browserAI()];
	if (loadEmbedder) providers.push(await loadEmbedder());
	if (settings.server) providers.push(server({ url: settings.server.url }));

	const ai = createLeuria({ providers, fallback: settings.fallback });
	setDefaultClient(ai);
	followTheme(setDefaultAppearance);

	const docs = createDocs(ai, {
		corpus: () => import("@leuria-docusaurus/corpus").then((m) => m.default),
		navigate,
	});
	setupDocs(docs, { title: settings.title, suggestions: settings.suggestions, system: settings.system });
	started({ ai, docs });
	if (settings.askButton === "floating") {
		const button = document.createElement("leuria-ask-button");
		button.setAttribute("floating", "");
		document.body.append(button);
	}
	if (settings.webmcp) {
		await docs.load();
		docs.expose();
	}
}

if (ExecutionEnvironment.canUseDOM) {
	start(config as ClientConfig).catch((error) => console.warn("[leuria] Ask AI could not start:", error));
}
