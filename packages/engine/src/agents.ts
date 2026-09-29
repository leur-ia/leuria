/**
 * Agents, straight from the ACP registry. Any registry agent can be used:
 * it is installed once from its registry entry (npx package, uvx package
 * or binary archive) under `~/.leuria/agents/<id>@<version>`, so later
 * sessions start without a download and work offline.
 *
 * Sign-in follows ACP too (see `auth.ts`): `authenticate` with a method
 * the agent advertises.
 *
 * A few agents get an extra hardening profile on top (`profiles.ts`),
 * keyed by registry id.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { clearRegistryCache, fetchRegistry, getRegistryEntry, platformKey, type RegistryEntry, runnableHere } from "./acp/registry.js";
import { homePath, loadConfig } from "./home.js";
import { defaultModel, getProvider, isLlmId, listModels, llmDisplayName, parseLlmId } from "./llm/providers.js";
import { profileFor } from "./profiles.js";
import type { AgentLaunch } from "./session-manager.js";

const execFileAsync = promisify(execFile);
const MANIFEST = "leuria-agent.json";

/** An agent installed from the registry, ready to spawn. */
export interface InstalledAgent {
	id: string;
	name: string;
	version: string;
	dir: string;
	command: string;
	/** What runs the agent before its registry args, e.g. the package's JS entry. */
	launchArgs: string[];
	/** The registry's args; terminal auth methods replace these. */
	args: string[];
	env: Record<string, string>;
}

export function agentsDir(): string {
	return homePath("agents");
}

/** The newest installed version of `id`, if any. */
export function installedAgent(id: string): InstalledAgent | null {
	const root = agentsDir();
	if (!existsSync(root)) return null;
	const versions = readdirSync(root)
		.filter((name) => name.startsWith(`${id}@`) && existsSync(join(root, name, MANIFEST)))
		.sort(compareVersions);
	const latest = versions[versions.length - 1];
	if (!latest) return null;
	const agent = JSON.parse(readFileSync(join(root, latest, MANIFEST), "utf-8")) as InstalledAgent;
	return { ...agent, launchArgs: agent.launchArgs ?? [] };
}

/**
 * The agent to run: the installed version, or a fresh install from the
 * registry. `update` installs the registry's current version if newer.
 */
export function ensureAgent(
	id: string,
	options: { update?: boolean; onProgress?: (message: string) => void } = {},
): Promise<InstalledAgent> {
	// One install per agent at a time: concurrent callers share it.
	const key = `${id}:${options.update ? "update" : "any"}`;
	const running = installing.get(key);
	if (running) return running;
	const work = ensureAgentOnce(id, options).finally(() => installing.delete(key));
	installing.set(key, work);
	return work;
}

const installing = new Map<string, Promise<InstalledAgent>>();

async function ensureAgentOnce(
	id: string,
	options: { update?: boolean; onProgress?: (message: string) => void },
): Promise<InstalledAgent> {
	const installed = installedAgent(id);
	if (installed && !options.update) return installed;
	const entry = await getRegistryEntry(id);
	if (!entry) {
		if (installed) return installed;
		throw new Error(`"${id}" is not in the ACP registry (or the registry is unreachable). Run \`leuria agents\` to list agents.`);
	}
	if (installed?.version === entry.version) return installed;
	options.onProgress?.(`Installing ${entry.name} ${entry.version} from the ACP registry…`);
	return install(entry);
}

/** The agents installed here, by registry id. */
function installedIds(): string[] {
	const root = agentsDir();
	if (!existsSync(root)) return [];
	const ids = readdirSync(root)
		.filter((name) => name.includes("@") && existsSync(join(root, name, MANIFEST)))
		.map((name) => name.slice(0, name.lastIndexOf("@")));
	return [...new Set(ids)];
}

/**
 * Keep only the newest version of each installed agent. Call it before any
 * session starts: an older version may be running otherwise.
 */
export function pruneAgentVersions(): void {
	const root = agentsDir();
	for (const id of installedIds()) {
		const versions = readdirSync(root)
			.filter((name) => name.startsWith(`${id}@`) && existsSync(join(root, name, MANIFEST)))
			.sort(compareVersions);
		for (const old of versions.slice(0, -1)) rmSync(join(root, old), { recursive: true, force: true });
	}
}

/**
 * Install the registry's newer version of every agent installed here (new
 * models, fixes). New sessions use it; running ones keep theirs until they
 * end. One that fails keeps its version and is tried again next time.
 */
