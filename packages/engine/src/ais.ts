/**
 * "Your AIs": the AIs the visitor set up (agents and LLM providers they
 * enabled), as opposed to everything found on the computer. One of them
 * is the default; a site may use any other one of them.
 *
 * An entry is an ACP agent id (`codex-acp`) or an LLM id
 * (`llm:lmstudio/qwen3-8b`): a service's model is an AI of its own.
 */

import { agentName, isAvailable, resolveAgentCommand, resolveSiteAgent } from "./agents.js";
import type { Decisions } from "./llm/decisions.js";
import type { AgentLaunch } from "./session-manager.js";
import { seenAgentModels } from "./auth.js";
import { type Candidate, COST, type Cost, recommend, traitsOf } from "./fit.js";
import type { Effort, SiteNeeds } from "./needs.js";
import { loadConfig, saveConfig } from "./home.js";
import { getProvider, listModels, parseLlmId } from "./llm/providers.js";

/** What of a grant the AI choice reads. */
type Grant = { agent?: string; model?: { agent: string; id: string }; needs?: SiteNeeds };

/**
 * The default first, then the others in the order they were added. AIs a
 * site already uses count too (set up before this list existed). Only AIs
 * still available (installed, or their service still known).
 */
export function yourAis(defaultAgent: string, siteAgents: string[] = []): string[] {
	return [...new Set([defaultAgent, ...(loadConfig().ais ?? []), ...siteAgents])].filter((id) => id && isAvailable(id));
}

/** Add `id` to Your AIs (kept on disk). */
export function addAi(id: string): void {
	const config = loadConfig();
	if (config.ais?.includes(id)) return;
	saveConfig({ ...config, ais: [...(config.ais ?? []), id] });
}

/** Take `id` off Your AIs, with its model choice and what Leuria remembers of it. */
export function removeAi(id: string): void {
	const config = loadConfig();
	const { [id]: _model, ...models } = config.models ?? {};
	const { [id]: _ready, ...ready } = config.ready ?? {};
	saveConfig({ ...config, ais: (config.ais ?? []).filter((a) => a !== id), models, ready });
}

/** Does anything but the AI being removed still use this LLM service: the default AI, another of Your AIs, embeddings? */
export function providerInUse(providerId: string, defaultAgent: string): boolean {
	const config = loadConfig();
	const uses = (id: string) => parseLlmId(id)?.providerId === providerId;
	return (
		uses(defaultAgent) ||
		(config.ais ?? []).some(uses) ||
		(typeof config.embed === "object" && config.embed.provider === providerId) ||
		(typeof config.decisions === "object" && "provider" in config.decisions && config.decisions.provider === providerId)
	);
}

/**
 * AIs saved as one fixed model of a service (`llm:lmstudio/qwen3-8b`)
 * become the service (`llm:lmstudio`) with that model chosen, so its model
 * can be changed like an agent's. Sites keep their model as their own
 * choice. Runs at start; does nothing once converted.
 */
export function convertServiceAis(grants: { list(): Array<{ origin: string; agent?: string }>; setAgent(origin: string, agent: string | undefined): boolean; setModel(origin: string, model: { agent: string; id: string } | undefined): boolean }): void {
	const toService = (id: string) => {
		const parsed = parseLlmId(id);
		return parsed?.model ? { id: `llm:${parsed.providerId}`, model: parsed.model } : null;
	};
	const config = loadConfig();
	const models = { ...config.models };
	let changed = false;
	const convert = (id: string) => {
		const service = toService(id);
		if (!service) return id;
		changed = true;
		models[service.id] ??= service.model;
		return service.id;
	};
	const agent = convert(config.agent);
	// The default's model wins over an older choice for the same service.
	const defaultService = toService(config.agent);
	if (defaultService) models[defaultService.id] = defaultService.model;
	const ais = [...new Set((config.ais ?? []).map(convert))];
	if (changed) saveConfig({ ...config, agent, ais, models });
	for (const grant of grants.list()) {
		const service = grant.agent ? toService(grant.agent) : null;
		if (!service) continue;
		grants.setAgent(grant.origin, service.id);
		grants.setModel(grant.origin, { agent: service.id, id: service.model });
	}
}

// ── Dynamic selection ───────────────────────────────────────────────────
//
// A site on dynamic selection has no AI of its own: each conversation
// starts on the cheapest of Your AIs that is enough for what the site
// declared it needs (`fit.ts`), among those available right now. The
// visitor sets how far it may go: AIs on this computer only, their plans
// too, or paid ones too. Stored as the site's agent id: `dynamic`,
// `dynamic:free`, `dynamic:plan` (`dynamic` alone: paid too).

export const DYNAMIC = "dynamic";

export function isDynamic(id: string | undefined): boolean {
	return id === DYNAMIC || (id?.startsWith(`${DYNAMIC}:`) ?? false);
}

/** The most a dynamic site may cost: `free`, `plan` or `paid`. */
export function dynamicCeiling(id: string): Cost {
	const upTo = id.split(":")[1];
	return upTo === "free" || upTo === "plan" ? upTo : "paid";
}

