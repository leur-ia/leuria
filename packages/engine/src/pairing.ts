/**
 * Pairing: how a site gets a grant, without the engine ever answering a
 * site that the visitor didn't ask about.
 *
 *   1. On the visitor's click, the page makes a secret nonce and opens
 *      `leuria://connect?origin=…&app=…&nonce=…`. The desktop app gets the
 *      link, registers it (`link()`, through its admin API) and asks the
 *      visitor in its own window.
 *   2. The page long-polls `POST /connect/claim { nonce }`. The engine
 *      answers only the browser's `Origin` that a link named (a page cannot
 *      forge it), and only with the nonce of that link. On Allow, the token
 *      goes out once.
 *
 * A site that forges a link naming another site gets nothing: it can't
 * claim with the other site's Origin, and the other site doesn't know the
 * nonce. Until a link names it, a site gets no answer at all (see
 * `server.ts`: no CORS), so it can't tell that Leuria is installed.
 *
 * The CLI engine (no app, so no links) serves the same claim: the first
 * claim creates the request, and the visitor answers on the engine's own
 * approval page, opened in their browser. Only a click there, posted from
 * the engine's origin, decides.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type * as http from "node:http";

import { type GrantStore, normalizeOrigin } from "./grants.js";
import { parseBody, sendJson } from "./http-utils.js";
import type { Logger } from "./logger.js";
import { parseNeeds, type SiteNeeds } from "./needs.js";
import { parseSkillRefs, sameRefs, type SiteSkill } from "./skills.js";

const REQUEST_TTL_MS = 5 * 60_000;
const MAX_PENDING = 20;
/** Long-poll window for `/claim`; the client polls again after it. */
const WAIT_MS = 25_000;
/** After a No, the same site can't ask again for this long. */
const DENIED_COOLDOWN_MS = 30_000;
/** A nonce: 16 to 96 random bytes, base64url. */
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;

type Decision = "pending" | "allowed" | "denied";

interface PendingRequest {
	id: string;
	origin: string;
	app?: string;
	createdAt: number;
	decision: Decision;
	/** SHA-256 of the nonce the page will claim with. */
	nonce: Buffer;
	/** What the site says its features need. */
	needs?: SiteNeeds;
	/** The skills the site gives its AI: its refs, and what they resolved to once fetched. */
	skills?: { refs: string[]; list?: SiteSkill[] };
	token?: string;
	waiters: Set<() => void>;
}

interface PairingOptions {
	grants: GrantStore;
	logger: Logger;
	/** Engine's own origins, e.g. `http://127.0.0.1:19570`. */
	selfOrigins: Set<string>;
	port: number;
	/**
	 * Requests come only from links the desktop app received (`link()`).
	 * Off for the CLI: the first claim creates the request.
	 */
	linksOnly: boolean;
	/** Plain-language name of the configured agent, shown on the page. */
	agentName: () => string;
	/** Fetch the skills a site names, to show them before the visitor answers. Without it, skills are ignored. */
	resolveSkills?: (origin: string, refs: string[]) => Promise<SiteSkill[]>;
	/** Called when a request is created (or a link repeated, or its skills are fetched), e.g. to open the approval page or show the app. */
	onRequest?: (request: PairingRequestInfo) => void;
	/** Called when the visitor decided, wherever they clicked. */
	onDecided?: (request: { requestId: string; origin: string; allowed: boolean }) => void;
}

export interface PairingRequestInfo {
	requestId: string;
	origin: string;
	app?: string;
	needs?: SiteNeeds;
	/** The skills the site gives its AI; `loading` until they are fetched. */
	skills?: { loading: boolean; list: Array<Pick<SiteSkill, "name" | "description" | "source" | "shared">> };
	approveUrl: string;
}

const hashNonce = (nonce: string) => createHash("sha256").update(nonce).digest();

export class Pairing {
	private readonly requests = new Map<string, PendingRequest>();
	private readonly deniedAt = new Map<string, number>();