export async function updateAgents(onUpdated?: (agent: InstalledAgent, from: string) => Promise<void> | void): Promise<void> {
	clearRegistryCache();
	for (const id of installedIds()) {
		const installed = installedAgent(id);
		const entry = await getRegistryEntry(id);
		if (!installed || !entry || !runnableHere(entry) || compareVersions(entry.version, installed.version) <= 0) continue;
		try {
			const agent = await ensureAgent(id, { update: true });
			await onUpdated?.(agent, installed.version);
		} catch {
			// Offline, or the install failed: the current version keeps working.
		}
	}
}

/**
 * How the engine launches `id` for a session: an ACP agent or an LLM
 * provider. `model` overrides the model chosen for the agent (a site's own choice).
 */
export async function resolveAgentCommand(id: string, model?: string): Promise<AgentLaunch & { name: string }> {
	if (isLlmId(id)) {
		const parsed = parseLlmId(id);
		const provider = parsed && getProvider(parsed.providerId);
		if (!parsed || !provider) throw new Error(`Unknown AI "${id}". Choose it again in Leuria.`);
		// A service AI uses the site's model, else the one chosen for it, else one it has loaded.
		const chosen = parsed.model ?? model ?? loadConfig().models?.[id] ?? defaultModel(await listModels(provider));
		if (!chosen) throw new Error(`${provider.name} has no model to answer with. Open it and load one.`);
		return { id, command: "", args: [], llm: { provider, model: chosen }, name: llmDisplayName(id) };
	}
	const agent = await ensureAgent(id);
	return {
		id,
		command: agent.command,
		args: [...agent.launchArgs, ...agent.args],
		env: agent.env,
		model: model ?? loadConfig().models?.[id],
		name: agent.name,
		configure: profileFor(id)?.configure,
	};
}

/** The AI and model a site uses: its own choices, else the default AI and that AI's model choice. */
export function resolveSiteAgent(
	grant: { agent?: string; model?: { agent: string; id: string } } | undefined,
	defaultAgent: string,
): Promise<AgentLaunch & { name: string }> {
	const id = grant?.agent ?? defaultAgent;
	// A model chosen for another AI (the site's AI changed since) does not apply.
	return resolveAgentCommand(id, grant?.model?.agent === id ? grant.model.id : undefined);
}

/** Names people know, where the registry's differs; the app uses the same ones. */
const DISPLAY_NAMES: Record<string, string> = {
	"codex-acp": "ChatGPT (Codex)",
	"claude-acp": "Claude",
	gemini: "Gemini",
	"github-copilot-cli": "GitHub Copilot",
};

/** Plain-language name for the configured agent. */
export function agentName(id: string): string {
	if (isLlmId(id)) return llmDisplayName(id);
	return DISPLAY_NAMES[id] ?? installedAgent(id)?.name ?? id;
}

/**
 * Forget an agent that failed to install or sign in, so the next try
 * starts fresh: its installed versions and Leuria's own folder for its
 * settings and sign-in. The visitor's own CLI setup (`~/.gemini`,
 * `~/.codex`…) is never touched. LLMs have nothing to erase.
 */
export function resetAgent(id: string): void {
	if (isLlmId(id)) return;
	const home = profileFor(id)?.home?.();
	if (home) rmSync(home, { recursive: true, force: true });
	const root = agentsDir();
	if (!existsSync(root)) return;
	for (const name of readdirSync(root)) {
		if (name.startsWith(`${id}@`)) rmSync(join(root, name), { recursive: true, force: true });
	}
}

/** Is `id` ready to run without installing: an installed agent or a known LLM provider. */
export function isAvailable(id: string): boolean {
	if (isLlmId(id)) {
		const parsed = parseLlmId(id);
		return Boolean(parsed && getProvider(parsed.providerId));
	}
	return installedAgent(id) !== null;
}

export async function listAgents(): Promise<Array<RegistryEntry & { installed?: string }>> {
	return (await fetchRegistry()).map((entry) => ({ ...entry, installed: installedAgent(entry.id)?.version }));
}

// ── Install ─────────────────────────────────────────────────────────────

async function install(entry: RegistryEntry): Promise<InstalledAgent> {
	const dir = join(agentsDir(), `${entry.id}@${entry.version}`);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const d = entry.distribution;
	const binary = d.binary?.[platformKey()];
	let launch: Pick<InstalledAgent, "command" | "launchArgs" | "args" | "env">;
	try {
		if (d.npx) launch = await installPackage(dir, d.npx.package, d.npx.args ?? [], d.npx.env ?? {});
		else if (binary) launch = await installBinary(dir, binary);
		else if (d.uvx) launch = { command: "uvx", launchArgs: [d.uvx.package], args: d.uvx.args ?? [], env: d.uvx.env ?? {} };
		else throw new Error(`${entry.name} has no distribution for ${platformKey()}`);
	} catch (error) {
		rmSync(dir, { recursive: true, force: true });
		throw error;
	}
	const agent: InstalledAgent = { id: entry.id, name: entry.name, version: entry.version, dir, ...launch };
	try {
		await profileFor(entry.id)?.prepare?.(agent);
	} catch (error) {
		rmSync(dir, { recursive: true, force: true });
		throw error;
	}
	// Written last: a session only ever finds a version that is complete and prepared.
	writeFileSync(join(dir, MANIFEST), `${JSON.stringify(agent, null, 2)}\n`);
	return agent;
}

