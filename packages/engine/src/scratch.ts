import { rm } from "node:fs/promises";

/**
 * Delete a scratch folder (an agent's sandbox) without ever failing the
 * caller. On Windows a folder can't be deleted while a program still has it
 * open, and an agent takes a moment to exit after it is closed: retry in the
 * background for a few seconds, then leave it to the system's temp cleanup.
 */
export function removeScratch(dir: string, onFailure?: (error: unknown) => void): void {
	rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch((error: unknown) => onFailure?.(error));
}
