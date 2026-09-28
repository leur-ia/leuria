import ExecutionEnvironment from "@docusaurus/ExecutionEnvironment";
import type { Leuria } from "@leuria/client";
import type { Docs } from "@leuria/docs";
import { leuria } from "@leuria/docusaurus/client";
import { createStore } from "@sinuxjs/core";
import { useStore } from "@sinuxjs/react";

export interface SiteState {
	/** The site's Leuria client, once started in the browser (the Ask panel, search and the playground share it). */
	ai: Leuria | null;
	docs: Docs | null;
}

export const siteStore = createStore({ ai: null, docs: null } as SiteState, {
	started: (_state: SiteState, value: { ai: Leuria; docs: Docs }) => value,
});

// Bound once, at startup: @leuria/docusaurus starts the client after hydration.
if (ExecutionEnvironment.canUseDOM) void leuria.then((value) => siteStore.started(value));

/**
 * The site's state in a component. While Docusaurus renders pages at build
 * time, @sinuxjs/react 2.0.4 hands selectors `undefined` (its server
 * snapshot is empty), so this reads the store's initial state then.
 */
export function useSite<T>(select: (state: SiteState) => T): T {
	return useStore(siteStore, (state: SiteState | undefined) => select(state ?? { ai: null, docs: null }));
}
