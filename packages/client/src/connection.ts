/**
 * `connection(ai)`: where the visitor is in connecting their AI to this
 * site, for any UI (the Connect UI, React hooks, a plain page). The core
 * state says what each provider is; this adds what the visitor is doing
 * about it (waiting in Leuria's approval window, or having said no),
 * shared by every piece of UI that shows it.
 *
 *   const bridge = connection(ai)
 *   bridge.subscribe(() => render(bridge.getState().status))
 *   button.onclick = () => bridge.connect()
 */

import type { Leuria, ProviderSnapshot } from "./leuria.js";

/**
 * - `checking`: the first look has not answered yet;
 * - `not-running`: Leuria didn't answer the last connect (not running, or not
 *   installed), or a connected site can't reach it;
 * - `not-connected`: this site is not connected. Leuria answers no site it
 *   doesn't know, so whether it is installed is only learned by connecting;
 * - `connecting`: waiting for the visitor to allow the site;
 * - `declined`: the visitor did not allow it, or closed the window;
 * - `connected`: the site can use the visitor's AI.
 */
export type ConnectStatus = "checking" | "not-running" | "not-connected" | "connecting" | "declined" | "connected";

export interface ConnectionState {
	status: ConnectStatus;
	provider?: ProviderSnapshot;
	/**
	 * What could answer instead, when the visitor picks it (this browser's
	 * AI, the site's own): secondary choices, offered next to getting
	 * Leuria. See `LeuriaOptions.fallback`.
	 */
	alternatives: ProviderSnapshot[];
	/** The visitor's AI, in their words (e.g. "Codex"), once known. */
	model?: string;
	/** Why the last attempt failed, when `status` is `declined`. */
	error?: Error;
}

export interface Connection {
	getState: () => ConnectionState;
	subscribe: (listener: () => void) => () => void;
	/** Ask the visitor to allow this site. Call it from a click: it may open a window. */
	connect: () => void;
	/** Forget this site's connection in this browser. */
	disconnect: () => void;
	/** Look again, e.g. after the visitor started Leuria. */
	retry: () => Promise<void>;
	/** The visitor picked another AI for this page (downloads it if needed). Call it from a click. */
	chooseInstead: (providerId: string) => void;
	/** Open the visitor's settings for this site (their AI and model), when the provider has them. Call it from a click. */
	manage: () => void;
	/** Whether `manage()` does anything for this provider. */
	canManage: boolean;
}

interface Attempt {
	connecting: boolean;
	error?: Error;
	/** Only the latest attempt's outcome counts. */
	id: number;
}

function statusOf(provider: ProviderSnapshot | undefined, attempt: Attempt): ConnectStatus {
	if (provider?.status === "ready") return "connected";
	// Leuria didn't answer: say so (and offer to get it), even while the attempt waits on.
	if (provider?.status === "unavailable") return "not-running";
	if (attempt.connecting) return "connecting";
	if (!provider || provider.status === "unknown" || provider.status === "detecting") return "checking";
	return attempt.error ? "declined" : "not-connected";
}

function create(ai: Leuria, providerId: string): Connection {
	const listeners = new Set<() => void>();
	let attempt: Attempt = { connecting: false, id: 0 };
	let state: ConnectionState | undefined;

	const compute = (): ConnectionState => {
		const { providers, alternatives } = ai.getState();
		const provider = providers.find((p) => p.id === providerId);
		const status = statusOf(provider, attempt);
		const error = status === "declined" ? attempt.error : undefined;
		// Same values, same object: callers can compare snapshots by identity.
		if (state && state.status === status && state.provider === provider && state.error === error && state.alternatives === alternatives) return state;
		return { status, provider, model: provider?.model, error, alternatives };
	};
	const refresh = () => {
		const next = compute();
		if (next === state) return;
		state = next;
		for (const listener of listeners) listener();
	};
	const setAttempt = (next: Attempt) => {
		attempt = next;
		refresh();
	};
	ai.subscribe(refresh);

	return {
		getState: () => (state ??= compute()),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		connect: () => {
			// A second click while Leuria is opening changes nothing; after "not running" it tries again.
			if (attempt.connecting && state?.status !== "not-running") return;
			const id = attempt.id + 1;
			// Shown at once (Doherty Threshold), while Leuria opens its window.
			setAttempt({ connecting: true, id });
			ai.connect(providerId).then(
				() => attempt.id === id && setAttempt({ connecting: false, id }),
				(error: unknown) => attempt.id === id && setAttempt({ connecting: false, id, error: error instanceof Error ? error : new Error(String(error)) }),
			);
		},
		disconnect: () => {
			setAttempt({ connecting: false, id: attempt.id + 1 });
			ai.disconnect(providerId);
		},
		retry: async () => {
			setAttempt({ connecting: false, id: attempt.id + 1 });
			await ai.detect();
		},
		manage: () => ai.providers.find((p) => p.id === providerId)?.manage?.(),
		canManage: Boolean(ai.providers.find((p) => p.id === providerId)?.manage),
		chooseInstead: (id) => {
			ai.chooseInstead(id);
			const chosen = ai.getState().providers.find((p) => p.id === id);
			if (chosen?.status === "needs-action") void ai.connect(id).catch(() => undefined);
		},
	};
}

const connections = new WeakMap<Leuria, Map<string, Connection>>();

/** The connect flow of one provider, by default the visitor's own AI through Leuria. One per client and provider. */
export function connection(ai: Leuria, providerId = "bridge"): Connection {
	let byId = connections.get(ai);
	if (!byId) {
		byId = new Map();
		connections.set(ai, byId);
	}
	let found = byId.get(providerId);
	if (!found) {
		found = create(ai, providerId);
		byId.set(providerId, found);
	}
	return found;
}
