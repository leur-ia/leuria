import type { Leuria } from "@leuria/client";

let current: Leuria | undefined;
const waiting = new Set<() => void>();

/**
 * The client every Leuria element uses unless it is given its own
 * (`element.client = ai`). Call it once, when the page creates its client.
 */
export function setDefaultClient(client: Leuria | undefined): void {
	current = client;
	for (const notify of [...waiting]) notify();
}

export function defaultClient(): Leuria | undefined {
	return current;
}

/** Be told when the default client changes. */
export function onDefaultClient(listener: () => void): () => void {
	waiting.add(listener);
	return () => waiting.delete(listener);
}