/** npm package: install it locally, run its bin with our runtime when it is JavaScript. */
async function installPackage(dir: string, spec: string, args: string[], env: Record<string, string>) {
	writeFileSync(join(dir, "package.json"), '{ "private": true }\n');
	if (process.versions.bun) {
		// Inside the desktop app there is no npm: the bundled Bun installs.
		await execFileAsync(process.execPath, ["add", spec], { cwd: dir, env: { ...process.env, BUN_BE_BUN: "1" }, timeout: 5 * 60_000 });
	} else {
		const npm = process.platform === "win32" ? "npm.cmd" : "npm";
		await execFileAsync(npm, ["install", "--no-audit", "--no-fund", "--omit=dev", "--loglevel=error", spec], {
			cwd: dir,
			timeout: 5 * 60_000,
			shell: process.platform === "win32",
		});
	}
	const name = spec.lastIndexOf("@") > 0 ? spec.slice(0, spec.lastIndexOf("@")) : spec;
	const pkgDir = join(dir, "node_modules", ...name.split("/"));
	const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8")) as { bin?: string | Record<string, string> };
	const bins = typeof manifest.bin === "string" ? { [name]: manifest.bin } : (manifest.bin ?? {});
	const binName = Object.keys(bins).find((b) => name.endsWith(b)) ?? Object.keys(bins)[0];
	if (!binName) throw new Error(`${spec} has no executable`);
	const entry = join(pkgDir, bins[binName]!);
	const isScript = /\.[cm]?js$/.test(entry) || /^#!.*\b(node|bun)\b/.test(readFileSync(entry, "utf-8").slice(0, 100));
	return isScript
		? { command: process.execPath, launchArgs: [entry], args, env }
		: { command: entry, launchArgs: [], args, env };
}

/** Binary archive: download, check its sha256, extract, point at `cmd`. */
async function installBinary(
	dir: string,
	target: { archive: string; cmd: string; args?: string[]; env?: Record<string, string>; sha256?: string },
) {
	const res = await fetch(target.archive, { signal: AbortSignal.timeout(5 * 60_000) });
	if (!res.ok) throw new Error(`Download failed (${res.status}): ${target.archive}`);
	const bytes = Buffer.from(await res.arrayBuffer());
	if (target.sha256) {
		const actual = createHash("sha256").update(bytes).digest("hex");
		if (actual !== target.sha256.toLowerCase()) throw new Error(`Checksum mismatch for ${target.archive}`);
	}
	// FORMAT.md: .zip, .tar.gz, .tgz, .tar.bz2, .tbz2, or a raw binary.
	const name = new URL(target.archive).pathname.split("/").pop() ?? "archive";
	const command = join(dir, target.cmd.replace(/^\.\//, ""));
	if (/\.zip$/i.test(name)) {
		const file = join(dir, name);
		writeFileSync(file, bytes);
		// bsdtar (macOS, Windows) reads zip; Linux tar does not.
		if (process.platform === "linux") await execFileAsync("unzip", ["-q", file, "-d", dir]);
		else await execFileAsync("tar", ["-xf", file, "-C", dir]);
	} else if (/\.(tar\.gz|tgz|tar\.bz2|tbz2)$/i.test(name)) {
		const file = join(dir, name);
		writeFileSync(file, bytes);
		await execFileAsync("tar", ["-xf", file, "-C", dir]);
	} else {
		// A raw binary is the command itself.
		mkdirSync(dirname(command), { recursive: true });
		writeFileSync(command, bytes);
	}
	if (!existsSync(command)) throw new Error(`${target.cmd} not found in ${target.archive}`);
	if (process.platform !== "win32") chmodSync(command, 0o755);
	return { command, launchArgs: [], args: target.args ?? [], env: target.env ?? {} };
}

/** Sort `id@1.2.10` after `id@1.2.9`. */
function compareVersions(a: string, b: string): number {
	const parse = (s: string) => (s.split("@").pop() ?? "").split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
	const pa = parse(a);
	const pb = parse(b);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const x = pa[i] ?? 0;
		const y = pb[i] ?? 0;
		if (x === y) continue;
		if (typeof x === "number" && typeof y === "number") return x - y;
		return String(x) < String(y) ? -1 : 1;
	}
	return 0;
}
