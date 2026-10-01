/**
 * Visit counting with Google Analytics, only after the reader's yes.
 * Nothing from Google loads before it: no script, no cookie. The answer
 * is kept in this browser (localStorage).
 */

export const ANALYTICS_ID = "G-X31RJ2D2BD";
const KEY = "leuria-analytics";

export type Answer = "yes" | "no";

declare global {
	interface Window {
		dataLayer?: unknown[];
		gtag?: (...args: unknown[]) => void;
	}
}

export function storedAnswer(): Answer | null {
	try {
		const value = localStorage.getItem(KEY);
		return value === "yes" || value === "no" ? value : null;
	} catch {
		return null;
	}
}

export function answer(value: Answer): void {
	try {
		localStorage.setItem(KEY, value);
	} catch {
		// private window: asked again next visit
	}
	if (value === "yes") start();
	else stop();
}

let loaded = false;

/** Load Google's tag. Page changes are counted by GA's own history tracking. */
export function start(): void {
	(window as unknown as Record<string, unknown>)[`ga-disable-${ANALYTICS_ID}`] = false;
	if (loaded) return;
	loaded = true;
	window.dataLayer = window.dataLayer || [];
	window.gtag = function gtag() {
		// gtag reads `arguments`, not an array.
		// biome-ignore lint/complexity/noArguments: required by gtag
		window.dataLayer!.push(arguments);
	};
	window.gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
	window.gtag("js", new Date());
	window.gtag("config", ANALYTICS_ID);
	const script = document.createElement("script");
	script.async = true;
	script.src = `https://www.googletagmanager.com/gtag/js?id=${ANALYTICS_ID}`;
	document.head.appendChild(script);
}

/** Stop counting and remove the cookies Google set. */
function stop(): void {
	(window as unknown as Record<string, unknown>)[`ga-disable-${ANALYTICS_ID}`] = true;
	window.gtag?.("consent", "update", { analytics_storage: "denied" });
	for (const cookie of document.cookie.split(";")) {
		const name = cookie.split("=")[0]!.trim();
		if (!name.startsWith("_ga")) continue;
		for (const domain of ["", `; domain=${location.hostname}`, `; domain=.${location.hostname.replace(/^www\./, "")}`]) {
			document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
		}
	}
}
