import type { ToastMessage } from "@leuria/pearl";
import { createStore } from "@sinuxjs/core";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { type AgentModels, EngineOutdated, engine, failureText, friendlyName, onEngine, type PairingRequest, type SiteChoice, type Status } from "../engine";

export type View = "loading" | "error" | "onboarding" | "home";

/** "Check for updates": what the sidebar footer shows. */
export type UpdatePhase = "idle" | "checking" | "latest" | "failed" | "ready";

export interface AppState {
	view: View;
	status: Status | null;
	error: string;
	/** Sites waiting for the visitor's answer, oldest first. */
	requests: PairingRequest[];
	/** One toast at a time (Pearl Toast). */
	toast: ToastMessage | null;
	/** Models of the default AI, when it lets you choose; also listed in the tray menu. */
	models: AgentModels | null;
	/** Why the default AI does not work right now ("" when it does, or when none is set up yet). */
	agentProblem: string;
	/** What the start screen is waiting for, in plain words. */
	starting: string;
	/** The engine process ended: only a restart helps. */
	stopped: boolean;
	/** This app's version, and a newer one once it is installed and waits for a restart. */
	appVersion: string;
	update: { phase: UpdatePhase; version?: string };
}

const initial: AppState = { view: "loading", status: null, error: "", requests: [], toast: null, models: null, agentProblem: "", starting: "Starting Leuria…", stopped: false, appVersion: "", update: { phase: "idle" } };

/** A start-up check is running (the visitor may skip it). */
let checking = false;

function loadModels(): Promise<void> {
	return engine
		.models()
		.then(async (models) => {
			await appStore.modelsLoaded(models);
		})
		.catch(() => undefined);
}

/** Mirror the default AI's models in the tray's "Model" menu (hidden when there is no choice). */
function syncTray(models: AgentModels | null): void {
	const options = models && models.options.length > 1 ? models.options.map(({ id, name }) => ({ id, name })) : [];
	void invoke("set_tray_models", { models: options, current: models?.current ?? null }).catch(() => undefined);
}

