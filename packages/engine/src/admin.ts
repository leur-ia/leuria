/**
 * Admin API for the desktop app (`leuria start --app`). The app starts
 * the engine with a random token and is the only caller that knows it.
 *
 *   GET    /admin/status              engine and agent summary (`agent.ready`: known to work, nothing started)
 *   GET    /admin/agents              ACP registry agents, installed and found on this computer
 *   GET    /admin/ais                 Your AIs: the ones set up, the default first (nothing is started)
 *   POST   /admin/ais     { id, makeDefault? } set up an AI (installs an agent) and add it to Your AIs
 *   DELETE /admin/ais?id=…            take an AI off Your AIs (not the default); its sites go back to the default
 *   POST   /admin/agent   { id }      make an AI the default (sets it up if needed)
 *   GET    /admin/signin[?agent=…]    is the visitor signed in to the (default) agent?
 *   POST   /admin/signin  { methodId?, agent? } sign in with an ACP agent method (opens the browser)
 *   POST   /admin/signin/cancel       stop a sign-in in progress
 *   GET    /admin/models?agent=…      models an agent offers (the default AI's without `agent`), with the chosen one as current
 *   POST   /admin/agent/model { id, model|null } the model to use with an agent (null: the agent's default)
 *   POST   /admin/agent/reset { id }  forget an agent that failed (install and Leuria's sign-in), to start over
 *   GET    /admin/sites               connected sites, each with its AI override and declared needs if any
 *   POST   /admin/fit     { needs?, origin? } how Your AIs and their models fit a site's needs, and the one to recommend
 *   GET    /admin/providers           LLM providers (LM Studio, Ollama, APIs) with their models
 *   POST   /admin/providers { name, baseUrl, apiKey? } add or update an OpenAI-compatible API (tested first)
 *   DELETE /admin/providers?id=…      remove one
 *   POST   /admin/sites/agent { origin, agent|null } use another AI for one site (installs it)
 *   POST   /admin/sites/model { origin, model|null } use another model for one site (for the site's AI)
 *   DELETE /admin/sites?origin=…      disconnect a site
 *   GET    /admin/pairing             sites waiting for approval
 *   POST   /admin/pairing/link { origin, app?, nonce, needs? } a leuria://connect link reached the app: ask the visitor
 *   POST   /admin/pairing/:id { allow, agent?, model? } approve or refuse a site; on Allow, optionally its AI (null: the default) and model
 *   POST   /admin/test  { agent? }    real round trip with an AI, the default one without `agent` (`leuria test`)
 *   GET    /admin/embeddings          embedding models on this computer, the choice, and the one sites get now
 *   POST   /admin/embeddings { choice: "auto" | "off" | { provider, model } } the embedding model sites get
 */

import type * as http from "node:http";

import { agentName, ensureAgent, isAvailable, listAgents, resetAgent } from "./agents.js";
import { detectLlms, getProvider, isLlmId, listModels, llmId, normalizeBaseUrl, parseLlmId, removeProvider, saveProvider } from "./llm/providers.js";
import { agentModels, checkSignIn, seenAgentModels, signIn } from "./auth.js";
import { type Candidate, fitOf, reasonFor, recommend, traitsOf, type Verdict } from "./fit.js";
import { parseNeeds, type SiteNeeds } from "./needs.js";
import { detectInstalledClis } from "./detect.js";
import type { GrantStore } from "./grants.js";
import { addAi, providerInUse, removeAi, yourAis } from "./ais.js";
import { type EmbedChoice, type EngineConfig, isKnownReady, loadConfig, saveConfig } from "./home.js";
import { listLocalEmbedders, localEmbeddings } from "./llm/embeddings.js";
import { parseBody, sendJson } from "./http-utils.js";
import type { Logger } from "./logger.js";
import type { Pairing } from "./pairing.js";
import { runSelfTest } from "./self-test.js";
import type { SessionManager } from "./session-manager.js";
import { resolveAgentCommand } from "./agents.js";
import { VERSION } from "./version.js";

