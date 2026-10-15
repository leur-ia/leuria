/**
 * Decisions for sites, from a System One model: one that writes no text
 * but answers typed questions about an input with a choice, a score or a
 * probability. Like embeddings, a model on this computer first (LM Studio,
 * Ollama and oMLX serve `/v1/systemone`: nimble, tev1, clef, openjev…); or
 * a service the visitor set up: TypeSafe's Jev with their key, or any
 * other speaking the same API.
 *
 *   POST /decide   { state, questions, model? }  →  { model, answers, usage? }
 *
 * The request and the answer are System One's own shapes, passed through
 * to `<baseUrl>/systemone`.
 */

import { type DecideChoice, loadConfig } from "../home.js";
import { authHeaders, isLocal, type LlmProvider, listProviders, normalizeBaseUrl } from "./providers.js";

export const DEFAULT_DECISION_URL = "https://api.typesafe.ai/v1";
export const DEFAULT_DECISION_MODEL = "jev-latest";

/** Decision models are recognised by name where the service doesn't say (Ollama, oMLX); LM Studio reports `type: "decision"`. */
// ponytail: name regex, drop it when every service reports a capability.
export const DECISION = /(^|[/_-])(nimble|tev1|clef|openjev|jev|laya|lev|kev|julia-1|d3)(?=$|[:/_.-])/i;

/** A System One-compatible service: TypeSafe, or another at its own address. */
export interface DecisionService {
	/** Base URL ending in `/v1`; the request goes to `/systemone` under it. */
	baseUrl: string;
	apiKey?: string;
	/** The service's model to ask; `jev-latest` (TypeSafe's) when unset. */
	model?: string;
}

/** Where a site's decisions go now. */
export interface Decider extends DecisionService {
	model: string;
	/** "Ollama", "TypeSafe", or the service's address. */
	name: string;
	/** Runs on this computer: the request never leaves it. */
	local: boolean;
	provider?: LlmProvider;
}

export type Question =
	| { type: "noul"; instructions: unknown; criteria?: { true?: unknown; false?: unknown } }
	| { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
	| { type: "score"; instructions: unknown; criteria: unknown[] };

export interface DecideRequest {
	state: unknown;
	questions: Record<string, Question>;
	model?: string;
}

export interface DecideResponse {
	model: string;
	answers: Record<string, unknown>;
	usage?: { input_tokens?: number | null; output_tokens?: number | null };
}

export interface Decisions {
	/** The decision model `origin` (or every site) gets now, if any. Cheap: cached for a few seconds. */
	find: (origin?: string) => Promise<Decider | undefined>;
	decide: (request: DecideRequest, signal?: AbortSignal, origin?: string) => Promise<DecideResponse>;
}

export class NoDecisionModelError extends Error {
	constructor() {
		super("No decision model on this computer. Load one in LM Studio or Ollama (nimble, for example), or set up a decision service in Leuria.");
		this.name = "NoDecisionModelError";
	}
}

/** The decision service refused the request (a bad question, a bad key…): its words, with its status. */
export class DecisionRefusedError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "DecisionRefusedError";
	}
}

const MAX_QUESTIONS = 50;
const MAX_STATE_CHARS = 60_000;
const QUESTION_TYPES = new Set(["noul", "choice", "score"]);

/** Validate `POST /decide`'s body. Throws on bad input. */
export function parseDecideBody(body: unknown): DecideRequest {
	const { state, questions, model } = (body ?? {}) as { state?: unknown; questions?: unknown; model?: unknown };
	if (state === undefined || state === null || state === "") throw new Error("state is required: a string, an object or an array");
	if (typeof state !== "string" && typeof state !== "object") throw new Error("state must be a string, an object or an array");
	if (JSON.stringify(state).length > MAX_STATE_CHARS) throw new Error(`state is over ${MAX_STATE_CHARS} characters`);
	if (!questions || typeof questions !== "object" || Array.isArray(questions)) throw new Error("questions must be an object of question id → question");
	const entries = Object.entries(questions as Record<string, unknown>);
	if (entries.length === 0) throw new Error("questions must have at least one question");
	if (entries.length > MAX_QUESTIONS) throw new Error(`At most ${MAX_QUESTIONS} questions per request`);
	for (const [id, q] of entries) {
		const { type, instructions, criteria } = (q ?? {}) as { type?: unknown; instructions?: unknown; criteria?: unknown };
		if (typeof type !== "string" || !QUESTION_TYPES.has(type)) throw new Error(`questions.${id}.type must be "noul", "choice" or "score"`);
		if (instructions === undefined || instructions === null || instructions === "") throw new Error(`questions.${id}.instructions is required`);
		if (type === "choice" && (!criteria || typeof criteria !== "object" || Array.isArray(criteria) || Object.keys(criteria).length < 2)) {
			throw new Error(`questions.${id}.criteria must map at least two options to their descriptions`);
		}
		if (type === "score" && (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 10)) {
			throw new Error(`questions.${id}.criteria must list 2 to 10 levels, low to high`);
		}
	}
	if (model !== undefined && (typeof model !== "string" || !model)) throw new Error("model must be a string");
	return { state, questions: questions as Record<string, Question>, ...(model ? { model } : {}) };
}

