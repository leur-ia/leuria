/**
 * Guiding the visitor's choice of AI and model for a site: what each model
 * can do and what it costs (a small catalog, from what services report and
 * from model names), how well it fits what the site declared it needs
 * (`needs.ts`), and which one to recommend: the cheapest that is enough.
 * Guidance only: the visitor decides.
 */

import type { Effort, SiteNeeds } from "./needs.js";

/** How strong a model is: quick answers, everyday work with tools, hard tasks. */
export type Tier = "small" | "medium" | "large";
/** What using it costs the visitor: nothing (on this computer), their plan's limits, or money per use. */
export type Cost = "free" | "plan" | "paid";

export interface ModelTraits {
	tools?: boolean;
	images?: boolean;
	context?: number;
	tier?: Tier;
	cost: Cost;
	/** Runs on this computer. */
	local: boolean;
	/** Loaded in memory: answers at once (LM Studio). */
	loaded?: boolean;
}

const RANK: Record<Tier, number> = { small: 0, medium: 1, large: 2 };
const NEEDED: Record<Effort, Tier> = { light: "small", standard: "medium", deep: "large" };
const COST: Record<Cost, number> = { free: 0, plan: 1, paid: 2 };

/** By size: under 9B quick answers, up to 40B everyday work, above that hard tasks. */
export function tierFromParams(billions: number): Tier {
	return billions < 9 ? "small" : billions <= 40 ? "medium" : "large";
}

const LARGE = /\b(opus|fable|ultra|max|pro|large|hardest|most capable|frontier)\b/i;
const SMALL = /\b(haiku|mini|nano|lite|small|tiny|fastest|quick(est)? answers?)\b/i;
const MEDIUM = /\b(sonnet|flash|medium|everyday|routine|efficient|balanced)\b/i;

/** From a model's name, then its description, when they say. Undefined when they don't. */
export function tierFromName(name: string, description = ""): Tier | undefined {
	for (const text of [name, description]) {
		const size = /(\d+(?:\.\d+)?)\s*b\b/i.exec(text);
		if (size) return tierFromParams(Number(size[1]));
		if (LARGE.test(text)) return "large";
		if (SMALL.test(text)) return "small";
		if (MEDIUM.test(text)) return "medium";
	}
	return undefined;
}

/** "1M context", "200K context" → tokens. */
export function contextFromText(text = ""): number | undefined {
	const match = /(\d+(?:\.\d+)?)\s*([KM])\b[^·]*context/i.exec(text);
	if (!match) return undefined;
	return Math.round(Number(match[1]) * (match[2]!.toUpperCase() === "M" ? 1_000_000 : 1_000));
}

export type AiKind = { kind: "agent" } | { kind: "llm"; local: boolean; plan?: boolean };

/** What a model can do and costs, from what its service said and its name. */
export function traitsOf(
	ai: AiKind,
	model: { name: string; description?: string; meta?: { tools?: boolean; images?: boolean; context?: number; params?: number }; loaded?: boolean },
): ModelTraits {
	const tier = model.meta?.params ? tierFromParams(model.meta.params) : tierFromName(model.name, model.description);
	if (ai.kind === "agent") {
		// Agents (Claude Code, Codex…) run on the visitor's plan, with tools and images.
		return { tools: true, images: true, context: contextFromText(model.description) ?? contextFromText(model.name), tier, cost: "plan", local: false };
	}
	return {
		tools: model.meta?.tools ?? (ai.local ? undefined : true),
		images: model.meta?.images,
		context: model.meta?.context,
		tier,
		cost: ai.local ? "free" : ai.plan ? "plan" : "paid",
		local: ai.local,
		...(model.loaded ? { loaded: true } : {}),
	};
}

export type Verdict = "fits" | "more" | "short";

/**
 * - `short`: it lacks something the site needs (tools, images, context, strength);
 * - `more`: stronger than the site needs, and it costs something;
 * - `fits`: enough, and not more than needed (or free).
 */
export function fitOf(needs: SiteNeeds | undefined, traits: ModelTraits): Verdict {
	if (!needs) return "fits";
	if (needs.tools && traits.tools === false) return "short";
	if (needs.images && traits.images === false) return "short";
	if (needs.context && traits.context !== undefined && traits.context < needs.context) return "short";
	const wanted = needs.effort ? RANK[NEEDED[needs.effort]] : undefined;
	if (wanted !== undefined && traits.tier) {
		if (RANK[traits.tier] < wanted) return "short";
		if (RANK[traits.tier] > wanted && traits.cost !== "free") return "more";
	}
	return "fits";
}

export interface Candidate {
	/** Your AI's id. */
	agent: string;
	/** A model of that AI; undefined: it has no choice. */
	model?: string;
	traits: ModelTraits;
	isDefault: boolean;
	/** The model the visitor chose for that AI. */
	isCurrent?: boolean;
}

/**
 * The cheapest candidate that is enough: free before plan before paid, the
 * smallest strength that meets the site's effort, one loaded in memory,
 * the model the visitor already chose, then the default AI. Undefined when
 * nothing fits.
 */
export function recommend<C extends Candidate>(needs: SiteNeeds | undefined, candidates: C[]): C | undefined {
	const wanted = needs?.effort ? RANK[NEEDED[needs.effort]] : 0;
	// A known strength close to the need first; an unknown one after the known ones that fit.
	const distance = (c: C) => (c.traits.tier ? RANK[c.traits.tier] - wanted : 1.5);
	return candidates
		.filter((c) => fitOf(needs, c.traits) !== "short")
		.sort(
			(a, b) =>
				COST[a.traits.cost] - COST[b.traits.cost] ||
				distance(a) - distance(b) ||
				Number(Boolean(b.traits.loaded)) - Number(Boolean(a.traits.loaded)) ||
				Number(Boolean(b.isCurrent)) - Number(Boolean(a.isCurrent)) ||
				Number(b.isDefault) - Number(a.isDefault),
		)[0];
}

/** Why it is recommended, in the visitor's words. */
export function reasonFor(traits: ModelTraits): string {
	if (traits.cost === "free") return "On this computer: free, and enough for this site.";
	return "The lightest of your AIs that is enough for this site.";
}
