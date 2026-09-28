import { useRef, useSyncExternalStore } from "react";

/**
 * `useSyncExternalStore` with a selector: re-renders only when the
 * selected value changes (`Object.is`), and never loops on a selector
 * that builds a new value from the same state.
 */
export function useSelector<S, T>(subscribe: (listener: () => void) => () => void, getState: () => S, selector: (state: S) => T): T {
	const cache = useRef<{ state: S; selector: (state: S) => T; value: T } | null>(null);
	const getSnapshot = (): T => {
		const state = getState();
		const last = cache.current;
		if (last && last.state === state && last.selector === selector) return last.value;
		const value = selector(state);
		if (last && Object.is(last.value, value)) {
			cache.current = { state, selector, value: last.value };
			return last.value;
		}
		cache.current = { state, selector, value };
		return value;
	};
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