export interface AdminContext {
	/** Mutable: choosing an agent changes it for the next sessions. */
	config: EngineConfig;
	grants: GrantStore;
	logger: Logger;
	port: () => number;
	/** Tell the app something changed (JSON line on stdout). */
	emit: (event: Record<string, unknown>) => void;
}

export function createAdminHandler(ctx: AdminContext) {
	// The sign-in in progress, if any: the visitor may cancel it.
	let signingIn: AbortController | null = null;
	let signingInAgent = "";
	return async (
		req: http.IncomingMessage,
		res: http.ServerResponse,
		pathname: string,
		pairing: Pairing,
		sessions?: Pick<SessionManager, "closeWhere">,
	): Promise<boolean> => {
		/** The AI a site uses now: its own, or the default. */
		const siteAi = (origin: string) => ctx.grants.get(origin)?.agent ?? ctx.config.agent;
		const method = req.method ?? "GET";
		const route = `${method} ${pathname.replace(/^\/admin/, "")}`;

		if (route === "GET /status") {
			sendJson(res, 200, {
				version: VERSION,
				port: ctx.port(),
				agent: {
					id: ctx.config.agent,
					name: agentName(ctx.config.agent),
					installed: isAvailable(ctx.config.agent) ? (isLlmId(ctx.config.agent) ? "llm" : "agent") : null,
					// Known to work, so the app need not start it to check (LLMs are checked on use).
					ready: isAvailable(ctx.config.agent) && (isLlmId(ctx.config.agent) || isKnownReady(ctx.config.agent)),
				},
				sites: ctx.grants.list().length,
				pairing: pairing.pending(),
			});
			return true;
		}
		if (route === "GET /agents") {
			const found = new Set(detectInstalledClis());
			const [registry, llms] = await Promise.all([listAgents(), detectLlms()]);
			const agents = registry.map((a) => ({
				id: a.id,
				kind: "agent" as const,
				name: a.name,
				version: a.version,
				description: a.description,
				icon: a.icon,
				installed: a.installed ?? null,
				found: found.has(a.id),
				current: a.id === ctx.config.agent,
			}));
			// Every chat model of every reachable LLM provider is a choice of its own.
			const models = llms.flatMap(({ provider, running, models: list }) =>
				running
					? list.map((m) => ({
							id: llmId(provider.id, m.id),
							kind: "llm" as const,
							name: agentName(llmId(provider.id, m.id)),
							provider: { id: provider.id, kind: provider.kind, name: provider.name },
							model: m.id,
							loaded: m.loaded ?? null,
							local: provider.kind !== "openai" && !m.remote,
							installed: "llm",
							found: provider.kind !== "openai" && !m.remote,
							current: llmId(provider.id, m.id) === ctx.config.agent,
						}))
					: [],
			);
			sendJson(res, 200, { agents: [...models, ...agents] });
			return true;
		}
		if (route === "GET /providers") {
			const llms = await detectLlms();
			sendJson(res, 200, {
				providers: llms.map(({ provider, running, models, error }) => ({
					id: provider.id,
					kind: provider.kind,
					name: provider.name,
					baseUrl: provider.baseUrl,
					hasApiKey: Boolean(provider.apiKey),
					running,
					models,
					error,
				})),
			});
			return true;
		}
		if (route === "POST /providers") {
			const body = (await parseBody(req)) as { id?: unknown; name?: unknown; baseUrl?: unknown; apiKey?: unknown };
			if (typeof body.name !== "string" || !body.name.trim() || typeof body.baseUrl !== "string" || !body.baseUrl.trim()) {
				sendJson(res, 400, { error: "A name and an address are required." });
				return true;
			}
			let baseUrl: string;
			try {
				baseUrl = normalizeBaseUrl(body.baseUrl);
			} catch {
				sendJson(res, 400, { error: "That address doesn't look right. Try something like https://api.example.com/v1." });
				return true;
			}
			const candidate = {
				id: typeof body.id === "string" && body.id ? body.id : undefined,
				kind: "openai" as const,
				name: body.name,
				baseUrl,
				apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
			};
			// Test before saving: the visitor learns at once if the address or key is wrong.
			let models: Awaited<ReturnType<typeof listModels>>;
			try {
				models = await listModels({ ...candidate, id: candidate.id ?? "test", name: candidate.name.trim() }, 8000);
			} catch (error) {
				sendJson(res, 422, { error: error instanceof Error ? error.message : String(error) });
				return true;
			}
			const provider = saveProvider(candidate);
			sendJson(res, 200, { id: provider.id, name: provider.name, baseUrl: provider.baseUrl, models });
			return true;
		}
		if (route === "DELETE /providers") {
			const id = new URL(req.url ?? "", "http://127.0.0.1").searchParams.get("id");
			sendJson(res, 200, { removed: id ? removeProvider(id) : false });
			return true;
		}
		if (route === "GET /ais") {
			const siteAgents = ctx.grants.list().flatMap((g) => (g.agent ? [g.agent] : []));
			const ais = yourAis(ctx.config.agent, siteAgents).map((id) => {
				const llm = parseLlmId(id);
				const provider = llm ? getProvider(llm.providerId) : undefined;
				return {
					id,
					kind: llm ? ("llm" as const) : ("agent" as const),
					name: agentName(id),
					default: id === ctx.config.agent,
					ready: Boolean(llm) || isKnownReady(id),
					...(llm && provider
						? { provider: { id: provider.id, kind: provider.kind, name: provider.name }, model: llm.model, local: provider.kind !== "openai" }
						: {}),
				};
			});
			sendJson(res, 200, { ais });
			return true;
		}
		if (route === "POST /ais" || route === "POST /agent") {
			const body = (await parseBody(req)) as { id?: unknown; makeDefault?: unknown };
			if (typeof body.id !== "string" || !body.id) {
				sendJson(res, 400, { error: "id is required" });
				return true;
			}
			if (isLlmId(body.id) && !isAvailable(body.id)) {
				sendJson(res, 404, { error: "This AI is not available. Choose it again." });
				return true;
			}
			// LLMs need no install; agents come from the ACP registry.
			const agent = isLlmId(body.id)
				? { id: body.id, name: agentName(body.id), version: "" }
				: await ensureAgent(body.id, { onProgress: (message) => ctx.emit({ event: "progress", stage: "install", message }) });
			addAi(body.id);
			if (route === "POST /agent" || body.makeDefault === true) {
				// The previous default stays one of Your AIs.
				if (ctx.config.agent !== body.id && isAvailable(ctx.config.agent)) addAi(ctx.config.agent);
				// Sites that picked this AI now simply use the default (their model choice still applies).
				for (const grant of ctx.grants.list()) if (grant.agent === body.id) ctx.grants.setAgent(grant.origin, undefined);
				ctx.config.agent = body.id;
				// Conversations on the default end: the next message uses the new default.
				sessions?.closeWhere((origin) => !ctx.grants.get(origin)?.agent);
				// Save only the choice: a one-off --port must not become the default.
				saveConfig({ ...loadConfig(), agent: body.id });
				ctx.emit({ event: "agent", id: agent.id, name: agent.name });
			}
			sendJson(res, 200, { id: agent.id, name: agent.name, version: agent.version });
			return true;
		}
		if (route === "DELETE /ais") {
			const id = new URL(req.url ?? "", "http://127.0.0.1").searchParams.get("id");
			if (!id) {
				sendJson(res, 400, { error: "id is required" });
				return true;
			}
			if (id === ctx.config.agent) {
				sendJson(res, 409, { error: "Make another AI the default first." });
				return true;
			}
			removeAi(id);
			// Its sites go back to the default, with the default's model.
			for (const grant of ctx.grants.list()) {
				if (grant.agent === id) ctx.grants.setAgent(grant.origin, undefined);
				if (grant.model?.agent === id) ctx.grants.setModel(grant.origin, undefined);
			}
			if (isLlmId(id)) {
				// The service's address and key go too, unless something else still uses it.
				const provider = parseLlmId(id)?.providerId;
				if (provider && !providerInUse(provider, ctx.config.agent)) removeProvider(provider);
			} else {
				// A sign-in still waiting would hold the files being erased.
				if (signingInAgent === id) {
					signingIn?.abort();
					signingIn = null;
				}
				// Its install and the sign-in Leuria keeps for it (never the visitor's own app's sign-in).
				resetAgent(id);
			}
			sendJson(res, 200, { removed: id });
			return true;
		}
		if (route === "GET /signin") {
			const agent = new URL(req.url ?? "", "http://127.0.0.1").searchParams.get("agent") ?? ctx.config.agent;
			// Checking never installs: onboarding chooses the agent first.
			if (!isAvailable(agent)) {
				sendJson(res, 200, { ok: false, detail: "no AI chosen yet", methods: [] });
				return true;
			}
			sendJson(res, 200, await checkSignIn(agent));
			return true;
		}
		if (route === "POST /signin") {
			const body = (await parseBody(req)) as { methodId?: unknown; agent?: unknown };
			signingIn?.abort();
			const controller = new AbortController();
			signingIn = controller;
			signingInAgent = typeof body.agent === "string" && body.agent ? body.agent : ctx.config.agent;
			const result = await signIn(signingInAgent, {
				signal: controller.signal,
				methodId: typeof body.methodId === "string" ? body.methodId : undefined,
				// The app has no terminal: only agent methods (the agent runs its own flow).
				terminal: false,
				// Offered in the app too, in case the browser did not come up.
				onUrl: (url) => ctx.emit({ event: "signin_url", url }),
				onProgress: (message) => ctx.emit({ event: "progress", stage: "signin", message }),
			});
			if (signingIn === controller) signingIn = null;
			sendJson(res, 200, result);
			return true;
		}
		if (route === "POST /signin/cancel") {
			signingIn?.abort();
			signingIn = null;
			sendJson(res, 200, { ok: true });
			return true;
		}
		if (route === "GET /models") {
			const agent = new URL(req.url ?? "", "http://127.0.0.1").searchParams.get("agent") ?? ctx.config.agent;
			// Asking never installs.
			sendJson(res, 200, { agent, models: isAvailable(agent) ? await agentModels(agent) : null });
			return true;
		}
		if (route === "POST /agent/model") {
			const body = (await parseBody(req)) as { id?: unknown; model?: unknown };
			if (typeof body.id !== "string" || !body.id || (body.model !== null && typeof body.model !== "string")) {
				sendJson(res, 400, { error: "id and model are required" });
				return true;
			}
			const config = loadConfig();
			const models = { ...config.models };
			if (body.model) models[body.id] = body.model;
			else delete models[body.id];
			saveConfig({ ...config, models });
			// Conversations with this AI end: the next message uses the new model.
			sessions?.closeWhere((origin) => siteAi(origin) === body.id);
			ctx.emit({ event: "model", id: body.id, model: body.model });
			sendJson(res, 200, { ok: true });
			return true;
		}
		if (route === "POST /agent/reset") {
			const body = (await parseBody(req)) as { id?: unknown };
			if (typeof body.id !== "string" || !body.id) {
				sendJson(res, 400, { error: "id is required" });
				return true;
			}
			// A sign-in still waiting would hold the files being erased.
			signingIn?.abort();
			signingIn = null;
			resetAgent(body.id);
			sendJson(res, 200, { ok: true });
			return true;
		}
		if (route === "GET /sites") {
			sendJson(res, 200, { sites: ctx.grants.list().map(({ tokenHash: _hash, ...site }) => site) });
			return true;
		}
		if (route === "POST /sites/model") {
			const body = (await parseBody(req)) as { origin?: unknown; model?: unknown };
			const grant = typeof body.origin === "string" ? ctx.grants.get(body.origin) : undefined;
			if (!grant || typeof body.origin !== "string") {
				sendJson(res, 404, { error: "This site is not connected" });
				return true;
			}
			// The model belongs to the site's AI: a later change of AI drops it.
			const agent = grant.agent ?? ctx.config.agent;
			ctx.grants.setModel(body.origin, typeof body.model === "string" && body.model ? { agent, id: body.model } : undefined);
			sendJson(res, 200, { origin: body.origin, agent, model: typeof body.model === "string" ? body.model : null });
			return true;
		}
		if (route === "POST /sites/agent") {
			const body = (await parseBody(req)) as { origin?: unknown; agent?: unknown };
			if (typeof body.origin !== "string" || !ctx.grants.get(body.origin)) {
				sendJson(res, 404, { error: "This site is not connected" });
				return true;
			}
			const agent = typeof body.agent === "string" && body.agent && body.agent !== ctx.config.agent ? body.agent : undefined;
			if (agent && !isLlmId(agent)) await ensureAgent(agent, { onProgress: (message) => ctx.emit({ event: "progress", stage: "install", message }) });
			ctx.grants.setAgent(body.origin, agent);
			if (agent) addAi(agent);
			const signIn = agent ? await checkSignIn(agent) : { ok: true, detail: "default AI", methods: [] };
			sendJson(res, 200, { origin: body.origin, agent: agent ?? null, signIn });
			return true;
		}
		if (route === "DELETE /sites") {
			const origin = new URL(req.url ?? "", "http://127.0.0.1").searchParams.get("origin");
			if (!origin) {
				sendJson(res, 400, { error: "origin is required" });
				return true;
			}
			sendJson(res, 200, { removed: ctx.grants.revoke(origin) });
			return true;
		}
		if (route === "POST /fit") {
			// A site's needs: given (a request being approved), or the ones it declared (a connected site).
			const body = (await parseBody(req)) as { needs?: unknown; origin?: unknown };
			const needs = parseNeeds(body.needs) ?? (typeof body.origin === "string" ? ctx.grants.get(body.origin)?.needs : undefined);
			sendJson(res, 200, await fitAis(ctx, needs));
			return true;
		}
		if (route === "GET /pairing") {
			sendJson(res, 200, { requests: pairing.pending() });
			return true;
		}
		if (route === "POST /pairing/link") {
			// A leuria://connect link reached the app: ask the visitor, and let that site claim.
			const result = pairing.link((await parseBody(req)) as { origin?: unknown; app?: unknown; nonce?: unknown; needs?: unknown });
			sendJson(res, "error" in result ? 400 : 201, result);
			return true;
		}
		const decide = /^POST \/pairing\/([^/]+)$/.exec(route);
		if (decide) {
			// On Allow, the visitor may also pick the site's AI (null: the default) and model, from the first message on.
			const body = (await parseBody(req)) as { allow?: unknown; agent?: unknown; model?: unknown };
			const ok = pairing.decideById(decide[1]!, body.allow === true, (origin) => {
				if (body.agent !== undefined) {
					const agent = typeof body.agent === "string" && body.agent && body.agent !== ctx.config.agent ? body.agent : undefined;
					ctx.grants.setAgent(origin, agent);
				}
				if (typeof body.model === "string" && body.model) {
					ctx.grants.setModel(origin, { agent: ctx.grants.get(origin)?.agent ?? ctx.config.agent, id: body.model });
				}
			});
			sendJson(res, ok ? 200 : 410, ok ? { ok } : { error: "This request has expired." });
			return true;
		}
		if (route === "GET /embeddings") {
			const [models, current] = await Promise.all([listLocalEmbedders(), localEmbeddings(() => ctx.config.embed).find()]);
			const provider = (p: { id: string; kind: string; name: string }) => ({ id: p.id, kind: p.kind, name: p.name });
			sendJson(res, 200, {
				choice: ctx.config.embed ?? "auto",
				current: current ? { provider: provider(current.provider), model: current.model } : null,
				models: models.map((m) => ({ provider: provider(m.provider), model: m.model.id, loaded: m.model.loaded ?? null })),
			});
			return true;
		}
		if (route === "POST /embeddings") {
			const { choice } = (await parseBody(req)) as { choice?: unknown };
			const { provider, model } = (choice ?? {}) as { provider?: unknown; model?: unknown };
			let embed: EmbedChoice | undefined;
			if (choice === "off") embed = "off";
			else if (typeof provider === "string" && provider && typeof model === "string" && model) embed = { provider, model };
			else if (choice !== "auto") {
				sendJson(res, 400, { error: 'choice must be "auto", "off" or { provider, model }' });
				return true;
			}
			if (embed) ctx.config.embed = embed;
			else delete ctx.config.embed;
			const { embed: _previous, ...saved } = loadConfig();
			saveConfig(embed ? { ...saved, embed } : saved);
			ctx.emit({ event: "embed", choice: embed ?? "auto" });
			sendJson(res, 200, { choice: embed ?? "auto" });
			return true;
		}
		if (route === "POST /test") {
			const body = (await parseBody(req).catch(() => ({}))) as { agent?: unknown };
			const agent = typeof body.agent === "string" && body.agent ? body.agent : ctx.config.agent;
			let checkStep = 0;
			const result = await runSelfTest({
				agentName: agentName(agent),
				resolveAgent: () => resolveAgentCommand(agent),
				logger: ctx.logger,
				// `message` is for the CLI; the app words each stage itself (no jargon for visitors).
				onStep: (message) => ctx.emit({ event: "progress", stage: "check", step: ++checkStep, message }),
			});
			sendJson(res, 200, result);
			return true;
		}
		return false;
	};
}