/** Ask a System One service. Throws {@link DecisionRefusedError} on a non-2xx answer. */
export async function askSystemOne(service: DecisionService, request: DecideRequest, signal?: AbortSignal, timeoutMs = 120_000): Promise<DecideResponse> {
	let res: Response;
	try {
		res = await fetch(`${service.baseUrl}/systemone`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...(service.apiKey ? { Authorization: `Bearer ${service.apiKey}` } : {}) },
			body: JSON.stringify({ ...request, model: request.model ?? DEFAULT_DECISION_MODEL }),
			signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		if (signal?.aborted) throw error;
		throw new Error(`The decision service at ${service.baseUrl} can't be reached.`);
	}
	const body = (await res.json().catch(() => ({}))) as Partial<DecideResponse> & { error?: string | { message?: string }; message?: string };
	if (!res.ok) {
		const error = typeof body.error === "object" ? body.error.message : body.error;
		throw new DecisionRefusedError(res.status, error ?? body.message ?? `The decision service answered ${res.status}`);
	}
	if (typeof body.model !== "string" || !body.answers || typeof body.answers !== "object") throw new Error("The decision service answered without answers");
	return { model: body.model, answers: body.answers, ...(body.usage ? { usage: body.usage } : {}) };
}

/** The service's base URL from what the visitor typed: `localhost:8000`, `…/v1`, or the endpoint itself (`…/v1/systemone`). */
export function decisionBaseUrl(url: string): string {
	return normalizeBaseUrl(url.trim().replace(/\/+$/, "").replace(/\/systemone$/i, ""));
}

export interface ProbeResult {
	baseUrl: string;
	/** The service's models, the ones that look like decision models first. */
	models: Array<{ id: string; decision: boolean }>;
	/** A real question to `model` (the given one, else the first decision model): how it went. */
	tried?: { model: string; ok: boolean; ms: number; error?: string };
}

/** Look at a service before saving it: list its models, and try one. Throws when the service can't be reached or refuses the key. */
export async function probeService(service: DecisionService, timeoutMs = 30_000): Promise<ProbeResult> {
	let res: Response;
	try {
		res = await fetch(`${service.baseUrl}/models`, {
			headers: service.apiKey ? { Authorization: `Bearer ${service.apiKey}` } : {},
			signal: AbortSignal.timeout(Math.min(timeoutMs, 8000)),
		});
	} catch {
		throw new Error(`Nothing answered at ${service.baseUrl}. Check the address, and that the service is running.`);
	}
	const body = (await res.json().catch(() => null)) as { data?: Array<{ id?: unknown }>; error?: string | { message?: string } } | null;
	if (res.status === 401 || res.status === 403) throw new Error(`${service.baseUrl} wants an API key${service.apiKey ? " (not this one)" : ""}.`);
	if (!res.ok) throw new Error(typeof body?.error === "object" ? (body.error.message ?? `The service answered ${res.status}`) : (body?.error ?? `The service answered ${res.status}`));
	const ids = Array.isArray(body?.data) ? body.data.map((m) => m.id).filter((id): id is string => typeof id === "string") : [];
	const models = ids.map((id) => ({ id, decision: DECISION.test(id) })).sort((a, b) => Number(b.decision) - Number(a.decision));
	const model = service.model ?? models.find((m) => m.decision)?.id;
	if (!model) return { baseUrl: service.baseUrl, models };
	const started = Date.now();
	try {
		await askSystemOne({ ...service, model }, { state: "ok", questions: { works: { type: "noul", instructions: "Is the state the word ok?" } }, model }, undefined, timeoutMs);
		return { baseUrl: service.baseUrl, models, tried: { model, ok: true, ms: Date.now() - started } };
	} catch (error) {
		return { baseUrl: service.baseUrl, models, tried: { model, ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) } };
	}
}

// ── Models on this computer ─────────────────────────────────────────────

interface DecisionModel {
	id: string;
	/** LM Studio reports whether it is loaded in memory. */
	loaded?: boolean;
}

