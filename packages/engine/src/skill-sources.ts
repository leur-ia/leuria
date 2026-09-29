/**
 * Where a site's skills come from, and fetching them. A skill is a
 * `SKILL.md` (YAML front matter with `name` and `description`, then
 * instructions) and the text files beside it; see https://agentskills.io.
 *
 * Sources use the `npx skills` syntax, so developers paste the refs they
 * already use:
 *
 *   owner/repo                       every skill in a GitHub repository
 *   owner/repo@skill                 one skill, by name
 *   owner/repo/path/to/skills        the skills under a folder
 *   …#ref                            at a branch, tag or commit (pin it)
 *   https://github.com/o/r/tree/ref/path
 *   /  or  https://site.example/…    the site's own: `.well-known/agent-skills`
 *                                    (agentskills.io discovery) or a `SKILL.md` URL
 *
 * Only GitHub and the site's own origin: the engine never fetches an
 * address a site picks elsewhere, so a page can't point it at the visitor's
 * network. Only text is kept; scripts and binaries are dropped (the agent
 * has no shell to run them anyway).
 */

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative, sep } from "node:path";

import { downloadTemplate } from "giget";
import ipaddr from "ipaddr.js";
import { parse as parseYaml } from "yaml";

/** A skill as fetched: its instructions and text files. */
export interface SkillContent {
	name: string;
	description: string;
	/** `SKILL.md` without its front matter. */
	body: string;
	/** Other text files of the skill, by path relative to its folder. */
	files: Record<string, string>;
}

export type SkillSource =
	| { kind: "github"; repo: string; ref?: string; subpath?: string; skill?: string }
	| { kind: "site"; url: string };

