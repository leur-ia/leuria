/**
 * The site's Algolia DocSearch as the docs search by words: the search
 * the site already runs, so a light corpus needs no text to search.
 */

import type { SiteSearch } from "./docs.js";

export interface AlgoliaOptions {
	appId: string;
	/** The public search-only key, the one DocSearch puts in the page. */
	apiKey: string;
	indexName: string;
	/** Only records in this language (DocSearch's `language` facet), as contextual search does. */
	language?: string;
}

interface AlgoliaHit {
	url?: string;
	content?: string | null;
	hierarchy?: Record<string, string | null>;
}

/** Search with the site's Algolia DocSearch index. */
export function algoliaSearch({ appId, apiKey, indexName, language }: AlgoliaOptions): SiteSearch {
	// Keys in the address, not in headers: no CORS preflight before each search.
	const url = `https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(indexName)}/query?x-algolia-application-id=${encodeURIComponent(appId)}&x-algolia-api-key=${encodeURIComponent(apiKey)}`;
	return async (query, { k }) => {
		const response = await fetch(url, {
			method: "POST",
			body: JSON.stringify({
				query,
				hitsPerPage: k * 2,
				...(language ? { facetFilters: [`language:${language}`] } : {}),
				attributesToRetrieve: ["url", "content", "hierarchy"],
				attributesToHighlight: [],
			}),
		});
		if (!response.ok) throw new Error(`Algolia answered ${response.status}`);
		const { hits = [] } = (await response.json()) as { hits?: AlgoliaHit[] };
		return hits
			.filter((hit) => hit.url)
			.map((hit) => {
				const levels = ["lvl6", "lvl5", "lvl4", "lvl3", "lvl2"].map((lvl) => hit.hierarchy?.[lvl]).filter(Boolean) as string[];
				return { url: hit.url!, heading: levels[0] ? text(levels[0]) : undefined, passage: hit.content ? text(hit.content) : undefined };
			});
	};
}

/** DocSearch keeps HTML entities and Docusaurus's zero-width spaces in its records. */
function text(value: string): string {
	return value
		.replace(/​/g, "")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/\r\n/g, "\n")
		.trim();
}
