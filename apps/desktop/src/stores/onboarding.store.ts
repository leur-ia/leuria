import { createStore } from "@sinuxjs/core";

import { appStore } from "./app.store";
import { type AgentChoice, type AgentModels, engine, failureText, friendlyName, plainReason, onEngine, type SignInStatus, type TestResult } from "../engine";

export type Step =
	| { kind: "choose" }
	| { kind: "installing"; agent: AgentChoice }
	| { kind: "signin"; agent: AgentChoice; status: SignInStatus }
	| { kind: "checking"; agent: AgentChoice }
	| { kind: "done"; agent: AgentChoice; result: TestResult };

/** The "Another AI service" form. */
/** Services people know, so the address is filled in for them; "other" asks for it. */
export const SERVICES = [
	{ id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
	{ id: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
	{ id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
	{ id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
	{ id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
] as const;

/** Adding an AI starts with what kind: an app you sign in to, a model on this computer, a service with a key. */
export type AiKind = "app" | "local" | "service";

export interface ApiForm {
	/** A known service (its address filled in), or "other". */
	preset: string;
	name: string;
	baseUrl: string;
	apiKey: string;
	busy: boolean;
	error: string;
}

export interface OnboardingState {
	/** `setup`: choose the default AI. `add`: set up one more of Your AIs; the default stays. */
	mode: "setup" | "add";
	/** Your AIs already set up: not offered again when adding one. */
	exclude: string[];
	/** Adding: the kind chosen first (null: still asking). */
	kind: AiKind | null;
	agents: AgentChoice[] | null;
	/**
	 * Pre-selected from what detection found (Tesler's Law): an agent id,
	 * `local` (a model on this computer) or `api` (an OpenAI-compatible service).
	 */
	selected: string | null;
	/** The model picked under `local` and under `api`. */
	localModel: string | null;
	apiModel: string | null;
	api: ApiForm;
	/** Show the "add a service" form (always, until one exists). */
	apiFormOpen: boolean;
	showAll: boolean;
	/** Filter for the full list of AIs. */
	query: string;
	/** Models of the chosen AI, once signed in, when it lets you choose. */
	models: AgentModels | null;
	step: Step;
	/** Latest progress line from the engine (install, sign-in, check). */
	progress: string;
	/** The sign-in page the AI opened, offered as a link in case the browser did not come up. */
	signinUrl: string;
	error: string;
}

const initial: OnboardingState = {
	mode: "setup",
	exclude: [],
	kind: null,
	agents: null,
	selected: null,
	localModel: null,
	apiModel: null,
	api: { preset: "other", name: "", baseUrl: "", apiKey: "", busy: false, error: "" },
	apiFormOpen: false,
	showAll: false,
	query: "",
	models: null,
	step: { kind: "choose" },
	progress: "",
	signinUrl: "",
	error: "",
};

/** Prefer a model already loaded in memory: it answers at once. */
function firstModel(agents: AgentChoice[], local: boolean): string | null {
	const models = agents.filter((a) => a.kind === "llm" && Boolean(a.local) === local);
	return (models.find((a) => a.current) ?? models.find((a) => a.loaded) ?? models[0])?.id ?? null;
}

/** Agents offered first when nothing is found on the computer. */
export const SUGGESTED = ["codex-acp", "claude-acp"];

/** Found on this computer first, then the suggested ones, then the rest. */
export function byRelevance(a: AgentChoice, b: AgentChoice): number {
	const rank = (x: AgentChoice) => (x.found ? 2 : 0) + (SUGGESTED.includes(x.id) ? 1 : 0);
	// Serial Position Effect: the recommended option goes first.
	const order = (x: AgentChoice) => (SUGGESTED.includes(x.id) ? SUGGESTED.indexOf(x.id) : SUGGESTED.length);
	return rank(b) - rank(a) || order(a) - order(b);
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Run the check and land on the result. */
async function check(agent: AgentChoice): Promise<Partial<OnboardingState>> {
	onboardingStore.updateState({ step: { kind: "checking", agent }, progress: "" });
	return { step: { kind: "done", agent, result: await engine.test(agent.id) } };
}

export const onboardingStore = createStore(initial, {
	load: async (state) => {
		try {
			const agents = [...(await engine.agents())].filter((a) => !state.exclude.includes(a.id)).sort(byRelevance);
			// An AI that stopped working is not offered first; adding one never pre-selects the default.
			const current =
				state.mode === "add" || appStore.getState().agentProblem ? undefined : agents.find((a) => a.current && a.installed);
			const selected =
				state.selected ??
				(current?.kind === "llm" ? (current.local ? "local" : "api") : current?.id) ??
				agents.find((a) => a.kind === "agent")?.id ??
				null;
			return {
				agents,
				selected,
				localModel: state.localModel ?? firstModel(agents, true),
				apiModel: state.apiModel ?? firstModel(agents, false),
				error: "",
			};
		} catch (error) {
			console.warn("Listing AIs failed:", error);
			return { error: failureText(error, "Leuria couldn't list the AIs. Check your internet connection, then try again.") };
		}
	},
	select: (_state, id: string) => ({ selected: id }),
	selectModel: (_state, where: "local" | "api", id: string) => (where === "local" ? { localModel: id } : { apiModel: id }),
	openApiForm: () => ({ apiFormOpen: true }),
	editApi: (state, patch: Partial<Pick<ApiForm, "name" | "baseUrl" | "apiKey">>) => ({ api: { ...state.api, ...patch, error: "" } }),
	/** Test and save an OpenAI-compatible service, then offer its models. */
	addApi: async (state) => {
		const { name, baseUrl, apiKey } = state.api;
		onboardingStore.updateState({ api: { ...state.api, busy: true, error: "" } });
		try {
			const saved = await engine.addProvider(name || "My AI service", baseUrl, apiKey || undefined);
			const agents = [...(await engine.agents())].sort(byRelevance);
			const first = saved.models[0] ? `llm:${saved.id}/${saved.models[0].id}` : null;
			return {
				agents,
				apiModel: first,
				apiFormOpen: false,
				api: { preset: "other", name: "", baseUrl: "", apiKey: "", busy: false, error: first ? "" : "Connected, but this service lists no chat model." },
			};
		} catch (error) {
			return { api: { ...state.api, busy: false, error: message(error) } as ApiForm };
		}
	},
	showAll: () => ({ showAll: true }),
	/** Adding: the kind of AI, then only its choices. */
	chooseKind: (state, kind: AiKind) => {
		const firstApp = (state.agents ?? []).find((a) => a.kind === "agent")?.id ?? null;
		const selected = kind === "local" ? "local" : kind === "service" ? "api" : firstApp;
		const openai = SERVICES[0];
		return {
			kind,
			selected,
			showAll: false,
			query: "",
			error: "",
			apiFormOpen: kind === "service" && !(state.agents ?? []).some((a) => a.kind === "llm" && !a.local),
			// The best-known service first; "Another service" is one choice away.
			...(kind === "service" ? { api: { ...state.api, preset: openai.id, name: openai.name, baseUrl: openai.baseUrl, error: "" } } : {}),
		};
	},
	backToKinds: () => ({ kind: null, error: "", showAll: false, query: "" }),
	/** Look again (LM Studio or Ollama opened meanwhile). */
	reload: () => ({ agents: null }),
	/** A known service fills in its name and address; "other" asks for them. */
	pickService: (state, preset: string) => {
		const service = SERVICES.find((s) => s.id === preset);
		return {
			api: { ...state.api, preset, error: "", ...(service ? { name: service.name, baseUrl: service.baseUrl } : { name: "", baseUrl: "" }) },
		};
	},
	filter: (_state, query: string) => ({ query }),
	/** Use this model with the chosen AI (from its next conversation). */
	setModel: async (state, agent: string, model: string) => {
		const before = state.models;
		onboardingStore.updateState({ models: before ? { ...before, current: model } : before });
		try {
			await engine.setAgentModel(agent, model);
			return {};
		} catch (error) {
			console.warn("Changing the model failed:", error);
			return { models: before, error: failureText(error, "The model didn't change. Try again.") };
		}
	},
	back: () => ({ step: { kind: "choose" } as Step, error: "", progress: "" }),
	progress: (_state, text: string) => ({ progress: text }),
	signinUrl: (_state, url: string) => ({ signinUrl: url }),
	/** Install the agent from the registry, then sign in or go straight to the check. */
	choose: async (state, picked: AgentChoice) => {
		// A service's model: the service is the AI ("LM Studio"), the model its choice, changeable later.
		const agent: AgentChoice =
			picked.kind === "llm" && picked.provider ? { ...picked, id: `llm:${picked.provider.id}`, name: picked.provider.name } : picked;
		onboardingStore.updateState({ step: { kind: "installing", agent }, error: "", progress: "" });
		try {
			// Setting up the default, or one more of Your AIs.
			if (state.mode === "add") await engine.addAi(agent.id);
			else await engine.chooseAgent(agent.id);
			if (agent !== picked && picked.model) await engine.setAgentModel(agent.id, picked.model);
			const status = await engine.signInStatus(agent.id);
			onboardingStore.updateState({ models: status.models ?? null });
			if (status.ok) return await check(agent);
			// Signed out is the usual case; otherwise the AI's own reason when it is written for people.
			return { step: { kind: "signin", agent, status } as Step, error: status.detail === "not signed in" ? "" : (plainReason(status.detail) ?? "") };
		} catch (error) {
			// The engine removes a half-finished install itself; nothing else is erased here
			// (an error may have nothing to do with this AI, like an outdated engine).
			console.warn(`Setting up ${agent.id} failed:`, error);
			return {
				step: { kind: "choose" } as Step,
				error: failureText(error, `Couldn't set up ${friendlyName(agent)}. Check your internet connection, then try again, or pick another AI.`),
				progress: "",
			};
		}
	},
	/** ACP authenticate: the agent opens the browser and waits for the sign-in there. */
	signIn: async (_state, agent: AgentChoice, methodId: string) => {
		onboardingStore.updateState({ progress: "waiting", error: "", signinUrl: "" });
		try {
			const status = await engine.signIn(methodId, agent.id);
			if (status.ok) {
				onboardingStore.updateState({ models: status.models ?? null });
				return await check(agent);
			}
			// Cancelled: back to the same screen, with its sign-in buttons.
			if (status.detail === "cancelled") return { progress: "", error: "" };
			return {
				step: { kind: "signin", agent, status } as Step,
				progress: "",
				// The AI's own reason when it gave one (e.g. Google no longer allows this sign-in).
				error: plainReason(status.detail) ?? "The sign-in didn't finish. Try again, and complete it in your browser.",
			};
		} catch (error) {
			console.warn("Sign-in failed:", error);
			return { error: failureText(error, "The sign-in didn't finish. Try again, and complete it in your browser."), progress: "" };
		}
	},
	/** Stop waiting for the browser; the engine stops the sign-in. */
	cancelSignIn: async () => {
		await engine.cancelSignIn().catch(() => undefined);
		return { progress: "" };
	},
	/**
	 * "Choose another AI" after this one did not work: stop any sign-in and
	 * erase what Leuria kept for it, so choosing it again starts over.
	 */
	startOver: async (state, agent: AgentChoice) => {
		await engine.resetAgent(agent.id).catch(() => undefined);
		if (state.mode === "add") await engine.removeAi(agent.id).catch(() => undefined);
		return { step: { kind: "choose" } as Step, error: "", progress: "" };
	},
	retryCheck: async (_state, agent: AgentChoice) => check(agent),
	/** Start setting up one more AI; the list leaves out Your AIs. */
	startAdd: (_state, exclude: string[]) => ({ ...initial, mode: "add" as const, exclude }),
	/** Back to choosing the default AI (first run, or the default stopped working). */
	startSetup: () => ({ ...initial }),
});

// Only the stage is kept: the app words it (activityText), never the engine's own message.
onEngine<{ stage?: string; step?: number }>("engine-progress", ({ stage, step }) => {
	if (stage) void onboardingStore.progress(stage === "check" ? `check-${step ?? 1}` : stage);
});
onEngine<{ url: string }>("engine-signin-url", ({ url }) => void onboardingStore.signinUrl(url));