export const appStore = createStore(initial, {
	/**
	 * Where are we. An AI known to work opens the home screen at once: it is
	 * not started (a website's first conversation is the check). Only an AI
	 * never confirmed, or found signed out, is checked here, and the visitor
	 * can skip that to choose another one.
	 */
	refresh: async (state) => {
		try {
			const status = await engine.status();
			// The newest route: an engine older than this window fails here, before any action.
			await engine.ais();
			if (status.agent.installed && status.agent.ready) {
				void loadModels();
				return { status, requests: status.pairing, view: "home" as View, agentProblem: "", error: "" };
			}
			if (!status.agent.installed) {
				syncTray(null);
				return { status, requests: status.pairing, view: "onboarding" as View, models: null, agentProblem: "", error: "" };
			}
			// Asking the AI takes a few seconds: say so on the start screen.
			if (state.view === "loading") appStore.updateState({ starting: `Checking that ${friendlyName(status.agent)} answers…` });
			checking = true;
			const signIn = await engine.signInStatus();
			const skipped = !checking;
			checking = false;
			const models = signIn.models ?? null;
			syncTray(models);
			return {
				status,
				models,
				requests: status.pairing,
				// Skipped while checking: stay on "Which AI do you use?".
				view: (skipped ? "onboarding" : signIn.ok ? "home" : "onboarding") as View,
				agentProblem: signIn.ok ? "" : signIn.detail,
				error: "",
			};
		} catch (error) {
			checking = false;
			if (error instanceof EngineOutdated) return { view: "error" as View, stopped: true, error: error.message };
			console.warn("Leuria could not reach its engine:", error);
			return { view: "error" as View, error: "Leuria isn't responding. Quit Leuria and open it again." };
		}
	},
	/** Skip the start-up check and choose another AI. */
	skipCheck: () => {
		checking = false;
		return { view: "onboarding" as View };
	},
	/** The default AI's models: saved ones, so the AI is not started just to list them. */
	modelsLoaded: (_state, models: AgentModels | null) => {
		syncTray(models);
		return { models };
	},
	startOnboarding: () => ({ view: "onboarding" as View }),
	/** Use this model with the default AI, from the next conversation (window or tray menu). */
	setModel: async (state, model: string) => {
		const agent = state.status?.agent.id;
		if (!agent || !state.models) return {};
		const before = state.models;
		const models = { ...before, current: model };
		appStore.updateState({ models });
		syncTray(models);
		try {
			await engine.setAgentModel(agent, model);
			return {};
		} catch (error) {
			syncTray(before);
			return {
				models: before,
				toast: { tone: "blocked", title: "The model didn't change", description: failureText(error, "Try again.") },
			};
		}
	},
	pairingRequested: (state, request: PairingRequest) => ({
		requests: [...state.requests.filter((r) => r.requestId !== request.requestId), request],
	}),
	/** Answered here or in the browser's approval window. */
	pairingSettled: (state, requestId: string) => ({
		requests: state.requests.filter((r) => r.requestId !== requestId),
	}),
	/** Allow or refuse a site; `choice` is its AI and model, when the visitor picked them (`aiName` for the toast). */
	decide: async (state, requestId: string, allow: boolean, choice: SiteChoice & { aiName?: string } = {}) => {
		const request = state.requests.find((r) => r.requestId === requestId);
		const { aiName, ...site } = choice;
		const decided = await engine.decide(requestId, allow, site).then(
			() => true,
			() => false,
		);
		const name = request ? (request.app ?? new URL(request.origin).host) : "The site";
		const toast: ToastMessage | null = !decided
			? { tone: "pending", title: "This request expired", description: "Ask the site to connect again." }
			: allow
				? {
						tone: "live",
						title: `Connected · ${name}`,
						description: aiName ? `It uses ${aiName}.` : state.status ? `It uses ${friendlyName(state.status.agent)}, on this computer.` : undefined,
					}
				: null;
		return { requests: state.requests.filter((r) => r.requestId !== requestId), toast };
	},
	showToast: (_state, toast: ToastMessage) => ({ toast }),
	dismissToast: () => ({ toast: null }),
	/** The app's version, and an update the background check already installed. */
	loadUpdate: async () => {
		const [appVersion, version] = await Promise.all([getVersion().catch(() => ""), invoke<string | null>("pending_update").catch(() => null)]);
		return version ? { appVersion, update: { phase: "ready" as UpdatePhase, version } } : { appVersion };
	},
	/** Look for a newer version now; one found is installed, then waits for a restart. */
	checkUpdate: async (state) => {
		if (state.update.phase === "checking" || state.update.phase === "ready") return {};
		appStore.updateState({ update: { phase: "checking" as UpdatePhase } });
		try {
			const version = await invoke<string | null>("check_update");
			return { update: version ? { phase: "ready" as UpdatePhase, version } : { phase: "latest" as UpdatePhase } };
		} catch {
			return { update: { phase: "failed" as UpdatePhase } };
		}
	},
	updateReady: (_state, version: string) => ({ update: { phase: "ready" as UpdatePhase, version } }),
	engineStopped: () => ({ view: "error" as View, stopped: true, error: "Leuria stopped working. Restart it to carry on." }),
	/** Try again, or restart the whole app when the engine is gone. */
	recover: async (state) => {
		if (state.stopped) {
			await invoke("restart_app").catch(() => undefined);
			return {};
		}
		appStore.updateState({ view: "loading" as View, starting: "Starting Leuria…" });
		return {};
	},
});

/** Engine events → store signals. Called once at startup, outside React. */
export function bindEngineEvents(): void {
	onEngine<PairingRequest>("pairing", (request) => void appStore.pairingRequested(request));
	onEngine<{ requestId: string }>("engine-pairing-decided", ({ requestId }) => {
		void appStore.pairingSettled(requestId).then(() => appStore.refresh());
	});
	onEngine("engine-exit", () => void appStore.engineStopped());
	void listen<{ version: string }>("update-ready", ({ payload }) => void appStore.updateReady(payload.version));
	void listen<{ id: string }>("tray-model", ({ payload }) => void appStore.setModel(payload.id));
	// A website's conversation found the default AI signed out: say so, and go back to choosing.
	onEngine<{ id: string; ok: boolean }>("engine-agent-state", ({ id, ok }) => {
		const { status } = appStore.getState();
		if (ok || !status || status.agent.id !== id) return;
		void appStore.showToast({
			tone: "blocked",
			title: `${friendlyName(status.agent)} is signed out`,
			description: "Sign in again to keep answering websites.",
		});
		void appStore.refresh();
	});
}
