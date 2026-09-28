/**
 * What a site says its features need, so Leuria can guide the visitor to
 * an AI and model that fit, and no bigger (bigger costs more). A closed,
 * small vocabulary: capabilities and how hard the tasks are, never model
 * names. Guidance only: the visitor decides.
 */

export type Effort = "light" | "standard" | "deep";

export interface SiteNeeds {
	/** The site's features use page tools. */
	tools?: boolean;
	/** The site sends images. */
	images?: boolean;
	/** How hard the tasks are: `light` (answer, extract, summarize), `standard` (several steps with tools), `deep` (long reasoning, agentic work). */
	effort?: Effort;
	/** About how much text one turn sends, in tokens. */
	context?: number;
}

const EFFORTS: readonly Effort[] = ["light", "standard", "deep"];

/** A site's declaration, checked: unknown keys and values are dropped. Undefined when nothing is left. */
export function parseNeeds(input: unknown): SiteNeeds | undefined {
	if (!input || typeof input !== "object") return undefined;
	const raw = input as Record<string, unknown>;
	const needs: SiteNeeds = {};
	const flag = (value: unknown) => value === true || value === "1" || value === "true";
	if (flag(raw.tools)) needs.tools = true;
	if (flag(raw.images)) needs.images = true;
	if (typeof raw.effort === "string" && (EFFORTS as readonly string[]).includes(raw.effort)) needs.effort = raw.effort as Effort;
	const context = Number(raw.context);
	if (Number.isFinite(context) && context > 0) needs.context = Math.min(Math.round(context), 10_000_000);
	return Object.keys(needs).length ? needs : undefined;
}
