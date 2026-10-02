/**
 * Sites the visitor approved. One grant per origin; the site holds the
 * token, the engine keeps only its SHA-256. Revoking a grant makes the
 * site ask again.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { statSync } from "node:fs";

import { homePath, readJson, writeJson } from "./home.js";
import type { SiteNeeds } from "./needs.js";
import type { SiteSkills } from "./skills.js";

interface Grant {
	origin: string;
	/** Name the site gave when it asked to connect. */
	app?: string;
	tokenHash: string;
	createdAt: string;
	lastUsedAt?: string;
	/** Registry id of the AI this site uses; the default AI when absent. */
	agent?: string;
	/** The model this site uses, for the AI it was chosen with; that AI's model choice otherwise. */
	model?: { agent: string; id: string };
	/** What the site said its features need, when it connected (guidance for choosing its AI). */
	needs?: SiteNeeds;
	/** The skills the site gives its AI: the refs it declared and what they resolved to. */
	skills?: SiteSkills;
}

export class GrantStore {
	private grants: Grant[] = [];
	private loadedMtime = -1;
	private readonly removedListeners = new Set<(origin: string) => void>();
	private readonly changedListeners = new Set<(origin: string) => void>();

	/** `path: null` keeps grants in memory only (tests, `leuria test`). */
	constructor(private readonly path: string | null = homePath("grants.json")) {
		this.reload();
	}

	/** Called with each origin whose grant disappears, here or in another process. */
	onRemoved(listener: (origin: string) => void): void {
		this.removedListeners.add(listener);
	}

	/** Called with each origin whose AI or model changes. */
	onChanged(listener: (origin: string) => void): void {
		this.changedListeners.add(listener);
	}

	list(): Grant[] {
		this.reload();
		return [...this.grants];
	}

	has(origin: string): boolean {
		this.reload();
		return this.grants.some((g) => g.origin === normalizeOrigin(origin));
	}

	get(origin: string): Grant | undefined {
		this.reload();
		try {
			const normalized = normalizeOrigin(origin);
			return this.grants.find((g) => g.origin === normalized);
		} catch {
			return undefined;
		}
	}

	/** Use `agent` for this site, or the default AI when `undefined`. */
	setAgent(origin: string, agent: string | undefined): boolean {
		return this.update(origin, (g) => {
			if (agent) g.agent = agent;
			else delete g.agent;
		});
	}

	/** Use `model` of `agent` for this site, or that AI's own choice when `undefined`. */
	setModel(origin: string, model: { agent: string; id: string } | undefined): boolean {
		return this.update(origin, (g) => {
			if (model) g.model = model;
			else delete g.model;
		});
	}

	/** Replace the site's skills (it changed its list). Its open conversations keep the skills they started with. */
	setSkills(origin: string, skills: SiteSkills | undefined): boolean {
		return this.update(
			origin,
			(g) => {
				if (skills) g.skills = skills;
				else delete g.skills;
			},
			false,
		);
	}

	/** Change the origin's grant and save it; `notify` tells the change listeners. False when there is none. */
	private update(origin: string, mutate: (grant: Grant) => void, notify = true): boolean {
		this.reload();
		const grant = this.grants.find((g) => g.origin === normalizeOrigin(origin));
		if (!grant) return false;
		mutate(grant);
		this.save();
		if (notify) for (const listener of this.changedListeners) listener(grant.origin);
		return true;
	}

	/** Create or replace the origin's grant; returns the new token. Keeps the site's AI and model choice; `needs` and `skills` replace what it declared. */
	create(origin: string, app?: string, needs?: SiteNeeds, skills?: SiteSkills): string {
		this.reload();
		const normalized = normalizeOrigin(origin);
		const token = randomBytes(32).toString("base64url");
		const previous = this.grants.find((g) => g.origin === normalized);
		this.grants = this.grants.filter((g) => g.origin !== normalized);
		this.grants.push({
			origin: normalized,
			app,
			tokenHash: hashToken(token),
			createdAt: new Date().toISOString(),
			...(previous?.agent ? { agent: previous.agent } : {}),
			...(previous?.model ? { model: previous.model } : {}),
			...(needs ? { needs } : {}),
			...(skills ? { skills } : {}),
		});
		this.save();
		return token;
	}

	/** True when `token` is the origin's current token. */
	verify(origin: string, token: string | undefined): boolean {
		if (!token) return false;
		this.reload();
		const grant = this.grants.find((g) => g.origin === normalizeOrigin(origin));
		if (!grant) return false;
		const expected = Buffer.from(grant.tokenHash, "hex");
		const actual = Buffer.from(hashToken(token), "hex");
		if (!timingSafeEqual(expected, actual)) return false;
		const now = new Date().toISOString();
		// Persist at most once a minute; this runs on every request.
		if (!grant.lastUsedAt || Date.parse(now) - Date.parse(grant.lastUsedAt) > 60_000) {
			grant.lastUsedAt = now;
			this.save();
		}
		return true;
	}

	revoke(origin: string): boolean {
		this.reload();
		const normalized = normalizeOrigin(origin);
		const before = this.grants.length;
		this.grants = this.grants.filter((g) => g.origin !== normalized);
		if (this.grants.length === before) return false;
		this.save();
		for (const listener of this.removedListeners) listener(normalized);
		return true;
	}

	/** Pick up changes made by another process, such as `leuria sites revoke`. */
	private reload(): void {
		if (!this.path) return;
		let mtime: number;
		try {
			mtime = statSync(this.path).mtimeMs;
		} catch {
			mtime = 0;
		}
		if (mtime === this.loadedMtime) return;
		const previous = new Set(this.grants.map((g) => g.origin));
		this.grants = readJson<{ grants?: Grant[] }>(this.path)?.grants ?? [];
		const firstLoad = this.loadedMtime === -1;
		this.loadedMtime = mtime;
		if (firstLoad) return;
		for (const grant of this.grants) previous.delete(grant.origin);
		for (const origin of previous) {
			for (const listener of this.removedListeners) listener(origin);
		}
	}

	private save(): void {
		if (!this.path) return;
		writeJson(this.path, { grants: this.grants });
		try {
			this.loadedMtime = statSync(this.path).mtimeMs;
		} catch {
			// written just now; next reload re-reads it
		}
	}
}

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/** `scheme://host[:port]`, lowercase, no trailing slash. Throws if not http(s). */
export function normalizeOrigin(origin: string): string {
	const url = new URL(origin.trim());
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Not a web origin: ${origin}`);
	}
	return url.origin.toLowerCase();
}
