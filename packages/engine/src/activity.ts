/**
 * What each connected site asks of the visitor's AI, counted: every turn
 * with its length and whether the page was visible. Shown in the app
 * ("Today: 12 questions · 4 min"), and the brake behind it: a site past
 * the hourly cap gets refusals until the hour passes, a site the visitor
 * paused gets them until they resume it. The visitor's AI, on their plan
 * or their key, is what a runaway site would spend.
 */

import { homePath, readJson, writeJson } from "./home.js";

export interface Turn {
	/** When it ended (ms since epoch). */
	at: number;
	/** How long the AI worked on it. */
	ms: number;
	/** The page was not visible when it asked. */
	hidden?: boolean;
}

export interface SiteActivity {
	today: { turns: number; seconds: number };
	/** Turns in the last hour, and those from a hidden page among them. */
	hour: number;
	hiddenHour: number;
	/** Over the hourly cap: refused until the hour passes. */
	limited: boolean;
}

const HOUR_MS = 3_600_000;
const KEEP_MS = 7 * 24 * HOUR_MS;
// ponytail: one cap for every site; per-site or per-cost caps when a visitor asks for them.
/** Turns one site may ask in an hour, and from a page the visitor isn't looking at. */
export const HOURLY_CAP = 120;
export const HIDDEN_HOURLY_CAP = 20;

export class Activity {
	private turns: Record<string, Turn[]> = {};

	/** `path: null` keeps the counts in memory only (tests). */
	constructor(private readonly path: string | null = homePath("activity.json")) {
		if (path) this.turns = readJson<Record<string, Turn[]>>(path) ?? {};
	}

	record(origin: string, turn: Turn): void {
		const list = this.recent(origin, Date.now() - KEEP_MS);
		list.push(turn);
		this.turns[origin] = list;
		this.save();
	}

	/** Why `origin` may not ask now; undefined when it may. */
	refusal(origin: string, hidden = false): string | undefined {
		const hour = this.recent(origin, Date.now() - HOUR_MS);
		if (hour.length >= HOURLY_CAP) return `This site asked your AI ${hour.length} times in the last hour, Leuria's limit. It can ask again in a while.`;
		if (hidden && hour.filter((t) => t.hidden).length >= HIDDEN_HOURLY_CAP) return `This site asked your AI ${HIDDEN_HOURLY_CAP} times in the last hour while you weren't looking at it, Leuria's limit for a page in the background.`;
		return undefined;
	}

	of(origin: string, now = Date.now()): SiteActivity {
		const start = new Date(now);
		start.setHours(0, 0, 0, 0);
		const today = this.recent(origin, start.getTime());
		const hour = this.recent(origin, now - HOUR_MS);
		return {
			today: { turns: today.length, seconds: Math.round(today.reduce((sum, t) => sum + t.ms, 0) / 1000) },
			hour: hour.length,
			hiddenHour: hour.filter((t) => t.hidden).length,
			limited: hour.length >= HOURLY_CAP,
		};
	}

	/** Every site that asked in the last week. */
	summary(): Record<string, SiteActivity> {
		const now = Date.now();
		return Object.fromEntries(Object.keys(this.turns).map((origin) => [origin, this.of(origin, now)]));
	}

	/** A disconnected site takes its counts with it. */
	forget(origin: string): void {
		delete this.turns[origin];
		this.save();
	}

	private recent(origin: string, since: number): Turn[] {
		return (this.turns[origin] ?? []).filter((t) => t.at >= since);
	}

	private save(): void {
		if (this.path) writeJson(this.path, this.turns);
	}
}
