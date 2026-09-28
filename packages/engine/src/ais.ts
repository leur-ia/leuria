/**
 * "Your AIs": the AIs the visitor set up (agents and LLM providers they
 * enabled), as opposed to everything found on the computer. One of them
 * is the default; a site may use any other one of them.
 *
 * An entry is an ACP agent id (`codex-acp`) or an LLM id
 * (`llm:lmstudio/qwen3-8b`): a service's model is an AI of its own.
 */

import { isAvailable } from "./agents.js";
import { loadConfig, saveConfig } from "./home.js";
import { parseLlmId } from "./llm/providers.js";

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
	return uses(defaultAgent) || (config.ais ?? []).some(uses) || (typeof config.embed === "object" && config.embed.provider === providerId);
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
