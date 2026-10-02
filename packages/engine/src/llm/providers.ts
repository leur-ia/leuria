/**
 * LLM providers: LM Studio and Ollama on this computer, and any
 * OpenAI-compatible API (the visitor's own key, a company gateway…).
 *
 * An AI id for an LLM is `llm:<providerId>` (the service is the AI; its
 * model is chosen like an agent's, in config.json `models`), or, from
 * before, `llm:<providerId>/<model>` with the model fixed, e.g.
 * `llm:ollama/qwen3:8b`. `lmstudio` and `ollama` exist without
 * configuration, at their default local URLs.
 */

import { homePath, readJson, writeJson } from "../home.js";

type LlmKind = "lmstudio" | "ollama" | "openai";

export interface LlmProvider {
	id: string;
	kind: LlmKind;
	/** Shown to the visitor: "LM Studio", "Ollama", or the name they gave. */
	name: string;
	/** OpenAI-compatible base URL, ending in `/v1`. */
	baseUrl: string;
	apiKey?: string;
}

interface LlmModel {
	id: string;
	/** LM Studio reports whether the model is loaded in memory. */
	loaded?: boolean;
	/** Ollama cloud models run on ollama.com, not on this computer. */
	remote?: boolean;
	/** What the service says about the model, when it says (LM Studio, Ollama): for guiding the choice. */
	meta?: {
		/** Trained to call tools. */
		tools?: boolean;
		/** Reads images. */
		images?: boolean;
		/** Longest context, in tokens. */
		context?: number;
		/** Size, in billions of parameters. */
		params?: number;
	};
}

/** "27B", "8.0B", "1.5B", "8x7B" → billions of parameters. */
export function parseParams(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const moe = /^(\d+)x(\d+(?:\.\d+)?)\s*B$/i.exec(value.trim());
	if (moe) return Number(moe[1]) * Number(moe[2]);
	const plain = /^(\d+(?:\.\d+)?)\s*([BM])$/i.exec(value.trim());
	if (!plain) return undefined;
	return plain[2]!.toUpperCase() === "M" ? Number(plain[1]) / 1000 : Number(plain[1]);
}

