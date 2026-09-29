/**
 * The engine's admin API, as the app's UI sees it. The Rust shell starts
 * the engine with a random token and hands us the port and the token.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface EngineInfo {
	port: number | null;
	token: string;
}

export interface AgentChoice {
	id: string;
	/** An ACP agent (ChatGPT via Codex, Claude…) or a model of an LLM provider. */
	kind: "agent" | "llm";
	name: string;
	version?: string;
	description?: string;
	icon?: string;
	installed: string | null;
	found: boolean;
	current: boolean;
	/** LLM models: their provider, model id, and whether they run on this computer. */
	provider?: { id: string; kind: "lmstudio" | "ollama" | "openai"; name: string };
	model?: string;
	local?: boolean;
	loaded?: boolean | null;
}

/** The models an agent offers (from its first session), `current` being the one it uses. */
export interface AgentModels {
	current?: string;
	options: Array<{ id: string; name: string; description?: string }>;
}

export interface SignInStatus {
	ok: boolean;
	detail: string;
	methods: Array<{ id: string; name: string; description?: string }>;
	/** Present once signed in, when the agent lets you choose. */
	models?: AgentModels;
}

export interface Site {
	origin: string;
	app?: string;
	createdAt: string;
	lastUsedAt?: string;
	/** The site's own AI; the default AI when absent. */
	agent?: string;
	/** The site's own model, for the AI it was chosen with. */
	model?: { agent: string; id: string };
	/** What the site said its features need. */
	needs?: SiteNeeds;
	/** The skills the site gives its AI. */
	skills?: { list: SkillInfo[] };
}

export interface PairingRequest {
	requestId: string;
	origin: string;
	app?: string;
	needs?: SiteNeeds;
	/** The skills the site gives its AI; `loading` while Leuria fetches them. */
	skills?: { loading: boolean; list: SkillInfo[] };
}

/** A skill a site gives its AI: instructions for tasks on that site. */
export interface SkillInfo {
	name: string;
	description: string;
	/** The site's host, or the public repository it is shared from. */
	source: string;
	/** Shared from a public repository, rather than written by the site. */
	shared: boolean;
	/** The site added it after it was connected. */
	addedAt?: string;
}

/** What a site says its features need (guidance for choosing its AI). */
export interface SiteNeeds {
	tools?: boolean;
	images?: boolean;
	effort?: "light" | "standard" | "deep";
	context?: number;
}

/** What using a model costs the visitor: nothing (on this computer), their plan's limits, or money per use. */
export type Cost = "free" | "plan" | "paid";

/** How a model fits a site: enough, more than it needs (and costs), or short of what it needs. */
export type Verdict = "fits" | "more" | "short";

/** How Your AIs fit a site's needs, and the one to recommend (`model` null: the AI has no choice). */
export interface Fit {
	needs: SiteNeeds | null;
	recommended: { agent: string; model: string | null; modelName: string | null; isDefault: boolean; cost: Cost; reason: string } | null;
	ais: Array<{ id: string; verdict: Verdict; cost: Cost; models: Array<{ id: string; name: string; verdict: Verdict; cost: Cost }> }>;
}

export interface Status {
	version: string;
	port: number;
	/** `ready`: known to work (a check, a sign-in or a real session confirmed it), so nothing needs starting. */
	agent: { id: string; name: string; installed: string | null; ready: boolean };
	sites: number;
	pairing: PairingRequest[];
}

/** One of Your AIs: an agent (ChatGPT, Claude…) or one model of a service (qwen3 · LM Studio). */
export interface YourAi {
	id: string;
	kind: "agent" | "llm";
	name: string;
	default: boolean;
	/** Known to work; an agent never confirmed is checked when used. */
	ready: boolean;
	provider?: { id: string; kind: string; name: string };
	model?: string;
	local?: boolean;
}

/** The model sites get to search their pages by meaning: automatic, one the visitor chose, or off. */
export type SearchChoice = "auto" | "off" | { provider: string; model: string };

export interface SearchModels {
	choice: SearchChoice;
	/** The model sites get now (none when off, or when nothing is found). */
	current: { provider: { id: string; kind: string; name: string }; model: string } | null;
	/** Every search model found on this computer (LM Studio, Ollama). */
	models: Array<{ provider: { id: string; kind: string; name: string }; model: string; loaded: boolean | null }>;
}

/** "text-embedding-nomic-embed-text-v1.5" → "nomic-embed-text-v1.5". */
export function searchModelName(model: string): string {
	return (model.split("/").pop() ?? model).replace(/^text-embedding-/, "").replace(/:latest$/, "");
}

export interface TestResult {
	ok: boolean;
	steps: Array<{ name: string; ok: boolean; detail: string }>;
}

/** A site's AI (null: the default) and model, picked while allowing it. */
export interface SiteChoice {
	agent?: string | null;
	model?: string;
}

