import { createStore } from "@sinuxjs/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

import { type AgentModels, engine, errorMessage, onEngine, failureText, type Fit, friendlyName, type SearchChoice, type SearchModels, type SignInStatus, type Site, type TestResult, type YourAi } from "../engine";
import { appStore } from "./app.store";

/** The sidebar's pages. */
export type HomeTab = "sites" | "ais" | "settings";

export interface HomeState {
	/** Websites first (what people come for); Your AIs and Settings on their own pages. */
	tab: HomeTab;
	sites: Site[];
	/** Your AIs, the default first: what a site can use. */
	ais: YourAi[];
	autostart: boolean;
	/** "Check that it works", per AI (a real question to it). */
	checks: Record<string, TestResult | "running">;
	/** A site whose AI is being set up (installed or checked). */
	settingUp: string | null;
	/** A site whose chosen AI still needs a sign-in. */
	signInNeeded: { origin: string; agent: string; status: SignInStatus } | null;
	/** Models of each of Your AIs but the default (by AI id); the default AI's are in the app store. */
	aiModels: Record<string, AgentModels | null>;
	/** Search by meaning: the models on this computer and the one sites get (null until loaded). */
	search: SearchModels | null;
	/** "Refresh models", per AI: running, or whether the AI answered. */
	modelRefresh: Record<string, "running" | "done" | "stale">;
	/** A site whose settings a `leuria://site` link asked for: shown open. */
	focus: string | null;
	/** How Your AIs fit each site that declared its needs (loaded when its settings open). */
	fits: Record<string, Fit | null>;
	error: string;
}

const initial: HomeState = {
	tab: "sites",
	sites: [],
	ais: [],
	autostart: false,
	checks: {},
	settingUp: null,
	signInNeeded: null,
	aiModels: {},
	search: null,
	modelRefresh: {},
	focus: null,
	fits: {},
	error: "",
};

/** The origin of a link's `origin` value, in the form sites are stored. */
function safeOrigin(value: string): string {
	try {
		return new URL(value).origin.toLowerCase();
	} catch {
		return value;
	}
}