const BUILTIN: LlmProvider[] = [
	{ id: "lmstudio", kind: "lmstudio", name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
	{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
];

/** Embedding models cannot chat: recognised by name, since servers rarely say. */
export const EMBEDDING = /embed|e5-|bge-|gte-|nomic-embed|jina-embed|mxbai-embed/i;

// ── Ids ────────────────────────────────────────────────────────────────

export function isLlmId(id: string): boolean {
	return id.startsWith("llm:");
}

export function llmId(providerId: string, model: string): string {
	return `llm:${providerId}/${model}`;
}

/** `llm:ollama/qwen3:8b` → { providerId: "ollama", model: "qwen3:8b" }; `llm:lmstudio` → { providerId: "lmstudio" } */
export function parseLlmId(id: string): { providerId: string; model?: string } | null {
	if (!isLlmId(id)) return null;
	const rest = id.slice(4);
	const slash = rest.indexOf("/");
	if (slash === -1) return rest ? { providerId: rest } : null;
	if (slash === 0 || slash === rest.length - 1) return null;
	return { providerId: rest.slice(0, slash), model: rest.slice(slash + 1) };
}

/** The model a service AI uses when none was chosen: one already loaded (it answers at once), else the first. */
export function defaultModel(models: LlmModel[]): string | undefined {
	return (models.find((m) => m.loaded) ?? models.find((m) => !m.remote) ?? models[0])?.id;
}

// ── Store (~/.leuria/providers.json) ────────────────────────────────────

function path(): string {
	return homePath("providers.json");
}

/** Providers the visitor added, plus LM Studio and Ollama (overridable). */
export function listProviders(): LlmProvider[] {
	const saved = readJson<{ providers?: LlmProvider[] }>(path())?.providers ?? [];
	const ids = new Set(saved.map((p) => p.id));
	return [...BUILTIN.filter((b) => !ids.has(b.id)), ...saved];
}

export function getProvider(id: string): LlmProvider | undefined {
	return listProviders().find((p) => p.id === id);
}

/** Add or replace a provider. Normalises the URL (Postel's Law). */
export function saveProvider(input: { id?: string; kind?: LlmKind; name: string; baseUrl: string; apiKey?: string }): LlmProvider {
	const baseUrl = normalizeBaseUrl(input.baseUrl);
	const id = input.id ?? slug(input.name);
	if (!id) throw new Error("A name is required");
	const provider: LlmProvider = {
		id,
		kind: input.kind ?? "openai",
		name: input.name.trim(),
		baseUrl,
		...(input.apiKey?.trim() ? { apiKey: input.apiKey.trim() } : {}),
	};
	const saved = (readJson<{ providers?: LlmProvider[] }>(path())?.providers ?? []).filter((p) => p.id !== id);
	writeJson(path(), { providers: [...saved, provider] });
	return provider;
}

export function removeProvider(id: string): boolean {
	const saved = readJson<{ providers?: LlmProvider[] }>(path())?.providers ?? [];
	const kept = saved.filter((p) => p.id !== id);
	if (kept.length === saved.length) return false;
	writeJson(path(), { providers: kept });
	return true;
}

/** `localhost:1234` → `http://localhost:1234/v1`; trims spaces and trailing slashes; keeps a versioned path. */
export function normalizeBaseUrl(url: string): string {
	let value = url.trim().replace(/\/+$/, "");
	if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
	const parsed = new URL(value);
	// Add `/v1` only when the address has no API version (Gemini's is `/v1beta/openai`).
	if (!/\/v\d+[a-z0-9]*(\/|$)/.test(parsed.pathname)) parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/v1`;
	return parsed.toString().replace(/\/+$/, "");
}

function slug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

// ── Discovery ───────────────────────────────────────────────────────────

export function authHeaders(provider: LlmProvider): Record<string, string> {
	return provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {};
}

/** Chat models the provider offers. Throws a plain-language error when unreachable. */
export async function listModels(provider: LlmProvider, timeoutMs = 3000): Promise<LlmModel[]> {
	// LM Studio's native API says which models are LLMs and which are loaded.
	if (provider.kind === "lmstudio") {
		const root = provider.baseUrl.replace(/\/v\d+$/, "");
		type Native = {
			key: string;
			type: string;
			loaded_instances?: unknown[];
			params_string?: string | null;
			max_context_length?: number;
			capabilities?: { vision?: boolean; trained_for_tool_use?: boolean };
		};
		const native = await fetch(`${root}/api/v1/models`, { headers: authHeaders(provider), signal: AbortSignal.timeout(timeoutMs) })
			.then((r) => (r.ok ? (r.json() as Promise<{ models?: Native[] }>) : null))
			.catch(() => null);
		if (native?.models) {
			return native.models
				.filter((m) => m.type === "llm")
				.map((m) => ({
					id: m.key,
					loaded: (m.loaded_instances?.length ?? 0) > 0,
					meta: {
						tools: m.capabilities?.trained_for_tool_use,
						images: m.capabilities?.vision,
						context: m.max_context_length,
						params: parseParams(m.params_string),
					},
				}));
		}
	}
	// Ollama's native API marks cloud models with `remote_host`.
	let remote = new Set<string>();
	const sizes = new Map<string, number>();
	if (provider.kind === "ollama") {
		const root = provider.baseUrl.replace(/\/v\d+$/, "");
		const tags = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) })
			.then((r) => (r.ok ? (r.json() as Promise<{ models?: Array<{ name: string; remote_host?: string; details?: { parameter_size?: string } }> }>) : null))
			.catch(() => null);
		remote = new Set((tags?.models ?? []).filter((m) => m.remote_host).map((m) => m.name));
		for (const m of tags?.models ?? []) {
			const params = parseParams(m.details?.parameter_size);
			if (params) sizes.set(m.name, params);
		}
	}
	let res: Response;
	try {
		res = await fetch(`${provider.baseUrl}/models`, { headers: authHeaders(provider), signal: AbortSignal.timeout(timeoutMs) });
	} catch {
		throw new Error(unreachable(provider));
	}
	if (res.status === 401 || res.status === 403) throw new Error(`${provider.name} refused the API key.`);
	// Plain words: the visitor sees these in the app.
	if (res.status === 404) throw new Error(`Nothing answered at ${provider.baseUrl}. Check the address, then try again.`);
	if (!res.ok) throw new Error(`${provider.name} had a problem. Try again in a moment.`);
	const body = (await res.json().catch(() => null)) as { data?: Array<{ id?: unknown; type?: unknown }> } | null;
	if (!Array.isArray(body?.data)) throw new Error(`That address doesn't look like an AI service. Check it, then try again.`);
	return body.data
		.filter((m): m is { id: string; type?: unknown } => typeof m.id === "string")
		.filter((m) => m.type !== "embedding" && !EMBEDDING.test(m.id))
		.map((m) => ({
			id: m.id,
			...(remote.has(m.id) ? { remote: true } : {}),
			...(sizes.has(m.id) ? { meta: { params: sizes.get(m.id) } } : {}),
		}));
}

/** "Couldn't reach LM Studio. Open it, then try again." */
export function unreachable(provider: LlmProvider): string {
	if (provider.kind === "lmstudio") return "Couldn't reach LM Studio. Open it and start its local server, then try again.";
	if (provider.kind === "ollama") return "Couldn't reach Ollama. Open it, then try again.";
	return `Couldn't reach ${provider.name} at ${provider.baseUrl}.`;
}

interface DetectedLlm {
	provider: LlmProvider;
	running: boolean;
	models: LlmModel[];
	error?: string;
}

/** LM Studio, Ollama and the visitor's own providers, with their chat models. */
export async function detectLlms(): Promise<DetectedLlm[]> {
	return Promise.all(
		listProviders().map(async (provider) => {
			try {
				return { provider, running: true, models: await listModels(provider, 1500) };
			} catch (error) {
				return { provider, running: false, models: [], error: error instanceof Error ? error.message : String(error) };
			}
		}),
	);
}

/** "LM Studio" for a service AI, "qwen3:8b · Ollama" for one with its model fixed. */
export function llmDisplayName(id: string): string {
	const parsed = parseLlmId(id);
	if (!parsed) return id;
	const provider = getProvider(parsed.providerId);
	if (!parsed.model) return provider?.name ?? parsed.providerId;
	const model = parsed.model.split("/").pop() ?? parsed.model;
	return `${model} · ${provider?.name ?? parsed.providerId}`;
}