/** What a site's `leuria://connect` link carries. */
export interface ConnectLink {
	origin: string;
	app?: string;
	nonce: string;
	needs?: SiteNeeds;
	/** The skills the site names, as the page wrote them: the engine checks and fetches them. */
	skills?: string[];
}

let ready: Promise<{ base: string; token: string }> | null = null;

/** Resolves once the engine has reported its port. */
function connection(): Promise<{ base: string; token: string }> {
	ready ??= new Promise((resolve) => {
		const done = (info: EngineInfo) => resolve({ base: `http://127.0.0.1:${info.port}`, token: info.token });
		void invoke<EngineInfo>("engine_info").then((info) => {
			if (info.port) return done(info);
			void listen("engine-ready", () => void invoke<EngineInfo>("engine_info").then(done));
		});
	});
	return ready;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
	const { base, token } = await connection();
	const res = await fetch(`${base}/admin${path}`, {
		method,
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const json = (await res.json().catch(() => ({}))) as T & { error?: string };
	// An unknown route: the window is newer than the engine (updated, not restarted).
	if (res.status === 404 && json.error === "Not found") throw new EngineOutdated();
	if (!res.ok) throw new Error(json.error ?? `Leuria engine error ${res.status}`);
	return json;
}

/** The engine predates this window: only a restart helps, and nothing should be undone meanwhile. */
export class EngineOutdated extends Error {
	constructor() {
		super("Leuria was updated. Restart it to finish.");
	}
}

/** What to tell the visitor about a failed engine call, or `fallback`. */
export function failureText(error: unknown, fallback: string): string {
	return error instanceof EngineOutdated ? error.message : fallback;
}

export const engine = {
	status: () => call<Status>("GET", "/status"),
	agents: () => call<{ agents: AgentChoice[] }>("GET", "/agents").then((r) => r.agents),
	/** Make an AI the default (sets it up if needed, and adds it to Your AIs). */
	chooseAgent: (id: string) => call<{ id: string; name: string }>("POST", "/agent", { id }),
	/** Your AIs: the ones set up, the default first. Nothing is started. */
	ais: () => call<{ ais: YourAi[] }>("GET", "/ais").then((r) => r.ais),
	/** Set up another AI (installs an agent) without changing the default. */
	addAi: (id: string) => call<{ id: string; name: string }>("POST", "/ais", { id }),
	/** Take an AI off Your AIs; its sites go back to the default. */
	removeAi: (id: string) => call<{ removed: string }>("DELETE", `/ais?id=${encodeURIComponent(id)}`),
	/** Sign-in state of `agent`, or of the default AI. */
	signInStatus: (agent?: string) => call<SignInStatus>("GET", `/signin${agent ? `?agent=${encodeURIComponent(agent)}` : ""}`),
	signIn: (methodId?: string, agent?: string) => call<SignInStatus>("POST", "/signin", { methodId, agent }),
	/** Stop the sign-in in progress (the agent's login waits for the browser). */
	cancelSignIn: () => call<{ ok: boolean }>("POST", "/signin/cancel"),
	/** Models an AI offers (the default AI's without `agent`); null when it offers no choice. */
	models: (agent?: string) =>
		call<{ agent: string; models: AgentModels | null }>("GET", `/models${agent ? `?agent=${encodeURIComponent(agent)}` : ""}`).then((r) => r.models),
	/** Ask an AI again which models it offers (starts an agent for a moment). `stale`: it didn't answer, so these are the ones it last listed. */
	refreshModels: (agent: string) =>
		call<{ agent: string; models: AgentModels | null; stale?: boolean }>("GET", `/models?agent=${encodeURIComponent(agent)}&refresh=1`),
	/** Use another model for one site (`null`: its AI's own choice). */
	setSiteModel: (origin: string, model: string | null) => call<{ ok: boolean }>("POST", "/sites/model", { origin, model }),
	/** The model to use with an agent (`null`: the agent's default). Applies to the next conversations. */
	setAgentModel: (id: string, model: string | null) => call<{ ok: boolean }>("POST", "/agent/model", { id, model }),
	/** Forget an AI that failed (its install and Leuria's sign-in), so a new try starts fresh. */
	resetAgent: (id: string) => call<{ ok: boolean }>("POST", "/agent/reset", { id }),
	sites: () => call<{ sites: Site[] }>("GET", "/sites").then((r) => r.sites),
	/** Add an OpenAI-compatible API; the engine tests it first and returns its models. */
	addProvider: (name: string, baseUrl: string, apiKey?: string) =>
		call<{ id: string; name: string; models: Array<{ id: string }> }>("POST", "/providers", { name, baseUrl, apiKey }),
	/** Use another AI for one site (`null`: back to the default). Installs it if needed. */
	setSiteAgent: (origin: string, agent: string | null) =>
		call<{ origin: string; agent: string | null; signIn: SignInStatus }>("POST", "/sites/agent", { origin, agent }),
	disconnect: (origin: string) => call<{ removed: boolean }>("DELETE", `/sites?origin=${encodeURIComponent(origin)}`),
	pairing: () => call<{ requests: PairingRequest[] }>("GET", "/pairing").then((r) => r.requests),
	/** Allow or refuse a site; on Allow, optionally its AI (null: the default) and model from the first message. */
	decide: (requestId: string, allow: boolean, choice: SiteChoice = {}) => call<{ ok: boolean }>("POST", `/pairing/${requestId}`, { allow, ...choice }),
	/** How Your AIs fit a site: the needs of a request being approved, or those of a connected site. */
	fit: (of: { needs?: SiteNeeds; origin?: string }) => call<Fit>("POST", "/fit", of),
	/** A leuria://connect link reached the app: the engine asks the visitor (a `pairing` event follows). */
	link: (link: ConnectLink) => call<{ requestId: string }>("POST", "/pairing/link", link),
	/** A real question to an AI (the default one without `agent`). */
	test: (agent?: string) => call<TestResult>("POST", "/test", agent ? { agent } : {}),
	/** Search models on this computer, and the one sites get. */
	searchModels: () => call<SearchModels>("GET", "/embeddings"),
	setSearchModel: (choice: SearchChoice) => call<{ choice: SearchChoice }>("POST", "/embeddings", { choice }),
};

/** Engine events relayed by the Rust shell: pairing, pairing-decided, progress, exit… */
export function onEngine<T = Record<string, unknown>>(name: string, handler: (payload: T) => void): () => void {
	let unlisten: (() => void) | undefined;
	let cancelled = false;
	void listen<T>(name, (event) => handler(event.payload)).then((fn) => {
		if (cancelled) fn();
		else unlisten = fn;
	});
	return () => {
		cancelled = true;
		unlisten?.();
	};
}

/** Plain names for well-known agents; the registry name otherwise. */
export function friendlyName(agent: Pick<AgentChoice, "id" | "name">): string {
	// LLM models already come as "model · Provider".
	if (agent.id.startsWith("llm:")) return agent.name;
	const names: Record<string, string> = {
		"codex-acp": "ChatGPT (Codex)",
		"claude-acp": "Claude",
		gemini: "Gemini",
		"github-copilot-cli": "GitHub Copilot",
	};
	return names[agent.id] ?? agent.name;
}

/** One plain line under an AI's name: what the visitor gets, never jargon. */
export function describeAgent(agent: Pick<AgentChoice, "id" | "found" | "kind" | "local" | "provider">): string {
	if (agent.kind === "llm") return agent.local ? "On this computer: private and free" : `Your AI service · ${agent.provider?.name ?? ""}`;
	if (agent.found) return "Found on this computer";
	const lines: Record<string, string> = {
		"codex-acp": "Sign in with your ChatGPT account",
		"claude-acp": "Uses your Claude sign-in",
		gemini: "Google ended its sign-in: use an API key",
		"github-copilot-cli": "Sign in with your GitHub account",
	};
	return lines[agent.id] ?? "Leuria sets it up for you";
}

/** The check's results in the visitor's words. */
export function describeCheck(index: number, ok: boolean): string {
	const lines = [
		["Your AI answers websites", "Your AI didn't answer"],
		["Your AI can't touch your files", "Your AI could reach more than the website allows"],
	];
	return lines[index]?.[ok ? 0 : 1] ?? (ok ? "Passed" : "Failed");
}

/** A sign-in button's words: "Sign in with ChatGPT", or the AI's own when it already says it ("Log in with Google"). */
export function signInLabel(method: { name: string }): string {
	return /^(log|sign)\s?in\b/i.test(method.name.trim()) ? method.name.trim() : `Sign in with ${method.name}`;
}

/**
 * What Leuria is doing, in the visitor's words. The engine only says which
 * stage it is in; its own messages (versions, registries, commands) are for
 * the command line and never shown here.
 */
export function activityText(activity: string, name: string): string {
	if (activity === "install") return `Getting ${name} ready. The first time can take a minute.`;
	if (activity === "check-1") return `Asking ${name} a first question…`;
	if (activity === "check-2") return "Making sure it can't reach your files…";
	return "Setting it up…";
}

/**
 * An AI's own reason, when it reads as a sentence for people ("This client
 * is no longer supported…"); codes and technical errors are left out.
 */
export function plainReason(detail: string | undefined): string | null {
	const text = (detail ?? "").trim();
	if (text.split(/\s+/).length < 6) return null;
	if (/\b(params|ENOENT|EACCES|stack|exit code|npm|registry|ACP|JSON|undefined|null)\b|[{}\[\]]|Error:/i.test(text)) return null;
	return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Where Leuria waits when its window is closed, in the words of the visitor's system. */
export const trayName = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent) ? "menu bar" : "system tray";
