import { createStore } from "@sinuxjs/core";

import { dynamicCeiling, isDynamic } from "../components/DynamicSelection";
import { type AgentModels, engine, type Fit, type SiteNeeds, type YourAi } from "../engine";

/** The approval window's advanced choice: which of Your AIs, and which model, the site will use. */
export interface PairingChoiceState {
	/** The site's request these choices are for. */
	requestId: string | null;
	ais: YourAi[];
	/** `null`: the default AI. */
	agent: string | null;
	/** Models of the chosen AI, when it lets you choose. */
	models: AgentModels | null;
	/** `null`: the AI's own choice. */
	model: string | null;
	/** How Your AIs fit what the site says it needs, and the one to recommend (within the ceiling, on dynamic selection). */
	fit: Fit | null;
	/** What the site declared, kept to ask the fit again. */
	needs?: SiteNeeds;
}

const initial: PairingChoiceState = { requestId: null, ais: [], agent: null, models: null, model: null, fit: null };

/** Only the latest pick's models land. */
let picking = 0;

export const pairingStore = createStore(initial, {
	/** A new request: start from the defaults, with Your AIs and the default AI's models. */
	open: async (state, requestId: string, needs?: SiteNeeds): Promise<Partial<PairingChoiceState>> => {
		if (state.requestId === requestId) return {};
		pairingStore.updateState({ ...initial, requestId, needs });
		const [ais, models, fit] = await Promise.all([
			engine.ais().catch(() => [] as YourAi[]),
			engine.models().catch(() => null),
			// Costs are shown even when the site declared no needs.
			engine.fit({ needs }).catch(() => null),
		]);
		return pairingStore.getState().requestId === requestId ? { ais, models, fit } : {};
	},
	/** Choose an AI (null: the default) and model (null: the AI's own), e.g. a recommendation; its models load anew. */
	pick: async (state, agent: string | null, model: string | null): Promise<Partial<PairingChoiceState>> => {
		const token = ++picking;
		pairingStore.updateState({ agent, model, models: null });
		// Dynamic selection has no models to pick from; its fit says what the site would get, within the ceiling.
		const dynamic = isDynamic(agent);
		const [models, fit] = await Promise.all([
			dynamic ? null : engine.models(agent ?? undefined).catch(() => null),
			engine.fit({ needs: state.needs, ...(dynamic ? { upTo: dynamicCeiling(agent as string) } : {}) }).catch(() => null),
		]);
		return token === picking ? { models, fit } : {};
	},
	pickModel: (_state, model: string | null) => ({ model }),
});