/** Decision models of a local service, loaded ones first. Empty when it isn't running. */
async function listDecisionModels(provider: LlmProvider, timeoutMs = 1500): Promise<DecisionModel[]> {
	const root = provider.baseUrl.replace(/\/v\d+$/, "");
	const get = <T>(url: string) =>
		fetch(url, { headers: authHeaders(provider), signal: AbortSignal.timeout(timeoutMs) })
			.then((r) => (r.ok ? (r.json() as Promise<T>) : null))
			.catch(() => null);
	if (provider.kind === "lmstudio") {
		const native = await get<{ models?: Array<{ key: string; type: string; loaded_instances?: unknown[] }> }>(`${root}/api/v1/models`);
		if (native?.models) {
			return native.models
				.filter((m) => m.type === "decision" || DECISION.test(m.key))
				.map((m) => ({ id: m.key, loaded: (m.loaded_instances?.length ?? 0) > 0 }))
				.sort((a, b) => Number(b.loaded) - Number(a.loaded));
		}
	}
	if (provider.kind === "ollama") {
		const tags = await get<{ models?: Array<{ name: string; remote_host?: string }> }>(`${root}/api/tags`);
		return (tags?.models ?? []).filter((m) => !m.remote_host && DECISION.test(m.name)).map((m) => ({ id: m.name }));
	}
	const list = await get<{ data?: Array<{ id?: unknown; type?: unknown }> }>(`${provider.baseUrl}/models`);
	return (list?.data ?? [])
		.filter((m): m is { id: string; type?: unknown } => typeof m.id === "string")
		.filter((m) => m.type === "decision" || DECISION.test(m.id))
		.map((m) => ({ id: m.id }));
}

/** Every decision model on this computer, by service (LM Studio, Ollama). */
export async function listLocalDeciders(): Promise<Array<{ provider: LlmProvider; model: DecisionModel }>> {
	const found = await Promise.all(
		listProviders()
			.filter(isLocal)
			.map(async (provider) => (await listDecisionModels(provider)).map((model) => ({ provider, model }))),
	);
	return found.flat();
}

const CACHE_MS = 10_000;

function isLoopback(baseUrl: string): boolean {
	const host = new URL(baseUrl).hostname;
	return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

function localDecider(provider: LlmProvider, model: string): Decider {
	return { baseUrl: provider.baseUrl, ...(provider.apiKey ? { apiKey: provider.apiKey } : {}), model, name: provider.name, local: true, provider };
}

/**
 * Decisions from this computer or the visitor's service: the model they
 * chose (`config.decisions`, or a site's own choice), or the first one
 * found on this computer. A chosen model that isn't available now gives
 * nothing rather than another model: the visitor picked it.
 */
export function systemOneDecisions(choice: (origin?: string) => DecideChoice | undefined = () => loadConfig().decisions): Decisions {
	const cache = new Map<string, { at: number; value: Promise<Decider | undefined> }>();

	const find = (origin?: string) => {
		const chosen = choice(origin);
		const key = JSON.stringify(chosen ?? "auto");
		const cached = cache.get(key);
		if (!cached || Date.now() - cached.at > CACHE_MS) {
			const value = (async (): Promise<Decider | undefined> => {
				if (chosen === "off") return undefined;
				if (chosen && "baseUrl" in chosen) {
					const typesafe = chosen.baseUrl === DEFAULT_DECISION_URL;
					return { ...chosen, model: chosen.model ?? DEFAULT_DECISION_MODEL, name: typesafe ? "TypeSafe" : chosen.baseUrl, local: isLoopback(chosen.baseUrl) };
				}
				if (chosen) {
					const provider = listProviders().find((p) => p.id === chosen.provider);
					if (!provider || !isLocal(provider)) return undefined;
					const models = await listDecisionModels(provider);
					return models.some((m) => m.id === chosen.model) ? localDecider(provider, chosen.model) : undefined;
				}
				for (const provider of listProviders().filter(isLocal)) {
					const [model] = await listDecisionModels(provider);
					if (model) return localDecider(provider, model.id);
				}
				return undefined;
			})();
			cache.set(key, { at: Date.now(), value });
			return value;
		}
		return cached.value;
	};

	return {
		find,
		decide: async (request, signal, origin) => {
			const decider = await find(origin);
			if (!decider) throw new NoDecisionModelError();
			try {
				// The visitor's model is their pick; the page's `model` only counts for TypeSafe, whose names it knows.
				const typesafe = decider.baseUrl === DEFAULT_DECISION_URL;
				return await askSystemOne(decider, { ...request, model: typesafe ? (request.model ?? decider.model) : decider.model }, signal);
			} catch (error) {
				cache.clear();
				throw error;
			}
		},
	};
}
