/**
 * The ACP agent registry (https://agentclientprotocol.com/registry,
 * source and FORMAT.md at https://github.com/agentclientprotocol/registry):
 * one JSON document listing agents and how to run them.
 *
 *   distribution.npx     { package: "name@version", args?, env? }
 *   distribution.uvx     { package, args?, env? }
 *   distribution.binary  { "<os>-<arch>": { archive, cmd, args?, env?, sha256? } }
 */

const REGISTRY_URL =
	process.env.ACP_REGISTRY_URL ?? "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

interface PackageDistribution {
	package: string;
	args?: string[];
	env?: Record<string, string>;
}

interface BinaryTarget {
	archive: string;
	cmd: string;
	args?: string[];
	env?: Record<string, string>;
	sha256?: string;
}

export interface RegistryEntry {
	id: string;
	name: string;
	version: string;
	description?: string;
	repository?: string;
	website?: string;
	license?: string;
	icon?: string;
	distribution: {
		npx?: PackageDistribution;
		uvx?: PackageDistribution;
		binary?: Record<string, BinaryTarget>;
	};
}

/** `<os>-<arch>` as the registry names platforms, e.g. `darwin-aarch64`. */
export function platformKey(): string {
	const os: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" };
	const arch: Record<string, string> = { arm64: "aarch64", x64: "x86_64" };
	return `${os[process.platform] ?? process.platform}-${arch[process.arch] ?? process.arch}`;
}

const TTL_MS = 10 * 60_000;
const FAIL_TTL_MS = 60_000;
let cache: { at: number; agents: RegistryEntry[] } | null = null;
let failedAt = 0;

/** The registry's agents; `[]` when it cannot be reached. Cached for 10 minutes. */
export async function fetchRegistry(): Promise<RegistryEntry[]> {
	const now = Date.now();
	if (cache && now - cache.at < TTL_MS) return cache.agents;
	if (now - failedAt < FAIL_TTL_MS) return [];
	try {
		const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const payload = (await res.json()) as { agents?: unknown[] };
		const agents = (payload.agents ?? []).filter(
			(a): a is RegistryEntry =>
				typeof a === "object" && a !== null && typeof (a as RegistryEntry).id === "string" && typeof (a as RegistryEntry).distribution === "object",
		);
		cache = { at: now, agents };
		failedAt = 0;
		return agents;
	} catch {
		failedAt = now;
		return [];
	}
}

/** Ids that were renamed in the registry. */
const ALIASES: Record<string, string[]> = {
	"claude-acp": ["claude-code-acp"],
	"claude-code-acp": ["claude-acp"],
};

export async function getRegistryEntry(id: string): Promise<RegistryEntry | null> {
	const agents = await fetchRegistry();
	const ids = [id, ...(ALIASES[id] ?? [])];
	for (const candidate of ids) {
		const entry = agents.find((a) => a.id === candidate);
		if (entry) return entry;
	}
	return null;
}

/** Whether the registry offers a way to run this agent on this machine. */
export function runnableHere(entry: RegistryEntry): boolean {
	const d = entry.distribution;
	return Boolean(d.npx || d.uvx || d.binary?.[platformKey()]);
}

export function clearRegistryCache(): void {
	cache = null;
	failedAt = 0;
}
