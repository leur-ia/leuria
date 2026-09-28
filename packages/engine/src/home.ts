/**
 * Leuria's state on the visitor's machine, under `~/.leuria` (or
 * `LEURIA_HOME`):
 *
 *   config.json   engine settings (port, agent, the model chosen for each agent,
 *                 the agents known to work)
 *   models.json   the models each agent offered, so none is started just to list them
 *   grants.json   sites the visitor approved, with hashed tokens
 *   agents/       agent adapters installed by `leuria setup`
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 19570;
export const DEFAULT_AGENT = "claude-acp";

export interface EngineConfig {
	port: number;
	/** Agent id from {@link SUPPORTED_AGENTS}, or an ACP registry id. */
	agent: string;
	/** Your AIs besides the default: agents and service models the visitor set up. */
	ais?: string[];
	/** The model chosen for each agent (agent id → model id); the agent's default otherwise. */
	models?: Record<string, string>;
	/**
	 * Agents known to work (agent id → when last confirmed): signed in and
	 * answering. Startup trusts this instead of starting the agent; a real
	 * session that finds the agent signed out removes it.
	 */
	ready?: Record<string, string>;
	/**
	 * The embedding model sites get (`POST /embed`): one the visitor chose,
	 * or `off` (sites can't embed). Absent: the first one found on this computer.
	 */
	embed?: EmbedChoice;
}

export type EmbedChoice = "off" | { provider: string; model: string };

function parseEmbedChoice(value: unknown): EmbedChoice | undefined {
	if (value === "off") return "off";
	const { provider, model } = (value ?? {}) as { provider?: unknown; model?: unknown };
	return typeof provider === "string" && typeof model === "string" && provider && model ? { provider, model } : undefined;
}

export function leuriaHome(): string {
	return process.env.LEURIA_HOME ?? join(homedir(), ".leuria");
}

export function homePath(...parts: string[]): string {
	return join(leuriaHome(), ...parts);
}

export function loadConfig(): EngineConfig {
	const stored = readJson<Partial<EngineConfig>>(homePath("config.json")) ?? {};
	return {
		port: typeof stored.port === "number" ? stored.port : DEFAULT_PORT,
		agent: typeof stored.agent === "string" && stored.agent ? stored.agent : DEFAULT_AGENT,
		...(Array.isArray(stored.ais) ? { ais: stored.ais.filter((a): a is string => typeof a === "string") } : {}),
		...(stored.models && typeof stored.models === "object" ? { models: stored.models } : {}),
		...(stored.ready && typeof stored.ready === "object" ? { ready: stored.ready } : {}),
		...(parseEmbedChoice(stored.embed) ? { embed: parseEmbedChoice(stored.embed) } : {}),
	};
}

/** Is `id` known to work (confirmed by a check, a sign-in or a real session)? */
export function isKnownReady(id: string): boolean {
	return Boolean(loadConfig().ready?.[id]);
}

/** Remember whether `id` works; written only when it changes (or to refresh the date once a day). */
export function rememberReady(id: string, ok: boolean): void {
	const config = loadConfig();
	const ready = { ...config.ready };
	const last = ready[id];
	if (ok) {
		if (last && Date.now() - Date.parse(last) < 86_400_000) return;
		ready[id] = new Date().toISOString();
	} else {
		if (!last) return;
		delete ready[id];
	}
	saveConfig({ ...config, ready });
}

export function saveConfig(config: EngineConfig): void {
	writeJson(homePath("config.json"), config);
}

export function readJson<T>(path: string): T | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as T;
	} catch {
		return null;
	}
}

/** Atomic write, readable by the current user only. */
export function writeJson(path: string, data: unknown): void {
	mkdirSync(leuriaHome(), { recursive: true, mode: 0o700 });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
	renameSync(tmp, path);
	try {
		chmodSync(path, 0o600);
	} catch {
		// not supported on this platform
	}
}
