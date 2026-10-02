/**
 * Skills a site gives the visitor's AI: instructions for tasks on that
 * site, in the Agent Skills format. The site names them (see
 * `skill-sources.ts`); the engine fetches them when the site connects or
 * changes its list, never while a conversation starts.
 *
 * One cache for every site, by content (a community skill two sites use is
 * stored once), in `~/.leuria/skills`. Each site's grant keeps
 * which skills it uses, so a skill is only ever offered in that site's
 * sessions: the agent gets their names and descriptions, and reads one
 * with the `read_skill` tool when a task calls for it.
 *
 * Skills don't widen what the AI can do: it still has only the page's
 * tools. So there is no approval step, but Leuria shows them to the
 * visitor, in the approval window and in the site's details.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { GrantStore } from "./grants.js";
import { homePath } from "./home.js";
import type { Logger } from "./logger.js";
import { fetchSkills, parseSkillSource, type SkillContent, sourceLabel } from "./skill-sources.js";

export type { SkillContent };
import type { ToolDescriptor } from "./webmcp-server.js";

/** A skill a site uses, as its grant keeps it. */
export interface SiteSkill {
	name: string;
	description: string;
	/** Where it comes from, for the visitor: the site's host, or `owner/repo`. */
	source: string;
	/** From the site itself, or shared from a public repository. */
	shared: boolean;
	/** Content address in the cache. */
	integrity: string;
	/** Set when the site added it after it was connected. */
	addedAt?: string;
}

/** A site's skills: the refs it declared, and what they resolved to. */
export interface SiteSkills {
	refs: string[];
	list: SiteSkill[];
}

export const READ_SKILL = "read_skill";
const MAX_REFS = 16;
const MAX_SKILLS = 16;
const MAX_REF_LENGTH = 300;

/** A site's declaration, checked: strings only, deduplicated, capped. Undefined when there are none. */
export function parseSkillRefs(input: unknown): string[] | undefined {
	const raw = typeof input === "string" ? [input] : Array.isArray(input) ? input : [];
	const refs = [...new Set(raw.filter((r): r is string => typeof r === "string").map((r) => r.trim()).filter((r) => r && r.length <= MAX_REF_LENGTH))];
	return refs.length ? refs.slice(0, MAX_REFS) : undefined;
}

export const sameRefs = (a: string[] | undefined, b: string[] | undefined) => (a ?? []).join("\n") === (b ?? []).join("\n");

interface SkillServiceOptions {
	grants: GrantStore;
	logger: Logger;
	/** Cache folder; `null` keeps skills in memory (tests). */
	cache?: string | null;
	/** Fetches a ref's skills; tests replace it. */
	fetch?: (ref: string, origin: string) => Promise<{ skills: SkillContent[]; source: string; shared: boolean }>;
}

export class SkillService {
	private readonly cache: string | null;
	private readonly memory = new Map<string, SkillContent>();
	private readonly refreshing = new Map<string, Promise<void>>();

	constructor(private readonly options: SkillServiceOptions) {
		this.cache = options.cache === undefined ? homePath("skills") : options.cache;
	}

	/**
	 * Fetch and cache the skills `refs` name for `origin`. A ref that fails
	 * is logged and skipped; the first skill of a name wins.
	 */
	async resolve(origin: string, refs: string[]): Promise<SiteSkill[]> {
		const list: SiteSkill[] = [];
		for (const ref of refs) {
			let found: Awaited<ReturnType<NonNullable<SkillServiceOptions["fetch"]>>>;
			try {
				found = await (this.options.fetch ?? fetchRef)(ref, origin);
			} catch (error) {
				this.options.logger.warn("skill source failed", { origin, ref, error: error instanceof Error ? error.message : String(error) });
				continue;
			}
			for (const skill of found.skills) {
				if (list.length >= MAX_SKILLS || list.some((s) => s.name === skill.name)) continue;
				list.push({ name: skill.name, description: skill.description, source: found.source, shared: found.shared, integrity: await this.put(skill) });
			}
		}
		return list;
	}