/** Every model of Your AIs, as candidates for a site. Agents are never started: only models already seen. */
export async function yourAiModels(defaultAgent: string, siteAgents: string[]): Promise<Array<Candidate & { name: string }>> {
	const found: Array<Candidate & { name: string }> = [];
	for (const id of yourAis(defaultAgent, siteAgents)) {
		const isDefault = id === defaultAgent;
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

/** How an AI or one of its models is named in the dynamic-selection off list. */
export function dynamicKey(agent: string, model?: string): string {
	return model ? `${agent}@${model}` : agent;
}

/** Whether dynamic selection may use this model: its AI and itself are not left out. */
export function inDynamic(agent: string, model: string | undefined, off: string[] = loadConfig().dynamicOff ?? []): boolean {
	return !off.includes(agent) && (model === undefined || !off.includes(dynamicKey(agent, model)));
}

/** Leave an AI or model out of dynamic selection, or put it back. */
export function setDynamic(agent: string, model: string | undefined, on: boolean): void {
	const config = loadConfig();
	const key = dynamicKey(agent, model);
	const off = (config.dynamicOff ?? []).filter((k) => k !== key);
	saveConfig({ ...config, dynamicOff: on ? off : [...off, key] });
}

/** Candidates a dynamic site may use: costing no more than `upTo`, and not left out by the visitor. */
export function forDynamic<C extends Candidate>(candidates: C[], upTo: Cost, off?: string[]): C[] {
	return candidates.filter((c) => COST[c.traits.cost] <= COST[upTo] && inDynamic(c.agent, c.model, off));
}

const CEILING_WORDS: Record<Cost, string> = { free: "on this computer", plan: "on this computer or your plans", paid: "" };

/** What a conversation starts with, for dynamic selection to weigh. */
export interface PickContext {
	origin?: string;
	/** The first message, when the page sent one with the conversation. */
	prompt?: string;
	/** The decision model, when there is one: it judges how hard the message is. */
	decisions?: Decisions;
}

const EFFORTS: Record<Effort, string> = {
	light: "a quick answer: a lookup, an extraction, a summary, a short reply",
	standard: "several steps, using the site's features or tools",
	deep: "long reasoning, planning, or many steps that build on each other",
};

/**
 * How hard the first message is, from the decision model: `light`,
 * `standard` or `deep`. Undefined when there is no decision model, it
 * doesn't answer in time, or the message is missing: the site's own
 * declaration then stands.
 */
export async function judgeEffort(context: PickContext, declared?: Effort): Promise<Effort | undefined> {
	const { prompt, decisions, origin } = context;
	if (!prompt?.trim() || !decisions) return undefined;
	try {
		const { answers } = await decisions.decide(
			{
				state: { message: prompt.slice(0, 4000), ...(declared ? { the_site_usually_needs: EFFORTS[declared] } : {}) },
				questions: { effort: { type: "choice", instructions: "How much work does `message` ask of an AI assistant on this website?", criteria: EFFORTS } },
			},
			AbortSignal.timeout(JUDGE_MS),
			origin,
		);
		const choice = (answers.effort as { choice?: unknown } | undefined)?.choice;
		return choice === "light" || choice === "standard" || choice === "deep" ? choice : undefined;
	} catch {
		return undefined;
	}
}

// ponytail: one fixed wait; a decision model answers in well under a second when loaded.
const JUDGE_MS = 4000;

/**
 * The AI and model a site uses, launched: its own choices, the default AI,
 * or, on dynamic selection, the cheapest of Your AIs that fits it right
 * now. With a decision model and a first message, the message's own
 * weight decides the strength needed, within what the site declared.
 */
export async function resolveSiteAi(grant: Grant | undefined, defaultAgent: string, siteAgents: () => string[], context: PickContext = {}): Promise<AgentLaunch & { name: string }> {
	if (!grant?.agent || !isDynamic(grant.agent)) return resolveSiteAgent(grant, defaultAgent);
	const upTo = dynamicCeiling(grant.agent);
	const [candidates, effort] = await Promise.all([yourAiModels(defaultAgent, siteAgents()), judgeEffort(context, grant.needs?.effort)]);
	const needs = effort ? { ...grant.needs, effort } : grant.needs;
	const best = recommend(needs, forDynamic(candidates, upTo));
	if (!best) throw new Error(`None of your AIs ${CEILING_WORDS[upTo] || "available"} fits this site. Choose one for it in Leuria.`);
	return resolveAgentCommand(best.agent, best.model);
}

/** "Dynamic selection", for a site on it; the AI's label otherwise. */
export function siteAiLabel(grant: Grant | undefined, defaultAgent: string, label: (id: string, model?: string) => string): string {
	if (grant?.agent && isDynamic(grant.agent)) return "Dynamic selection";
	const id = grant?.agent ?? defaultAgent;
	return label(id, grant?.model?.agent === id ? grant.model.id : loadConfig().models?.[id]);
}
