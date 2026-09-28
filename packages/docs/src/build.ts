/**
 * @leuria/docs/build: a docs site's pages to a corpus, at build time.
 *
 *   import { buildCorpus } from "@leuria/docs/build"
 *   const corpus = buildCorpus([{ url: "/docs/intro", title: "Intro", markdown }], { site: "My docs" })
 *   writeFileSync("corpus.json", JSON.stringify(corpus))
 *
 * Integrations (`@leuria/docusaurus`) call it with the site's own pages.
 */

import { chunkMarkdown } from "@leuria/store";
import GithubSlugger from "github-slugger";

import { type DocsCorpus, type DocsPage, type DocsSection, pagePath } from "./corpus.js";

export type { DocsCorpus, DocsPage, DocsSection } from "./corpus.js";
export { pagePath } from "./corpus.js";

export interface BuildCorpusOptions {
	/** The site's name, for the assistant's instructions. */
	site?: string;
	/** For versioned docs: the version readers get when the page doesn't say. */
	defaultVersion?: string;
	/** Longest section before it is cut by paragraph. Default 1200. */
	maxChars?: number;
}

/**
 * Markdown as readers and models should see it: without front matter, MDX
 * imports and exports, HTML comments, or the `{#id}` of custom anchors.
 */
export function cleanMarkdown(source: string, { keepAnchors = false }: { keepAnchors?: boolean } = {}): string {
	let text = source.replace(/^﻿/, "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
	const out: string[] = [];
	let fence: string | undefined;
	for (const line of text.split(/\r?\n/)) {
		const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) fence = fence ? undefined : marker;
		if (!fence && !marker && /^(import|export)\s.+(from\s+['"].+['"]|=.+);?\s*$/.test(line)) continue;
		out.push(fence || marker || keepAnchors ? line : line.replace(/\s*\{#[\w-]+\}\s*$/, ""));
	}
	text = out.join("\n").replace(/<!--[\s\S]*?-->/g, "");
	return text.replace(/\n{3,}/g, "\n\n").trim();
}

interface RawSection {
	heading?: string;
	anchor?: string;
	body: string;
}

/** Sections by heading (outside code blocks), with the anchors the site gives them. */
function sectionsOf(source: string): RawSection[] {
	const slugger = new GithubSlugger();
	const sections: RawSection[] = [];
	let current: RawSection = { body: "" };
	let fence: string | undefined;
	for (const line of source.split("\n")) {
		const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) fence = fence ? undefined : marker;
		const match = fence || marker ? null : /^#{1,6}\s+(.*?)\s*(\{#([\w-]+)\})?\s*$/.exec(line);
		if (match) {
			sections.push(current);
			const heading = match[1]!.replace(/[`*_]/g, "");
			current = { heading, anchor: match[3] ?? slugger.slug(heading), body: "" };
		} else {
			current.body += `${line}\n`;
		}
	}
	sections.push(current);
	return sections.filter((s) => s.body.trim() || s.heading);
}

/** Pages to a corpus: the pages as given, and their sections for search. */
export function buildCorpus(pages: DocsPage[], { site, defaultVersion, maxChars = 1200 }: BuildCorpusOptions = {}): DocsCorpus {
	const cleaned = pages.map((page) => ({ ...page, url: pagePath(page.url), markdown: cleanMarkdown(page.markdown) }));
	const sections: DocsSection[] = [];
	for (const [i, page] of cleaned.entries()) {
		const seen = new Map<string, number>();
		for (const raw of sectionsOf(cleanMarkdown(pages[i]!.markdown, { keepAnchors: true }))) {
			// The page's H1 is its title: its text belongs to the page itself.
			const isTitle = raw.heading !== undefined && raw.heading === page.title;
			const heading = isTitle ? undefined : raw.heading;
			const anchor = isTitle ? undefined : raw.anchor;
			const base = anchor ? `${page.url}#${anchor}` : page.url;
			for (const chunk of chunkMarkdown(raw.body, { maxChars })) {
				const n = seen.get(base) ?? 0;
				seen.set(base, n + 1);
				sections.push({
					id: n ? `${base}~${n}` : base,
					url: page.url,
					title: page.title,
					heading,
					anchor,
					text: heading ? `${heading}\n\n${chunk.text}` : chunk.text,
					version: page.version,
				});
			}
		}
	}
	return { site, defaultVersion, pages: cleaned, sections };
}