	/**
	 * A connected site sent its skill refs with a session: when they changed,
	 * fetch them in the background and update its grant. Sessions starting
	 * meanwhile keep the skills it had.
	 */
	refresh(origin: string, refs: string[] | undefined): void {
		const grant = this.options.grants.get(origin);
		if (!grant || sameRefs(grant.skills?.refs, refs) || this.refreshing.has(origin)) return;
		const done = (async () => {
			const list = refs ? await this.resolve(origin, refs) : [];
			const before = new Set((this.options.grants.get(origin)?.skills?.list ?? []).map((s) => s.name));
			const now = new Date().toISOString();
			const marked = list.map((s) => (before.has(s.name) ? s : { ...s, addedAt: now }));
			this.options.grants.setSkills(origin, refs ? { refs, list: marked } : undefined);
		})()
			.catch((error) => this.options.logger.warn("skills refresh failed", { origin, error: String(error) }))
			.finally(() => this.refreshing.delete(origin));
		this.refreshing.set(origin, done);
	}

	/** The skills a session of `origin` gets, from the cache. */
	async forSession(origin: string): Promise<SkillContent[]> {
		const list = this.options.grants.get(origin)?.skills?.list ?? [];
		const loaded = await Promise.all(list.map((s) => this.get(s.integrity).catch(() => null)));
		return loaded.filter((s): s is SkillContent => s !== null);
	}

	/** Wait for background refreshes (tests). */
	async settled(): Promise<void> {
		await Promise.all(this.refreshing.values());
	}

	private async put(skill: SkillContent): Promise<string> {
		const data = JSON.stringify(skill);
		const integrity = integrityOf(data);
		if (this.cache === null) {
			this.memory.set(integrity, skill);
		} else {
			const file = this.fileOf(integrity);
			await mkdir(dirname(file), { recursive: true });
			await writeFile(file, data);
		}
		return integrity;
	}

	private async get(integrity: string): Promise<SkillContent> {
		if (this.cache === null) {
			const skill = this.memory.get(integrity);
			if (!skill) throw new Error("not cached");
			return skill;
		}
		const data = await readFile(this.fileOf(integrity));
		// Check the content against its address.
		if (integrityOf(data) !== integrity) throw new Error("cached skill changed");
		return JSON.parse(data.toString("utf-8")) as SkillContent;
	}

	/** Where a skill lives: cacache's content layout, so skills cached by earlier versions still resolve. */
	private fileOf(integrity: string): string {
		const hex = Buffer.from(integrity.replace(/^sha256-/, ""), "base64").toString("hex");
		return join(this.cache!, "content-v2", "sha256", hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
	}
}

/** A content address, in the `sha256-<base64>` form grants.json keeps. */
const integrityOf = (data: string | Buffer) => `sha256-${createHash("sha256").update(data).digest("base64")}`;

async function fetchRef(ref: string, origin: string) {
	const source = parseSkillSource(ref, origin);
	return { skills: await fetchSkills(source), source: sourceLabel(source), shared: source.kind === "github" };
}

// ── What the agent gets ─────────────────────────────────────────────────

/** Added to the session's system prompt: the skills' names and descriptions. */
export function skillsPrompt(skills: SkillContent[]): string {
	return [
		"This site gives you skills: instructions for tasks on this site.",
		`When a request matches a skill, call \`${READ_SKILL}\` with its name first and follow what it says.`,
		"",
		...skills.map((s) => `- ${s.name}: ${s.description}`),
	].join("\n");
}

export function readSkillTool(skills: SkillContent[]): ToolDescriptor {
	return {
		name: READ_SKILL,
		description: "Read one of this site's skills: its instructions, or one of its files.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", enum: skills.map((s) => s.name), description: "The skill's name." },
				file: { type: "string", description: "A file the skill mentions, by its path. Leave out for the skill's instructions." },
			},
			required: ["name"],
		},
		annotations: { readOnlyHint: true },
	};
}

/** Run `read_skill`. Throws on an unknown skill or file. */
export function readSkill(skills: SkillContent[], args: Record<string, unknown>): string {
	const skill = skills.find((s) => s.name === args.name);
	if (!skill) throw new Error(`No skill named ${String(args.name)}. Skills: ${skills.map((s) => s.name).join(", ")}`);
	if (typeof args.file === "string" && args.file) {
		const file = skill.files[args.file.replace(/^\.\//, "")];
		if (file === undefined) throw new Error(`${skill.name} has no file ${args.file}`);
		return file;
	}
	const files = Object.keys(skill.files);
	return files.length ? `${skill.body}\n\n---\nFiles of this skill (read one with \`file\`): ${files.join(", ")}` : skill.body;
}