	constructor(private readonly options: PairingOptions) {}

	/** A link named this origin and it hasn't collected its answer yet: it may be answered. */
	hasRequest(origin: string): boolean {
		this.expire();
		return [...this.requests.values()].some((r) => r.origin === origin);
	}

	/**
	 * A `leuria://connect` link reached the desktop app. Returns the request,
	 * or why it was refused. A repeated link for the same site replaces the
	 * nonce (the page tried again) instead of asking twice.
	 */
	link(input: { origin?: unknown; app?: unknown; nonce?: unknown; needs?: unknown; skills?: unknown }): { requestId: string } | { error: string } {
		this.expire();
		let origin: string;
		try {
			origin = normalizeOrigin(String(input.origin ?? ""));
		} catch {
			return { error: "The link doesn't name a website." };
		}
		if (this.options.selfOrigins.has(origin)) return { error: "The link doesn't name a website." };
		if (typeof input.nonce !== "string" || !NONCE.test(input.nonce)) return { error: "The link is incomplete." };
		const app = typeof input.app === "string" && input.app.trim() ? input.app.trim().slice(0, 80) : undefined;
		const request = this.open(origin, app, input.nonce, parseNeeds(input.needs), parseSkillRefs(input.skills));
		return "error" in request ? request : { requestId: request.id };
	}

