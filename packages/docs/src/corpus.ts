/**
 * What a docs site gives Leuria: its pages as Markdown, and the same pages
 * cut into sections for search. Built once, at build time
 * (`@leuria/docs/build`), and fetched by the page when the reader first
 * searches or asks.
 */

export interface DocsPage {
	/** The page's path on the site, e.g. `/docs/guides/tools`. */
	url: string;
	title: string;
	description?: string;
	/** The page's text, as Markdown (front matter and MDX imports removed). */
	markdown: string;
	/** For versioned docs: the version this page belongs to. */
	version?: string;
}

export interface DocsSection {
	/** `url#anchor`, plus `~n` when a long section is cut in several. */
	id: string;
	url: string;
	/** The page's title. */
	title: string;
	/** The section's heading; none for the text before the first heading. */
	heading?: string;
	/** The heading's anchor on the page. */
	anchor?: string;
	/** The section's text, heading first. */
	text: string;
	version?: string;
}

export interface DocsCorpus {
	/** The site's name, for the assistant's instructions. */
	site?: string;
	/** For versioned docs: the version readers get when the page doesn't say (usually the latest). */
	defaultVersion?: string;
	pages: DocsPage[];
	sections: DocsSection[];
}

/** A page's path without origin, query, hash or trailing slash. */
export function pagePath(url: string): string {
	let path = url;
	try {
		path = new URL(url, "http://docs.invalid").pathname;
	} catch {
		// Keep it as given.
	}
	path = path.replace(/\/index(\.html?)?$/, "/").replace(/\.html?$/, "");
	return path.length > 1 ? path.replace(/\/+$/, "") : path;
}
