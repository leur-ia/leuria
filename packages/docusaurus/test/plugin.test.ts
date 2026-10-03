import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LoadContext } from "@docusaurus/types";
import { describe, expect, it } from "vitest";

import leuriaDocusaurus, { validateOptions } from "../src/index.js";

function site(navbarItems: unknown[] = []) {
	const siteDir = mkdtempSync(join(tmpdir(), "leuria-docusaurus-"));
	mkdirSync(join(siteDir, "docs"));
	writeFileSync(join(siteDir, "docs/intro.md"), "---\ntitle: Intro\n---\n# Intro\n\nHello.\n\n## Install {#setup}\n\nnpm install.");
	writeFileSync(join(siteDir, "docs/draft.md"), "# Draft");
	const context = {
		siteDir,
		generatedFilesDir: join(siteDir, ".docusaurus"),
		siteConfig: { title: "My docs", themeConfig: { navbar: { items: navbarItems } } },
	} as unknown as LoadContext;
	const docs = (source: string, permalink: string, extra = {}) => ({ title: source.includes("intro") ? "Intro" : "Draft", source, permalink, ...extra });
	const allContent = {
		"docusaurus-plugin-content-docs": {
			default: {
				loadedVersions: [
					{ versionName: "current", isLast: true, docs: [docs("@site/docs/intro.md", "/docs/intro"), docs("@site/docs/draft.md", "/docs/draft", { draft: true })] },
				],
			},
		},
	};
	return { context, allContent, navbar: (context.siteConfig.themeConfig as { navbar: { items: Array<{ value?: string }> } }).navbar };
}

describe("@leuria/docusaurus", () => {
	it("adds its buttons to the navbar once", () => {
		const { context, navbar } = site([{ type: "doc", docId: "intro" }]);
		leuriaDocusaurus(context, { search: true, connectButton: true });
		leuriaDocusaurus(context, { search: true, connectButton: true });
		expect(navbar.items.map((item) => item.value)).toEqual([
			undefined,
			"<leuria-search-button></leuria-search-button>",
			"<leuria-ask-button></leuria-ask-button>",
			'<leuria-connect-button size="1" hide-byline></leuria-connect-button>',
		]);
	});

	it("puts only the Ask button by default, and none when asked", () => {
		const one = site();
		leuriaDocusaurus(one.context, {});
		expect(one.navbar.items.map((item) => item.value)).toEqual(["<leuria-ask-button></leuria-ask-button>"]);
		const none = site();
		leuriaDocusaurus(none.context, { askButton: "floating" });
		expect(none.navbar.items).toEqual([]);
	});

	it("builds the corpus from the site's docs, without drafts", async () => {
		const { context, allContent } = site();
		const plugin = leuriaDocusaurus(context, { site: "Acme" });
		await plugin.allContentLoaded!({ allContent, actions: {} as never });
		const corpus = JSON.parse(readFileSync(join(context.generatedFilesDir, "leuria/corpus.json"), "utf8"));
		expect(corpus.site).toBe("Acme");
		expect(corpus.pages.map((p: { url: string }) => p.url)).toEqual(["/docs/intro"]);
		expect(corpus.sections.map((s: { id: string }) => s.id)).toEqual(["/docs/intro", "/docs/intro#setup"]);
		// Light: readers read the pages from the site.
		expect(corpus.pages[0].markdown).toBeUndefined();
		expect(corpus.sections[1].text).toBe("Install");
		// With Leuria as the site's search, the text stays, for ⌘K.
		await leuriaDocusaurus(context, { search: true }).allContentLoaded!({ allContent, actions: {} as never });
		expect(JSON.parse(readFileSync(join(context.generatedFilesDir, "leuria/corpus.json"), "utf8")).pages[0].markdown).toContain("npm install.");
		const config = JSON.parse(readFileSync(join(context.generatedFilesDir, "leuria/config.json"), "utf8"));
		expect(config).toMatchObject({ app: "My docs", askButton: "navbar", webmcp: true });
	});

	it("loads the page model only when the site asks for it", () => {
		const off = site();
		leuriaDocusaurus(off.context, {});
		expect(readFileSync(join(off.context.generatedFilesDir, "leuria/embedder.js"), "utf8")).toBe("export default null;\n");
		const on = site();
		leuriaDocusaurus(on.context, { pageEmbeddings: true });
		expect(readFileSync(join(on.context.generatedFilesDir, "leuria/embedder.js"), "utf8")).toContain('import("@leuria/web-embed/cdn")');
	});

	it("hands the server's model and the skills on to the page", () => {
		const { context } = site();
		leuriaDocusaurus(context, {
			server: { url: "/api/ai/chat/completions", model: "gpt-4o-mini", jsonSchema: true },
			skills: ["/", "acme/docs-skills/ask#0123abc"],
		});
		const config = JSON.parse(readFileSync(join(context.generatedFilesDir, "leuria/config.json"), "utf8"));
		expect(config.server).toEqual({ url: "/api/ai/chat/completions", model: "gpt-4o-mini", jsonSchema: true });
		expect(config.skills).toEqual(["/", "acme/docs-skills/ask#0123abc"]);
	});

	it("searches with the site's Algolia DocSearch, in the reader's language", () => {
		const { context } = site();
		const themeConfig = context.siteConfig.themeConfig as Record<string, unknown>;
		themeConfig.algolia = { appId: "APP", apiKey: "search-only", indexName: "docs", contextualSearch: true };
		(context as { i18n: unknown }).i18n = { currentLocale: "fr" };
		leuriaDocusaurus(context, {});
		const config = JSON.parse(readFileSync(join(context.generatedFilesDir, "leuria/config.json"), "utf8"));
		expect(config.algolia).toEqual({ appId: "APP", apiKey: "search-only", indexName: "docs", language: "fr" });
	});

	it("validates its options and keeps the instance id", () => {
		expect(validateOptions({ options: {} })).toEqual({ id: "default" });
		expect(() => validateOptions({ options: { askButton: "top" as never } })).toThrow(/askButton/);
		expect(() => validateOptions({ options: { skills: "/" as never } })).toThrow(/skills/);
		expect(() => validateOptions({ options: { server: { url: "/x", model: 4 as never } } })).toThrow(/model/);
	});
});