	/** Returns true when the request was a pairing route. */
	async handle(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<boolean> {
		const segments = pathname.split("/").filter(Boolean);
		if (segments[0] !== "connect") return false;
		this.expire();

		const origin = req.headers.origin;
		const id = segments[1];
		const action = segments[2];

		if (req.method === "POST" && id === "claim" && segments.length === 2) {
			await this.claim(req, res, origin);
			return true;
		}
		if (!id) return false;
		const request = this.requests.get(id);

		if (req.method === "GET" && segments.length === 2) {
			this.renderPage(res, request);
			return true;
		}
		if (req.method === "GET" && action === "state") {
			// The approval page asks whether the visitor already answered elsewhere (the app).
			// Same-origin GETs carry no Origin; other websites must not read it.
			if (origin && !this.options.selfOrigins.has(origin)) {
				sendJson(res, 403, { error: "Forbidden" });
				return true;
			}
			sendJson(res, 200, { decision: request?.decision ?? "expired", ...(request?.skills && !request.skills.list ? { skillsLoading: true } : {}) });
			return true;
		}
		if (req.method === "POST" && action === "decide") {
			// Only the engine's own page can decide.
			if (!origin || !this.options.selfOrigins.has(origin)) {
				sendJson(res, 403, { error: "Forbidden" });
				return true;
			}
			if (!request || request.decision !== "pending") {
				sendJson(res, 410, { error: "This request has expired. Ask the site again." });
				return true;
			}
			const body = (await parseBody(req)) as Record<string, unknown>;
			this.decide(request, body.allow === true);
			sendJson(res, 200, { decision: request.decision, origin: request.origin });
			return true;
		}
		return false;
	}

	/** The page collects the visitor's answer, with the nonce of its link. */
	private async claim(req: http.IncomingMessage, res: http.ServerResponse, rawOrigin: string | undefined): Promise<void> {
		let origin: string | undefined;
		try {
			origin = rawOrigin && !this.options.selfOrigins.has(rawOrigin) ? normalizeOrigin(rawOrigin) : undefined;
		} catch {
			origin = undefined;
		}
		if (!origin) {
			sendJson(res, 400, { error: "Pairing must come from a web page" });
			return;
		}
		const body = (await parseBody(req)) as Record<string, unknown>;
		const nonce = body.nonce;
		if (typeof nonce !== "string" || !NONCE.test(nonce)) {
			sendJson(res, 400, { error: "A nonce is required" });
			return;
		}
		const hash = hashNonce(nonce);
		let request = [...this.requests.values()].find((r) => r.origin === origin && timingSafeEqual(r.nonce, hash));
		if (!request) {
			if (this.options.linksOnly) {
				sendJson(res, 404, { error: "Unknown pairing request" });
				return;
			}
			// The CLI: the claim itself asks the visitor.
			const app = typeof body.app === "string" && body.app.trim() ? body.app.trim().slice(0, 80) : undefined;
			const opened = this.open(origin, app, nonce, parseNeeds(body.needs), parseSkillRefs(body.skills));
			if ("error" in opened) {
				sendJson(res, opened.status, { error: opened.error });
				return;
			}
			request = opened;
		}
		await this.wait(request);
		// The page tried again meanwhile: only its latest claim gets the answer.
		if (!timingSafeEqual(request.nonce, hash)) {
			sendJson(res, 404, { error: "Unknown pairing request" });
			return;
		}
		if (request.decision === "allowed" && request.token) {
			const token = request.token;
			// The token is handed out once.
			request.token = undefined;
			this.requests.delete(request.id);
			sendJson(res, 200, { status: "allowed", token });
		} else if (request.decision === "denied") {
			this.requests.delete(request.id);
			sendJson(res, 200, { status: "denied" });
		} else {
			sendJson(res, 200, { status: "pending" });
		}
	}

	/** Ask the visitor about `origin`, or update the question already asked. */
	private open(origin: string, app: string | undefined, nonce: string, needs?: SiteNeeds, skillRefs?: string[]): PendingRequest | { error: string; status: number } {
		const denied = this.deniedAt.get(origin);
		if (denied && Date.now() - denied < DENIED_COOLDOWN_MS) return { error: "The visitor just said no to this site", status: 429 };
		const existing = [...this.requests.values()].find((r) => r.origin === origin && r.decision === "pending");
		if (existing) {
			existing.nonce = hashNonce(nonce);
			if (app) existing.app = app;
			if (needs) existing.needs = needs;
			if (skillRefs && !sameRefs(existing.skills?.refs, skillRefs)) this.fetchSkills(existing, skillRefs);
			this.options.onRequest?.(this.info(existing));
			return existing;
		}
		if ([...this.requests.values()].filter((r) => r.decision === "pending").length >= MAX_PENDING) {
			return { error: "Too many pending pairing requests", status: 429 };
		}
		const request: PendingRequest = {
			id: randomBytes(18).toString("base64url"),
			origin,
			app,
			createdAt: Date.now(),
			decision: "pending",
			nonce: hashNonce(nonce),
			needs,
			waiters: new Set(),
		};
		this.requests.set(request.id, request);
		if (skillRefs) this.fetchSkills(request, skillRefs);
		this.options.logger.info("pairing requested", { origin, app });
		this.options.onRequest?.(this.info(request));
		return request;
	}

	/**
	 * Fetch the skills the site names, then show them: the question is asked
	 * again with them. Answered meanwhile: they go to the site's grant.
	 */
	private fetchSkills(request: PendingRequest, refs: string[]): void {
		const { resolveSkills } = this.options;
		if (!resolveSkills) return;
		const skills: NonNullable<PendingRequest["skills"]> = { refs };
		request.skills = skills;
		void resolveSkills(request.origin, refs)
			.catch(() => [])
			.then((list) => {
				// The site asked again with other skills meanwhile.
				if (request.skills !== skills) return;
				skills.list = list;
				if (request.decision === "pending") this.options.onRequest?.(this.info(request));
				else if (request.decision === "allowed") this.options.grants.setSkills(request.origin, { refs, list });
			});
	}

	private info(request: PendingRequest): PairingRequestInfo {
		const skills = request.skills;
		return {
			requestId: request.id,
			origin: request.origin,
			app: request.app,
			...(request.needs ? { needs: request.needs } : {}),
			...(skills
				? { skills: { loading: !skills.list, list: (skills.list ?? []).map(({ name, description, source, shared }) => ({ name, description, source, shared })) } }
				: {}),
			approveUrl: `http://127.0.0.1:${this.options.port}/connect/${request.id}`,
		};
	}

	/** Requests waiting for the visitor, e.g. for the desktop app. */
	pending(): PairingRequestInfo[] {
		this.expire();
		return [...this.requests.values()].filter((r) => r.decision === "pending").map((r) => this.info(r));
	}

	/**
	 * Decide from a trusted place (the desktop app's native window).
	 * `granted` runs on Allow once the grant exists, before the site gets
	 * its token: e.g. to set the site's AI and model from the first message.
	 */
	decideById(requestId: string, allow: boolean, granted?: (origin: string) => void): boolean {
		this.expire();
		const request = this.requests.get(requestId);
		if (!request || request.decision !== "pending") return false;
		this.decide(request, allow, granted);
		return true;
	}

	private decide(request: PendingRequest, allow: boolean, granted?: (origin: string) => void): void {
		if (allow) {
			const skills = request.skills ? { refs: request.skills.refs, list: request.skills.list ?? [] } : undefined;
			request.token = this.options.grants.create(request.origin, request.app, request.needs, skills);
			granted?.(request.origin);
			request.decision = "allowed";
		} else {
			request.decision = "denied";
			this.deniedAt.set(request.origin, Date.now());
		}
		this.options.logger.info("pairing decided", {
			origin: request.origin,
			decision: request.decision,
		});
		for (const wake of request.waiters) wake();
		request.waiters.clear();
		this.options.onDecided?.({ requestId: request.id, origin: request.origin, allowed: allow });
	}

	private wait(request: PendingRequest): Promise<void> {
		if (request.decision !== "pending") return Promise.resolve();
		return new Promise((resolve) => {
			const wake = () => {
				clearTimeout(timer);
				resolve();
			};
			const timer = setTimeout(() => {
				request.waiters.delete(wake);
				resolve();
			}, WAIT_MS);
			request.waiters.add(wake);
		});
	}

	private expire(): void {
		const now = Date.now();
		for (const [id, request] of this.requests) {
			if (now - request.createdAt > REQUEST_TTL_MS) {
				for (const wake of request.waiters) wake();
				this.requests.delete(id);
			}
		}
		for (const [origin, at] of this.deniedAt) if (now - at > DENIED_COOLDOWN_MS) this.deniedAt.delete(origin);
	}

	private renderPage(res: http.ServerResponse, request: PendingRequest | undefined): void {
		const body =
			request && request.decision === "pending"
				? approvePage(request, this.options.agentName())
				: messagePage("This request has expired", "Go back to the site and try connecting again.");
		res.writeHead(200, {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
			// Never framed, so a site cannot overlay or click-jack it.
			"X-Frame-Options": "DENY",
			"Content-Security-Policy":
				"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
			"Referrer-Policy": "no-referrer",
		});
		res.end(body);
	}
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/* Leuria Pearl, inlined: the engine serves this page itself, offline. */
const STYLE = `
:root { color-scheme: light dark; --bg: #fcfcfe; --surface: #ffffff; --text: #1d2035; --muted: #5f6275; --border: #d6d8e5; --sunken: #f7f7fb;
  --ink: #14172b; --ink-hover: #262a45; --on-ink: #ffffff; --live: #019163; --focus: #8169dd;
  --atmo-base: #eef0f7; --atmo-lavender: #d9d0ff; --atmo-ice: #cde8f7; --atmo-mint: #d3f3e6; --atmo-blush: #f9dce6;
  --shadow: 0 32px 72px -20px rgba(20, 23, 43, 0.35), 0 0 0 1px rgba(20, 23, 43, 0.05); }
@media (prefers-color-scheme: dark) { :root { --bg: #0d0e13; --surface: #13141a; --text: #ebecf2; --muted: #babdcb; --border: #323443; --sunken: #0d0e13;
  --ink: #eef0f7; --ink-hover: #d9dcea; --on-ink: #14172b; --live: #19a572; --focus: #907aeb;
  --atmo-base: #0f1120; --atmo-lavender: #2a2548; --atmo-ice: #183040; --atmo-mint: #183329; --atmo-blush: #3a2231;
  --shadow: 0 32px 72px -20px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.08); } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; color: var(--text);
  font: 16px/1.5 "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased;
  background: radial-gradient(circle at 12% 12%, var(--atmo-blush) 0%, transparent 52%), radial-gradient(circle at 88% 18%, var(--atmo-ice) 0%, transparent 54%),
    radial-gradient(circle at 82% 92%, var(--atmo-mint) 0%, transparent 56%), radial-gradient(circle at 14% 92%, var(--atmo-lavender) 0%, transparent 56%), var(--atmo-base); }
main { width: 100%; max-width: 420px; background: var(--surface); border-radius: 24px; padding: 32px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 16px; }
.logo { display: inline-flex; align-items: center; gap: 8px; color: var(--ink); font-weight: 800; letter-spacing: -0.04em; font-size: 19px; }
.badge { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 9999px; background: var(--sunken); border: 1px solid var(--border); font-size: 13px; color: var(--muted); }
h1 { font-size: 24px; line-height: 30px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
p { margin: 0; color: var(--muted); font-size: 14px; }
.eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
li { display: flex; align-items: center; gap: 8px; }
li svg { flex-shrink: 0; }
.can svg { color: var(--live); }
.cant svg { color: var(--muted); }
.warn { font-size: 14px; font-weight: 600; }
.actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 8px; }
button { font: inherit; font-size: 16px; font-weight: 600; min-height: 48px; padding: 0 22px; border-radius: 9999px; cursor: pointer; border: none; }
button.soft { background: var(--sunken); color: var(--text); border: 1px solid var(--border); }
button.ink { background: var(--ink); color: var(--on-ink); }
button.ink:hover { background: var(--ink-hover); }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.small { font-size: 12px; }
.skills { border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; font-size: 14px; }
.skills summary { cursor: pointer; display: flex; justify-content: space-between; gap: 8px; list-style: none; }
.skills summary::-webkit-details-marker { display: none; }
.skills summary span:last-child { color: var(--muted); white-space: nowrap; }
.skills[open] summary span:last-child::after { content: " \\25B4"; }
.skills:not([open]) summary span:last-child::after { content: " \\25BE"; }
.skills ul { margin-top: 10px; gap: 10px; }
.skills li { display: block; }
.skills li p { font-size: 13px; }
`;

const MARK = "M181 61 C184 74 191 82 206 86 C191 90 184 98 181 111 C178 98 171 90 156 86 C171 82 178 74 181 61 Z M59 92 C60 109 67 128 79 143 C91 158 105 168 124 174 C149 182 164 193 171 207 C177 219 177 239 177 255 C182 255 182 240 184 226 C188 199 201 187 223 179 C247 171 270 158 284 142 C298 127 303 109 303 92 C298 91 292 101 284 108 C265 125 245 130 226 126 C217 124 211 114 205 112 C199 110 199 116 199 121 C198 127 191 130 181 130 C171 130 165 127 163 121 C162 116 165 110 159 111 C151 112 148 122 137 126 C118 131 98 125 78 109 C69 102 65 91 59 92 Z";
const LOGO = `<span class="logo" role="img" aria-label="Leuria"><svg width="22" height="22" viewBox="53 30 256 256" aria-hidden="true"><path d="${MARK}" fill="currentColor"/></svg>leuria</span>`;
const icon = (d: string) =>
	`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const CHECK = icon("M5 12.5l4.5 4.5L19 7.5");
const CROSS = icon("M6 6l12 12M18 6L6 18");
const GLOBE = icon("M12 21a9 9 0 100-18 9 9 0 000 18zM3.5 9h17M3.5 15h17M12 3c2.5 2.6 3.5 5.6 3.5 9s-1 6.4-3.5 9c-2.5-2.6-3.5-5.6-3.5-9s1-6.4 3.5-9z");

function page(title: string, body: string, script = ""): string {
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Leuria</title><style>${STYLE}</style></head>
<body><main>${LOGO}${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;
}

function approvePage(request: PendingRequest, agentName: string): string {
	const host = escapeHtml(new URL(request.origin).host);
	const name = request.app ? escapeHtml(request.app) : host;
	const agent = escapeHtml(agentName);
	const insecure = request.origin.startsWith("http:") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(request.origin);
	const body = `
<span class="badge">${GLOBE}${host}</span>
<h1>${name} wants to use your AI</h1>
<p>It will talk to ${agent}, on this computer.</p>
<div><div class="eyebrow">It can</div><ul class="can"><li>${CHECK}Ask your AI to answer you</li><li>${CHECK}Let your AI use its own page's tools</li></ul></div>
<div><div class="eyebrow">It can't</div><ul class="cant"><li>${CROSS}See your files or run programs</li><li>${CROSS}See what you do on other websites</li></ul></div>
${skillsSection(request)}
${insecure ? `<p class="warn">This site doesn't use a secure connection.</p>` : ""}
<p class="small">You can disconnect it at any time with <code>leuria sites revoke ${escapeHtml(request.origin)}</code>.</p>
<div class="actions"><button type="button" class="soft" id="deny">Not now</button><button type="button" class="ink" id="allow">Allow</button></div>`;
	const script = `
const main = document.querySelector("main");
const buttons = document.querySelectorAll("button");
const done = (title, text) => {
  main.innerHTML = main.querySelector(".logo").outerHTML + "<h1>" + title + "</h1><p>" + text + "</p>";
  setTimeout(() => window.close(), 1500);
};
async function decide(allow) {
  buttons.forEach((b) => (b.disabled = true));
  const res = await fetch(location.pathname + "/decide", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allow }),
  }).catch(() => null);
  if (!res || !res.ok) return done("This request has expired", "Go back to the site and try connecting again.");
  allow ? done("Connected", "You can close this window and go back to the site.") : done("Not connected", "The site can ask again later.");
}
document.getElementById("allow").addEventListener("click", () => decide(true));
document.getElementById("deny").addEventListener("click", () => decide(false));
// Answered in the Leuria app instead: close this window too. The site's skills fetched: show them.
const skillsLoading = ${request.skills && !request.skills.list ? "true" : "false"};
setInterval(async () => {
  const res = await fetch(location.pathname + "/state").catch(() => null);
  const state = res && res.ok ? await res.json() : null;
  if (state && state.decision !== "pending") done("Answered in Leuria", "You can close this window.");
  else if (state && skillsLoading && !state.skillsLoading) location.reload();
}, 1500);`;
	return page("Connect your AI", body, script);
}

/** "This site uses 2 skills to guide your AI", with the list under "See details". */
function skillsSection(request: PendingRequest): string {
	const skills = request.skills;
	if (!skills) return "";
	if (!skills.list) return `<p>Checking the skills this site uses to guide your AI…</p>`;
	if (!skills.list.length) return "";
	const count = skills.list.length === 1 ? "1 skill" : `${skills.list.length} skills`;
	const items = skills.list
		.map((s) => `<li><strong>${escapeHtml(s.name)}</strong><p>${escapeHtml(s.description)}</p><p class="small">${s.shared ? `Shared skill · ${escapeHtml(s.source)}` : `From ${escapeHtml(s.source)}`}</p></li>`)
		.join("");
	return `<details class="skills"><summary><span>This site uses ${count} to guide your AI.</span><span>See details</span></summary><ul>${items}</ul></details>`;
}

function messagePage(title: string, text: string): string {
	return page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>`);
}