export const homeStore = createStore(initial, {
	showTab: (_state, tab: HomeTab) => ({ tab }),
	/** A site asked (through a link, from the visitor's click) to change its AI or model: open its settings. Unknown sites are ignored. */
	focusSite: async (_state, origin: string): Promise<Partial<HomeState>> => {
		const sites = await engine.sites().catch(() => null);
		const site = sites?.find((s) => s.origin === origin || s.origin === safeOrigin(origin));
		if (!sites || !site) return {};
		void homeStore.loadFit(site.origin);
		return { sites, tab: "sites", focus: site.origin };
	},
	/** How Your AIs fit a connected site's declared needs, and what each costs (shown even without needs). */
	loadFit: async (_state, origin: string): Promise<Partial<HomeState>> => {
		const fit = await engine.fit({ origin }).catch(() => null);
		return { fits: { ...homeStore.getState().fits, [origin]: fit } };
	},
	load: async () => {
		// Your AIs come from Leuria's own list: nothing is searched or started.
		const [sites, ais, autostart] = await Promise.all([engine.sites(), engine.ais().catch(() => [] as YourAi[]), isEnabled().catch(() => false)]);
		return { sites, ais, autostart };
	},
	/** Models of Your AIs (saved ones: an AI is started only if it never listed them). */
	loadAiModels: async (state) => {
		// Agents, and services whose model is chosen (not one fixed in their id).
		const ids = state.ais.filter((ai) => !ai.default && (ai.kind === "agent" || !ai.model)).map((ai) => ai.id);
		const missing = ids.filter((id) => !(id in state.aiModels));
		if (missing.length === 0) return {};
		const found = await Promise.all(missing.map(async (id) => [id, await engine.models(id).catch(() => null)] as const));
		return { aiModels: { ...state.aiModels, ...Object.fromEntries(found) } };
	},
	/**
	 * Ask one of Your AIs again which models it offers (a model was added,
	 * or a plan changed). An agent is started for a moment; a service is
	 * listed again. One that doesn't answer keeps the models it had.
	 */
	refreshAiModels: async (state, id: string): Promise<Partial<HomeState>> => {
		if (state.modelRefresh[id] === "running") return {};
		homeStore.updateState({ modelRefresh: { ...state.modelRefresh, [id]: "running" } });
		const found = await engine.refreshModels(id).catch(() => null);
		const now = homeStore.getState();
		const result = found && !found.stale ? "done" : "stale";
		if (found && !found.stale) {
			const isDefault = now.ais.find((ai) => ai.id === id)?.default ?? id === appStore.getState().status?.agent.id;
			// The default AI's models live in the app store (for the tray).
			if (isDefault) await appStore.modelsLoaded(found.models);
			else return { aiModels: { ...now.aiModels, [id]: found.models }, fits: {}, modelRefresh: { ...now.modelRefresh, [id]: result } };
		}
		// What fits each site may have changed with the models.
		return { fits: {}, modelRefresh: { ...now.modelRefresh, [id]: result } };
	},
	/** One of Your AIs was updated in the background: show the models its new version offers (already asked by the engine). */
	aiUpdated: async (state, id: string): Promise<Partial<HomeState>> => {
		const models = await engine.models(id).catch(() => null);
		if (!models) return {};
		const isDefault = state.ais.find((ai) => ai.id === id)?.default ?? id === appStore.getState().status?.agent.id;
		if (isDefault) {
			await appStore.modelsLoaded(models);
			return { fits: {} };
		}
		return { aiModels: { ...homeStore.getState().aiModels, [id]: models }, fits: {} };
	},
	/** The model one of Your AIs uses (the default AI's goes through the app store, for the tray). */
	setAiModel: async (state, id: string, model: string) => {
		const before = state.aiModels[id] ?? null;
		homeStore.updateState({ aiModels: { ...state.aiModels, [id]: before ? { ...before, current: model } : before } });
		try {
			await engine.setAgentModel(id, model);
			return { error: "" };
		} catch (error) {
			console.warn("Changing the model failed:", error);
			return { aiModels: { ...state.aiModels, [id]: before }, error: failureText(error, "The model didn't change. Try again.") };
		}
	},
	/** Make one of Your AIs the default: it answers every site that has no AI of its own. */
	makeDefault: async (state, id: string) => {
		try {
			await engine.chooseAgent(id);
			void appStore.refresh();
			return { ais: await engine.ais(), error: "" };
		} catch (error) {
			console.warn("Making it the default failed:", error);
			return { error: failureText(error, "That AI couldn't become the default. Try again."), ais: state.ais };
		}
	},
	/** Take an AI off Your AIs; its sites go back to the default. */
	removeAi: async (state, id: string) => {
		try {
			await engine.removeAi(id);
			const [ais, sites] = await Promise.all([engine.ais(), engine.sites()]);
			return { ais, sites, error: "" };
		} catch (error) {
			console.warn("Removing the AI failed:", error);
			return { error: failureText(error, "That AI couldn't be removed. Try again."), ais: state.ais };
		}
	},
	/** Use another model for one site (`null`: its AI's own choice). */
	setSiteModel: async (state, origin: string, model: string | null) => {
		try {
			await engine.setSiteModel(origin, model);
			return { sites: await engine.sites(), error: "" };
		} catch (error) {
			console.warn("Changing the site's model failed:", error);
			return { error: failureText(error, "The model didn't change. Try again."), sites: state.sites };
		}
	},
	disconnect: async (_state, origin: string) => {
		await engine.disconnect(origin);
		void appStore.refresh();
		return { sites: await engine.sites() };
	},
	/** Default AI plus a per-site override: `agent` null means "use the default". */
	setSiteAgent: async (state, origin: string, agent: string | null) => {
		// Moving away from an AI that is not signed in: erase it so a later try starts fresh.
		// Never the default AI, which other sites use.
		const abandoned = state.signInNeeded?.origin === origin ? state.signInNeeded.agent : null;
		const isDefault = state.ais.some((a) => a.id === abandoned && a.default);
		homeStore.updateState({ settingUp: origin, signInNeeded: null, error: "" });
		if (abandoned && abandoned !== agent && !isDefault) await engine.resetAgent(abandoned).catch(() => undefined);
		try {
			const result = await engine.setSiteAgent(origin, agent);
			return {
				settingUp: null,
				sites: await engine.sites(),
				signInNeeded: result.agent && !result.signIn.ok ? { origin, agent: result.agent, status: result.signIn } : null,
			};
		} catch (error) {
			// The engine removes a half-finished install itself; nothing else is erased here.
			console.warn(`Setting up ${agent} for ${origin} failed:`, error);
			const name = state.ais.find((a) => a.id === agent);
			return {
				settingUp: null,
				error: failureText(error, `Couldn't set up ${name ? friendlyName(name) : "this AI"}. Check your internet connection, then try again.`),
			};
		}
	},
	/** Sign in to a site's own AI (ACP authenticate: the browser opens; without a method, a terminal window). */
	signInSiteAgent: async (state, methodId?: string) => {
		const pending = state.signInNeeded;
		if (!pending) return {};
		homeStore.updateState({ settingUp: pending.origin });
		const status = await engine.signIn(methodId, pending.agent, !methodId).catch((error: unknown) => ({
			ok: false,
			detail: errorMessage(error),
			methods: pending.status.methods,
		}));
		return { settingUp: null, signInNeeded: status.ok ? null : { ...pending, status } };
	},
	/** Look for search models (asks LM Studio and Ollama, starts nothing). */
	loadSearch: async () => {
		try {
			return { search: await engine.searchModels() };
		} catch (error) {
			console.warn("Listing search models failed:", error);
			// An engine older than this window can't answer: say so rather than look forever.
			return { search: { choice: "auto" as const, current: null, models: [] }, error: failureText(error, "") };
		}
	},
	setSearch: async (state, choice: SearchChoice) => {
		try {
			await engine.setSearchModel(choice);
			return { search: await engine.searchModels(), error: "" };
		} catch (error) {
			console.warn("Changing the search model failed:", error);
			return { search: state.search, error: failureText(error, "The search model didn't change. Try again.") };
		}
	},
	toggleAutostart: async (state) => {
		if (state.autostart) await disable();
		else await enable();
		return { autostart: await isEnabled() };
	},
	/** Ask one AI a real question, as a website would (it costs one answer). */
	checkAi: async (state, id: string) => {
		homeStore.updateState({ checks: { ...state.checks, [id]: "running" } });
		const result = await engine.test(id).catch(
			(): TestResult => ({ ok: false, steps: [{ name: "answer", ok: false, detail: "no answer" }] }),
		);
		return { checks: { ...state.checks, [id]: result } };
	},

});

/** Engine events for the home screen. Called once at startup, outside React. */
export function bindHomeEvents(): void {
	// A newer version of an AI was installed in the background: its models may have changed (a new one, say).
	onEngine<{ id: string }>("engine-agent-updated", ({ id }) => void homeStore.aiUpdated(id));
}
