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

	it("validates its options and keeps the instance id", () => {
		expect(validateOptions({ options: {} })).toEqual({ id: "default" });
		expect(() => validateOptions({ options: { askButton: "top" as never } })).toThrow(/askButton/);
	});
});
