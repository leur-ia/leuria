import type { LeuriaState, ProviderSnapshot } from "@leuria/client";

import { useLeuria } from "./context.js";
import { useSelector } from "./store.js";

const whole = (state: LeuriaState) => state;

/**
 * Every provider's state, plus `active` (what would answer now) and
 * `pending` (what a click would enable). Pass a selector to re-render
 * only when part of it changes.
 */
export function useLeuriaState(): LeuriaState;
export function useLeuriaState<T>(selector: (state: LeuriaState) => T): T;
export function useLeuriaState<T>(selector?: (state: LeuriaState) => T): T | LeuriaState {
	const client = useLeuria();
	return useSelector<LeuriaState, T | LeuriaState>(client.subscribe, client.getState, selector ?? whole);
}

/** One provider's state, e.g. `useProvider("bridge")`. */
export function useProvider(id: string): ProviderSnapshot | undefined {
	return useLeuriaState((state) => state.providers.find((p) => p.id === id));
}
