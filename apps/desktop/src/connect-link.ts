import type { ConnectLink, SiteNeeds } from "./engine";

/** A `leuria://<target>?…` link's parameters, or null for another link. */
function linkTo(raw: string, target: string): URLSearchParams | null {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== "leuria:") return null;
	// `leuria://connect?…` parses with "connect" as the host in some engines, as the path in others.
	const found = url.host || url.pathname.replace(/^\/+/, "");
	return found.replace(/\/+$/, "") === target ? url.searchParams : null;
}

/** A connect link as a page makes it; anything else is ignored. The engine checks the values again. */
export function parseConnectLink(raw: string): ConnectLink | null {
	const params = linkTo(raw, "connect");
	const origin = params?.get("origin");
	const nonce = params?.get("nonce");
	if (!params || !origin || !nonce) return null;
	const app = params.get("app") ?? undefined;
	// What the site says it needs, as the page wrote it: the engine keeps only the known words.
	const needs: SiteNeeds = {};
	if (params.get("tools") === "1") needs.tools = true;
	if (params.get("images") === "1") needs.images = true;
	const effort = params.get("effort");
	if (effort === "light" || effort === "standard" || effort === "deep") needs.effort = effort;
	const context = Number(params.get("context"));
	if (context > 0) needs.context = context;
	return { origin, nonce, ...(app ? { app } : {}), ...(Object.keys(needs).length ? { needs } : {}) };
}

/** `leuria://site?origin=…`: the visitor wants to change a connected site's AI or model. */
export function parseSiteLink(raw: string): { origin: string } | null {
	const origin = linkTo(raw, "site")?.get("origin");
	return origin ? { origin } : null;
}