/** Every model of Your AIs, as candidates for a site. Agents are never started: only models already seen. */
async function candidates(ctx: AdminContext): Promise<Array<Candidate & { name: string }>> {
	const siteAgents = ctx.grants.list().flatMap((g) => (g.agent ? [g.agent] : []));
	const found: Array<Candidate & { name: string }> = [];
	for (const id of yourAis(ctx.config.agent, siteAgents)) {
		const isDefault = id === ctx.config.agent;
		const llm = parseLlmId(id);
		if (!llm) {
			const models = seenAgentModels(id);
			if (!models) found.push({ agent: id, name: agentName(id), traits: traitsOf({ kind: "agent" }, { name: agentName(id) }), isDefault });
			for (const m of models?.options ?? []) {
				found.push({ agent: id, model: m.id, name: m.name, traits: traitsOf({ kind: "agent" }, m), isDefault, isCurrent: m.id === models?.current });
			}
			continue;
		}
		const provider = getProvider(llm.providerId);
		if (!provider) continue;
		const models = await listModels(provider).catch(() => []);
		const current = llm.model ? undefined : loadConfig().models?.[id];
		for (const m of models.filter((m) => !llm.model || m.id === llm.model)) {
			const kind = { kind: "llm" as const, local: provider.kind !== "openai" && !m.remote, plan: Boolean(m.remote) };
			const traits = traitsOf(kind, { name: m.id.split("/").pop() ?? m.id, meta: m.meta, loaded: m.loaded });
			// A fixed-model AI has no choice to make: the AI is the model.
			found.push({ agent: id, ...(llm.model ? {} : { model: m.id }), name: m.id.split("/").pop() ?? m.id, traits, isDefault, isCurrent: m.id === current });
		}
	}
	return found;
}

/** How Your AIs fit `needs`: a verdict per AI and model, and the cheapest that is enough. */
export async function fitAis(ctx: AdminContext, needs: SiteNeeds | undefined) {
	const all = await candidates(ctx);
	const best = recommend(needs, all);
	const order: Verdict[] = ["fits", "more", "short"];
	const ais = [...new Set(all.map((c) => c.agent))].map((id) => {
		const own = all.filter((c) => c.agent === id);
		const models = own.map((c) => ({ id: c.model, name: c.name, verdict: fitOf(needs, c.traits), cost: c.traits.cost }));
		// An AI fits as well as its best model.
		const verdict = order.find((v) => models.some((m) => m.verdict === v)) ?? "fits";
		return { id, verdict, cost: own[0]?.traits.cost ?? "plan", models: models.filter((m) => m.id !== undefined) };
	});
	return {
		needs: needs ?? null,
		recommended: best
			? {
					agent: best.agent,
					model: best.model ?? null,
					modelName: best.model ? best.name : null,
					isDefault: best.isDefault,
					cost: best.traits.cost,
					reason: reasonFor(best.traits),
				}
			: null,
		ais,
	};
}
