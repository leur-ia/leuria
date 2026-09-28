import { createStore } from "@sinuxjs/core";

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
	/** How Your AIs fit what the site says it needs, and the one to recommend. */
	fit: Fit | null;
}

const initial: PairingChoiceState = { requestId: null, ais: [], agent: null, models: null, model: null, fit: null };

/** Only the latest pick's models land. */
let picking = 0;

export const pairingStore = createStore(initial, {
	/** A new request: start from the defaults, with Your AIs and the default AI's models. */
	open: async (state, requestId: string, needs?: SiteNeeds): Promise<Partial<PairingChoiceState>> => {
		if (state.requestId === requestId) return {};
		pairingStore.updateState({ ...initial, requestId });
		const [ais, models, fit] = await Promise.all([
			engine.ais().catch(() => [] as YourAi[]),
			engine.models().catch(() => null),
			// Costs are shown even when the site declared no needs.
			engine.fit({ needs }).catch(() => null),
		]);
		return pairingStore.getState().requestId === requestId ? { ais, models, fit } : {};
	},
	/** Take a recommendation: its AI (null: the default) and model. */
	pick: async (_state, agent: string | null, model: string | null): Promise<Partial<PairingChoiceState>> => {
		const token = ++picking;
		pairingStore.updateState({ agent, model });
		const models = await engine.models(agent ?? undefined).catch(() => null);
		return token === picking ? { models } : {};
	},
	pickAgent: async (_state, agent: string | null): Promise<Partial<PairingChoiceState>> => {
		const token = ++picking;
		pairingStore.updateState({ agent, model: null, models: null });
		const models = await engine.models(agent ?? undefined).catch(() => null);
		return token === picking ? { models } : {};
	},
	pickModel: (_state, model: string | null) => ({ model }),
});
