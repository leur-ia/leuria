/**
 * A site's needs and how a model fits them, in the visitor's words (no
 * "tokens", "tier" or "capabilities").
 */

import type { Cost, Fit, SiteNeeds, Verdict } from "./engine";

/** "This site does quick tasks with its own tools.": what it declared, as a sentence; empty when it said nothing. */
export function needsSentence(needs: SiteNeeds | null | undefined): string {
	if (!needs) return "";
	const tasks = needs.effort === "light" ? "quick tasks" : needs.effort === "standard" ? "everyday tasks" : needs.effort === "deep" ? "hard, long tasks" : "its tasks";
	const withWhat = [needs.tools ? "its own tools" : "", needs.images ? "images" : ""].filter(Boolean).join(" and ");
	const long = needs.context && needs.context > 32_000 ? " on long texts" : "";
	return `This site does ${tasks}${withWhat ? ` with ${withWhat}` : ""}${long}.`;
}

/** What using a model costs, in the visitor's words. */
export function costWords(cost: Cost | undefined, aiName: string): string {
	if (cost === "free") return "On this computer · free";
	if (cost === "plan") return `Uses your ${aiName} plan`;
	if (cost === "paid") return "Charged per use";
	return "";
}

/** "Its own tools, quick tasks": what the site said it needs; empty when it said nothing. */
export function needsWords(needs: SiteNeeds | null | undefined): string {
	if (!needs) return "";
	const words: string[] = [];
	if (needs.effort === "light") words.push("quick tasks");
	if (needs.effort === "standard") words.push("everyday tasks");
	if (needs.effort === "deep") words.push("hard, long tasks");
	if (needs.tools) words.push("its own tools");
	if (needs.images) words.push("images");
	if (needs.context && needs.context > 32_000) words.push("long texts");
	const text = words.join(", ");
	return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

/** A label after a model's name, for a site that declared its needs. */
export function verdictWords(verdict: Verdict | undefined): string {
	if (verdict === "more") return " · More than this site needs";
	if (verdict === "short") return " · May struggle here";
	return "";
}

/** How an AI (or one of its models) fits, from a fit answer. `undefined` model: the AI itself. */
export function verdictOf(fit: Fit | null, agent: string, model?: string): Verdict | undefined {
	if (!fit?.needs) return undefined;
	const ai = fit.ais.find((a) => a.id === agent);
	return model === undefined ? ai?.verdict : ai?.models.find((m) => m.id === model)?.verdict;
}
