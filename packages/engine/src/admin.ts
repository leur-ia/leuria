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
 *   POST   /admin/signin  { methodId?, agent?, window? } sign in with an ACP agent method (opens the browser),
 *                             or with `window` the agent's terminal sign-in in a terminal window
 *   POST   /admin/signin/cancel       stop a sign-in in progress
 *   GET    /admin/models?agent=…      models an agent offers (the default AI's without `agent`), with the chosen one as current
 *                                    `&refresh=1` asks the agent again (starts it for a moment); `stale: true` when it didn't answer
 *   POST   /admin/agent/model { id, model|null } the model to use with an agent (null: the agent's default)
 *   POST   /admin/agent/reset { id }  forget an agent that failed (install and Leuria's sign-in), to start over
 *   GET    /admin/sites               connected sites, each with its AI override and declared needs if any
 *   POST   /admin/fit     { needs?, origin? } how Your AIs and their models fit a site's needs, and the one to recommend
 *   POST   /admin/providers { name, baseUrl, apiKey? } add or update an OpenAI-compatible API (tested first)
 *   POST   /admin/sites/agent { origin, agent|null } use another AI for one site (installs it)
 *   POST   /admin/sites/model { origin, model|null } use another model for one site (for the site's AI)
 *   DELETE /admin/sites?origin=…      disconnect a site
 *   POST   /admin/pairing/link { origin, app?, nonce, needs? } a leuria://connect link reached the app: ask the visitor
 *   POST   /admin/pairing/:id { allow, agent?, model? } approve or refuse a site; on Allow, optionally its AI (null: the default) and model
 *   POST   /admin/test  { agent? }    real round trip with an AI, the default one without `agent` (`leuria test`)
 *   GET    /admin/embeddings          embedding models on this computer, the choice, and the one sites get now
 *   POST   /admin/embeddings { choice: "auto" | "off" | { provider, model } } the embedding model sites get
 *   GET    /admin/decisions           decision models on this computer, the choice, and the one sites get now
 *   POST   /admin/decisions { choice: "auto" | "off" | { provider, model } | { baseUrl?, apiKey?, model? } } the decision model sites get (a service is tested first)
 *   POST   /admin/sites/decide { origin, choice|null } the decision model one site gets (null: the one every site gets)
 *   POST   /admin/decisions/probe { baseUrl?, apiKey?, model? } look at a decision service: its models, and a real question to one
 */

import type * as http from "node:http";

import { agentName, ensureAgent, isAvailable, listAgents, resetAgent } from "./agents.js";
import { detectLlms, getProvider, isLlmId, listModels, llmId, normalizeBaseUrl, parseLlmId, removeProvider, saveProvider } from "./llm/providers.js";
import { agentModels, checkSignIn, signIn } from "./auth.js";
import { type Cost, fitOf, reasonFor, recommend, type Verdict } from "./fit.js";
import { parseNeeds, type SiteNeeds } from "./needs.js";
import { detectInstalledClis } from "./detect.js";
import type { GrantStore } from "./grants.js";
import { addAi, dynamicCeiling, isDynamic, providerInUse, removeAi, withinCeiling, yourAiModels, yourAis } from "./ais.js";
import { type DecideChoice, type EmbedChoice, type EngineConfig, isKnownReady, loadConfig, saveConfig } from "./home.js";
import { askSystemOne, decisionBaseUrl, DEFAULT_DECISION_URL, listLocalDeciders, probeService, systemOneDecisions } from "./llm/decisions.js";
import { listLocalEmbedders, localEmbeddings } from "./llm/embeddings.js";
import { parseBody, sendJson } from "./http-utils.js";
import type { Logger } from "./logger.js";
import type { Pairing } from "./pairing.js";
import { runSelfTest } from "./self-test.js";
import type { SessionManager } from "./session-manager.js";
import { resolveAgentCommand } from "./agents.js";
import { VERSION } from "./version.js";

interface AdminContext {
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
			const body = (await parseBody(req)) as { methodId?: unknown; agent?: unknown; window?: unknown };
			signingIn?.abort();
			const controller = new AbortController();
			signingIn = controller;
			signingInAgent = typeof body.agent === "string" && body.agent ? body.agent : ctx.config.agent;
			const result = await signIn(signingInAgent, {
				signal: controller.signal,
				methodId: typeof body.methodId === "string" ? body.methodId : undefined,
				// The app has no terminal: agent methods (the agent runs its own flow), or
				// a terminal-only sign-in (Claude) in a window Leuria opens.
				terminal: false,
				window: body.window === true,
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
			const params = new URL(req.url ?? "", "http://127.0.0.1").searchParams;
			const agent = params.get("agent") ?? ctx.config.agent;
			// Asking never installs.
			if (!isAvailable(agent)) {
				sendJson(res, 200, { agent, models: null });
				return true;
			}
			// Look again: an agent lists its models when it starts (services are always asked live).
			const refresh = params.get("refresh") === "1";
			const answered = refresh && !isLlmId(agent) ? (await checkSignIn(agent)).ok : true;
			const models = await agentModels(agent);
			// Not refreshed: the agent didn't answer, or the service couldn't be reached (its list is live).
			const stale = refresh && (!answered || (isLlmId(agent) && !models));
			sendJson(res, 200, { agent, models, ...(stale ? { stale: true } : {}) });
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
			// A site's decision service shows without its key.
			sendJson(res, 200, { sites: ctx.grants.list().map(({ tokenHash: _hash, decide, ...site }) => ({ ...site, ...(decide ? { decide: decideChoiceInfo(decide) } : {}) })) });
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
			if (agent && !isLlmId(agent) && !isDynamic(agent)) await ensureAgent(agent, { onProgress: (message) => ctx.emit({ event: "progress", stage: "install", message }) });
			ctx.grants.setAgent(body.origin, agent);
			if (agent && !isDynamic(agent)) addAi(agent);
			const signIn = agent && !isDynamic(agent) ? await checkSignIn(agent) : { ok: true, detail: "default AI", methods: [] };
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
			const body = (await parseBody(req)) as { needs?: unknown; origin?: unknown; upTo?: unknown };
			const grant = typeof body.origin === "string" ? ctx.grants.get(body.origin) : undefined;
			const needs = parseNeeds(body.needs) ?? grant?.needs;
			// `upTo` for a dynamic choice being made; a connected dynamic site has its own.
			const upTo = body.upTo === "free" || body.upTo === "plan" || body.upTo === "paid" ? body.upTo : grant?.agent && isDynamic(grant.agent) ? dynamicCeiling(grant.agent) : undefined;
			sendJson(res, 200, await fitAis(ctx, needs, upTo));
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
		if (route === "GET /decisions") {
			const decisions = systemOneDecisions(() => ctx.config.decisions);
			const [models, current] = await Promise.all([listLocalDeciders(), decisions.find()]);
			const provider = (p: { id: string; kind: string; name: string }) => ({ id: p.id, kind: p.kind, name: p.name });
			sendJson(res, 200, {
				choice: decideChoiceInfo(ctx.config.decisions),
				current: current ? { model: current.model, name: current.name, local: current.local, ...(current.provider ? { provider: provider(current.provider) } : {}) } : null,
				models: models.map((m) => ({ provider: provider(m.provider), model: m.model.id, loaded: m.model.loaded ?? null })),
			});
			return true;
		}
		if (route === "POST /decisions/probe") {
			const { baseUrl, apiKey, model } = (await parseBody(req)) as { baseUrl?: unknown; apiKey?: unknown; model?: unknown };
			if ((baseUrl !== undefined && typeof baseUrl !== "string") || (apiKey !== undefined && typeof apiKey !== "string") || (model !== undefined && typeof model !== "string")) {
				sendJson(res, 400, { error: "baseUrl, apiKey and model must be strings" });
				return true;
			}
			let service: { baseUrl: string; apiKey?: string; model?: string };
			try {
				service = { baseUrl: baseUrl?.trim() ? decisionBaseUrl(baseUrl) : DEFAULT_DECISION_URL, ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}), ...(model?.trim() ? { model: model.trim() } : {}) };
			} catch {
				sendJson(res, 400, { error: "That address doesn't look right. Try something like http://localhost:8000/v1." });
				return true;
			}
			try {
				sendJson(res, 200, await probeService(service));
			} catch (error) {
				sendJson(res, 422, { error: error instanceof Error ? error.message : String(error) });
			}
			return true;
		}
		if (route === "POST /decisions") {
			const { choice } = (await parseBody(req)) as { choice?: unknown };
			const read = await readDecideChoice(choice);
			if ("error" in read) {
				sendJson(res, read.status, { error: read.error });
				return true;
			}
			if (read.choice) ctx.config.decisions = read.choice;
			else delete ctx.config.decisions;
			const { decisions: _previous, ...saved } = loadConfig();
			saveConfig(read.choice ? { ...saved, decisions: read.choice } : saved);
			ctx.emit({ event: "decisions", choice: decideChoiceInfo(read.choice) });
			sendJson(res, 200, { choice: decideChoiceInfo(read.choice) });
			return true;
		}
		if (route === "POST /sites/decide") {
			const body = (await parseBody(req)) as { origin?: unknown; choice?: unknown };
			if (typeof body.origin !== "string" || !ctx.grants.get(body.origin)) {
				sendJson(res, 404, { error: "This site is not connected" });
				return true;
			}
			// `null`: the site follows the choice every site gets.
			const read = body.choice === null ? { choice: undefined } : await readDecideChoice(body.choice);
			if ("error" in read) {
				sendJson(res, read.status, { error: read.error });
				return true;
			}
			ctx.grants.setDecide(body.origin, read.choice);
			sendJson(res, 200, { origin: body.origin, choice: read.choice ? decideChoiceInfo(read.choice) : null });
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
			// The app shows the visitor a short line: keep the reason for the log.
			if (!result.ok) ctx.logger.warn("check failed", { agent, steps: result.steps.filter((step) => !step.ok) });
			sendJson(res, 200, result);
			return true;
		}
		return false;
	};
}

/** Every model of Your AIs, as candidates for a site. */
function candidates(ctx: AdminContext) {
	return yourAiModels(ctx.config.agent, siteAgents(ctx));
}

/** The AIs sites use (set up before Your AIs existed, or since). */
function siteAgents(ctx: AdminContext): string[] {
	return ctx.grants.list().flatMap((g) => (g.agent ? [g.agent] : []));
}

/** How Your AIs fit `needs`: a verdict per AI and model, and the cheapest that is enough. */
async function fitAis(ctx: AdminContext, needs: SiteNeeds | undefined, upTo?: Cost) {
	const all = await candidates(ctx);
	// On dynamic selection, the recommendation is what the site would get now: within its ceiling.
	const best = recommend(needs, upTo ? withinCeiling(all, upTo) : all);
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

/**
 * A decision choice from the app: `"auto"` (nothing chosen), `"off"`, a
 * model on this computer, or a service, which is tried before it is kept.
 */
async function readDecideChoice(choice: unknown): Promise<{ choice: DecideChoice | undefined } | { error: string; status: number }> {
	const { provider, model, baseUrl, apiKey } = (choice ?? {}) as { provider?: unknown; model?: unknown; baseUrl?: unknown; apiKey?: unknown };
	if (choice === "auto") return { choice: undefined };
	if (choice === "off") return { choice: "off" };
	if (typeof provider === "string" && provider && typeof model === "string" && model) return { choice: { provider, model } };
	if (baseUrl === undefined && apiKey === undefined) return { error: 'choice must be "auto", "off", { provider, model } or { baseUrl?, apiKey?, model? }', status: 400 };
	if ((baseUrl !== undefined && typeof baseUrl !== "string") || (apiKey !== undefined && typeof apiKey !== "string") || (model !== undefined && typeof model !== "string")) {
		return { error: 'choice must be "auto", "off", { provider, model } or { baseUrl?, apiKey?, model? }', status: 400 };
	}
	let service: { baseUrl: string; apiKey?: string; model?: string };
	try {
		service = {
			baseUrl: baseUrl?.trim() ? decisionBaseUrl(baseUrl) : DEFAULT_DECISION_URL,
			...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}),
			...(model?.trim() ? { model: model.trim() } : {}),
		};
	} catch {
		return { error: "That address doesn't look right. Try something like http://localhost:8000/v1.", status: 400 };
	}
	// Test before saving: the visitor learns at once if the address, key or model is wrong.
	try {
		await askSystemOne(service, { state: "ok", questions: { works: { type: "noul", instructions: "Is the state the word ok?" } }, model: service.model }, undefined, 30_000);
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error), status: 422 };
	}
	return { choice: service };
}

/** The visitor's choice as the desktop app sees it: a service without its key. */
function decideChoiceInfo(choice: DecideChoice | undefined): "auto" | "off" | { provider: string; model: string } | { baseUrl: string; hasKey: boolean; model?: string } {
	if (!choice) return "auto";
	if (choice === "off" || "provider" in choice) return choice;
	return { baseUrl: choice.baseUrl, hasKey: Boolean(choice.apiKey), ...(choice.model ? { model: choice.model } : {}) };
}