/** Text files a skill may carry. Anything else (scripts, images, archives) is dropped. */
const TEXT_FILES = new Set([".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".csv"]);
const MAX_SKILL_BYTES = 256 * 1024;
const MAX_FILES = 50;
const MAX_TOTAL_BYTES = 1024 * 1024;
const MAX_DESCRIPTION = 1024;
const FETCH_TIMEOUT_MS = 15_000;
/** How deep to look for `SKILL.md` files in a repository. */
const MAX_DEPTH = 5;
const WELL_KNOWN = [".well-known/agent-skills", ".well-known/skills"];
const DISCOVERY_V2 = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
/** agentskills.io: lowercase letters, digits and single hyphens, up to 64. */
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REPO_PART = /^[A-Za-z0-9_.-]+$/;

/** Parse a source ref for the site at `origin`. Throws with a developer-facing reason. */
export function parseSkillSource(input: string, origin: string): SkillSource {
	let ref = input.trim();
	if (ref.startsWith("/") || /^https?:\/\//i.test(ref)) {
		const url = new URL(ref, origin);
		if (url.hostname === "github.com") return parseGithubUrl(url);
		if (url.origin !== origin) throw new Error(`${input}: skills come from GitHub or from the site's own origin (${origin})`);
		url.hash = "";
		return { kind: "site", url: url.toString() };
	}
	ref = ref.replace(/^github:/, "");
	let pin: string | undefined;
	let skill: string | undefined;
	const hash = ref.indexOf("#");
	if (hash >= 0) {
		const fragment = ref.slice(hash + 1);
		ref = ref.slice(0, hash);
		const at = fragment.indexOf("@");
		pin = (at >= 0 ? fragment.slice(0, at) : fragment) || undefined;
		skill = at >= 0 ? fragment.slice(at + 1) || undefined : undefined;
	}
	const at = ref.match(/^([^/]+)\/([^/@]+)@(.+)$/);
	if (at) return github(input, `${at[1]}/${at[2]}`, pin, undefined, skill ?? at[3]);
	const parts = ref.split("/").filter(Boolean);
	if (parts.length < 2) throw new Error(`${input}: expected owner/repo, owner/repo@skill, a GitHub URL, or a URL on the site`);
	return github(input, `${parts[0]}/${parts[1]}`, pin, parts.slice(2).join("/") || undefined, skill);
}

function parseGithubUrl(url: URL): SkillSource {
	const [owner, repo, marker, pin, ...rest] = url.pathname.split("/").filter(Boolean);
	if (!owner || !repo) throw new Error(`${url}: not a GitHub repository`);
	const tree = marker === "tree" && pin;
	return github(url.toString(), `${owner}/${repo.replace(/\.git$/, "")}`, tree ? pin : undefined, tree ? rest.join("/") || undefined : undefined, undefined);
}

function github(input: string, repo: string, ref?: string, subpath?: string, skill?: string): SkillSource {
	const [owner, name] = repo.split("/");
	if (![owner, name].every((part) => part && REPO_PART.test(part) && !/^\.+$/.test(part))) throw new Error(`${input}: not a GitHub repository`);
	if (subpath && subpath.split("/").some((p) => p === ".." || p === "." || !p)) throw new Error(`${input}: bad folder`);
	if (ref && !/^[\w./-]+$/.test(ref)) throw new Error(`${input}: bad ref`);
	return { kind: "github", repo, ...(ref ? { ref } : {}), ...(subpath ? { subpath } : {}), ...(skill ? { skill } : {}) };
}

/** A short name for where a skill comes from, for the visitor: `owner/repo` or the site's host. */
export function sourceLabel(source: SkillSource): string {
	return source.kind === "github" ? source.repo : new URL(source.url).host;
}

/** Fetch the skills a source names. Throws when it has none. */
export async function fetchSkills(source: SkillSource): Promise<SkillContent[]> {
	const skills = source.kind === "github" ? await fromGithub(source) : await fromSite(source.url);
	if (!skills.length) throw new Error("no skill found");
	return skills;
}

// ── SKILL.md ────────────────────────────────────────────────────────────

/** Parse a `SKILL.md`. Throws when its front matter lacks a valid name or description. */
export function parseSkillMd(text: string, files: Record<string, string> = {}): SkillContent {
	if (text.length > MAX_SKILL_BYTES) throw new Error("SKILL.md is too long");
	const match = text.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) throw new Error("SKILL.md has no front matter");
	const meta = parseYaml(match[1]!) as Record<string, unknown> | null;
	const name = typeof meta?.name === "string" ? meta.name.trim() : "";
	const description = typeof meta?.description === "string" ? meta.description.trim().replace(/\s+/g, " ") : "";
	if (!SKILL_NAME.test(name) || name.length > 64) throw new Error(`SKILL.md name "${name}" is not a skill name`);
	if (!description) throw new Error(`SKILL.md of ${name} has no description`);
	return { name, description: description.slice(0, MAX_DESCRIPTION), body: match[2]!.trim(), files };
}

// ── GitHub ──────────────────────────────────────────────────────────────

async function fromGithub(source: Extract<SkillSource, { kind: "github" }>): Promise<SkillContent[]> {
	const dir = await mkdtemp(join(tmpdir(), "leuria-skills-"));
	try {
		const path = source.subpath ? `/${source.subpath}` : "";
		// `HEAD`: the repository's default branch, whatever its name.
		await downloadTemplate(`gh:${source.repo}${path}#${source.ref ?? "HEAD"}`, {
			dir,
			force: true,
			forceClean: true,
			registry: false,
			silent: true,
			ignore: (file) => !TEXT_FILES.has(extname(file).toLowerCase()),
		});
		const found: SkillContent[] = [];
		for (const skillFile of await findSkillFiles(dir, 0)) {
			let skill: SkillContent;
			try {
				skill = parseSkillMd(await readFile(skillFile, "utf-8"));
			} catch {
				continue;
			}
			if (source.skill && skill.name !== source.skill) continue;
			skill.files = await readTextFiles(join(skillFile, ".."));
			found.push(skill);
		}
		return found;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function findSkillFiles(dir: string, depth: number): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const own = entries.find((e) => e.isFile() && e.name.toLowerCase() === "skill.md");
	// A skill's folder holds one skill: its subfolders are its references.
	if (own) return [join(dir, own.name)];
	if (depth >= MAX_DEPTH) return [];
	const nested = await Promise.all(
		entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules").map((e) => findSkillFiles(join(dir, e.name), depth + 1)),
	);
	return nested.flat();
}

/** The skill folder's text files other than `SKILL.md`, within the limits. */
async function readTextFiles(dir: string): Promise<Record<string, string>> {
	const files: Record<string, string> = {};
	let total = 0;
	const walk = async (at: string, depth: number) => {
		for (const entry of await readdir(at, { withFileTypes: true })) {
			const full = join(at, entry.name);
			if (entry.isDirectory() && depth < MAX_DEPTH) await walk(full, depth + 1);
			if (!entry.isFile() || !TEXT_FILES.has(extname(entry.name).toLowerCase())) continue;
			const path = relative(dir, full).split(sep).join("/");
			if (path.toLowerCase() === "skill.md" || Object.keys(files).length >= MAX_FILES) continue;
			const size = (await stat(full)).size;
			if (size > MAX_SKILL_BYTES || total + size > MAX_TOTAL_BYTES) continue;
			total += size;
			files[path] = await readFile(full, "utf-8");
		}
	};
	await walk(dir, 0);
	return files;
}

// ── The site's own origin ───────────────────────────────────────────────

async function fromSite(url: string): Promise<SkillContent[]> {
	const parsed = new URL(url);
	if (/\/skill\.md$/i.test(parsed.pathname)) return [parseSkillMd(await siteText(url))];
	const named = parsed.pathname.match(/\/\.well-known\/(?:agent-skills|skills)\/([^/]+)\/?$/)?.[1];
	const base = parsed.pathname.replace(/\/\.well-known\/.*$/, "").replace(/\/$/, "");
	for (const wellKnown of WELL_KNOWN) {
		const indexUrl = `${parsed.origin}${base}/${wellKnown}/index.json`;
		let index: unknown;
		try {
			index = JSON.parse(await siteText(indexUrl));
		} catch {
			continue;
		}
		const entries = indexEntries(index).filter((e) => !named || e.name === named);
		const skills: SkillContent[] = [];
		for (const entry of entries) {
			try {
				skills.push(await fromIndexEntry(entry, indexUrl, `${parsed.origin}${base}/${wellKnown}/${entry.name}`));
			} catch {
				// One broken entry doesn't hide the others.
			}
		}
		return skills;
	}
	throw new Error("the site has no .well-known/agent-skills/index.json");
}

interface IndexEntry {
	name: string;
	/** v0.2: the `SKILL.md` URL and its `sha256:` digest. */
	url?: string;
	digest?: string;
	/** v0.1: the skill's files, relative to its folder. */
	files?: string[];
}

/** The index's usable entries: v0.2 `skill-md` entries, or v0.1 file lists. Archives aren't read. */
function indexEntries(index: unknown): IndexEntry[] {
	const record = index as { $schema?: unknown; skills?: unknown };
	if (!record || !Array.isArray(record.skills)) return [];
	const v2 = record.$schema === DISCOVERY_V2;
	return record.skills.flatMap((raw): IndexEntry[] => {
		const e = raw as Record<string, unknown>;
		if (typeof e.name !== "string" || !SKILL_NAME.test(e.name)) return [];
		if (v2) {
			if (e.type !== "skill-md" || typeof e.url !== "string" || typeof e.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(e.digest)) return [];
			return [{ name: e.name, url: e.url, digest: e.digest }];
		}
		const files = Array.isArray(e.files) ? e.files.filter((f): f is string => typeof f === "string" && !f.startsWith("/") && !f.includes("..")) : [];
		return files.some((f) => f.toLowerCase() === "skill.md") ? [{ name: e.name, files }] : [];
	});
}

async function fromIndexEntry(entry: IndexEntry, indexUrl: string, folder: string): Promise<SkillContent> {
	if (entry.url) {
		const text = await siteText(new URL(entry.url, indexUrl).toString());
		const digest = `sha256:${createHash("sha256").update(text).digest("hex")}`;
		if (digest !== entry.digest) throw new Error(`${entry.name}: SKILL.md doesn't match its digest`);
		return named(parseSkillMd(text), entry.name);
	}
	const files: Record<string, string> = {};
	let skillMd = "";
	for (const file of (entry.files ?? []).slice(0, MAX_FILES)) {
		const text = await siteText(`${folder}/${file}`);
		if (file.toLowerCase() === "skill.md") skillMd = text;
		else if (TEXT_FILES.has(extname(file).toLowerCase())) files[file] = text;
	}
	return named(parseSkillMd(skillMd, files), entry.name);
}

function named(skill: SkillContent, name: string): SkillContent {
	if (skill.name !== name) throw new Error(`the index names ${name}, its SKILL.md ${skill.name}`);
	return skill;
}

/**
 * GET a text file on the site's origin. A site on the internet must not
 * resolve to this computer or its network (DNS rebinding); a site on
 * localhost (a developer's) may.
 */
async function siteText(url: string): Promise<string> {
	const { hostname } = new URL(url);
	const host = hostname.replace(/^\[|\]$/g, "");
	if (!isLoopbackName(host)) {
		const addresses = ipaddr.isValid(host) ? [{ address: host }] : await lookup(host, { all: true });
		for (const { address } of addresses) {
			const range = ipaddr.process(address).range();
			if (range !== "unicast") throw new Error(`${hostname} resolves to a ${range} address`);
		}
	}
	const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	if (Number(res.headers.get("content-length")) > MAX_SKILL_BYTES) throw new Error(`${url} is too large`);
	const text = await res.text();
	if (text.length > MAX_SKILL_BYTES) throw new Error(`${url} is too large`);
	return text;
}

function isLoopbackName(host: string): boolean {
	if (host === "localhost" || host.endsWith(".localhost")) return true;
	return ipaddr.isValid(host) && ipaddr.process(host).range() === "loopback";
}
