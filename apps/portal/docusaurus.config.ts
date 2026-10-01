import { fileURLToPath } from "node:url";

import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

import remarkRepoLinks from "./plugins/remark-repo-links.mjs";

const repoUrl = "https://github.com/leur-ia/leuria";
const demosUrl = "https://demo.leuria.dev";
const repoDir = fileURLToPath(new URL("../..", import.meta.url));
const docsDir = fileURLToPath(new URL("../../docs", import.meta.url));

/**
 * Search and share metadata for the pages people land on from outside. The docs
 * are plain Markdown that must read well on GitHub, so it lives here instead of
 * in front matter. Keyed by the path under docs/.
 */
const pageMeta: Record<string, { description: string; keywords?: string[]; image?: string }> = {
	"developers/docusaurus.md": {
		description:
			"Add an Ask AI assistant to your Docusaurus site that answers from your pages, on each reader's own AI (ChatGPT, Claude, Mistral or a local model). No API keys, nothing to pay per question.",
		keywords: ["docusaurus", "docusaurus plugin", "ask ai", "docs assistant", "ai search", "webmcp", "bring your own ai"],
		image: "img/social/docusaurus.jpg",
	},
	"developers/prompt-api.md": {
		description:
			"Write AI features for the Prompt API (LanguageModel) and run them in every browser: the browser's built-in model where it can run, the visitor's own AI through Leuria elsewhere.",
		keywords: ["prompt api", "LanguageModel", "polyfill", "built-in ai", "gemini nano", "chrome ai", "bring your own ai"],
	},
	"developers/quickstart.md": {
		description: "Add an AI feature to your website that runs on your visitor's own AI: plain HTML, React or assistant-ui, in a few lines.",
		keywords: ["ai sdk", "bring your own ai", "browser ai", "react", "assistant-ui"],
	},
};

const config: Config = {
	title: "Leuria",
	tagline: "Bring your own AI to the web",
	favicon: "img/favicon.svg",
	// Browsers without SVG icons (Safari) take the .ico; iPhones take the touch icon.
	headTags: [
		{ tagName: "link", attributes: { rel: "icon", href: "/favicon.ico", sizes: "32x32" } },
		{ tagName: "link", attributes: { rel: "apple-touch-icon", href: "/img/apple-touch-icon.png" } },
	],
	url: "https://leuria.dev",
	baseUrl: "/",
	organizationName: "leur-ia",
	projectName: "leuria",
	trailingSlash: false,

	onBrokenLinks: "throw",
	markdown: {
		// .md files are CommonMark (they must read well on GitHub too); .mdx is MDX.
		format: "detect",
		mermaid: true,
		hooks: { onBrokenMarkdownLinks: "throw" },
		parseFrontMatter: async (params) => {
			const result = await params.defaultParseFrontMatter(params);
			const meta = pageMeta[params.filePath.slice(docsDir.length).replace(/^[\\/]/, "").replaceAll("\\", "/")];
			if (meta) result.frontMatter = { ...meta, ...result.frontMatter };
			return result;
		},
	},
	// Cascade layers are off: for this site's browser targets the build replaces
	// them with specificity boosts, and Infima's then beat custom.css.
	future: {
		v4: {
			removeLegacyPostBuildHeadAttribute: true,
			useCssCascadeLayers: false,
			siteStorageNamespacing: true,
			fasterByDefault: true,
			mdx1CompatDisabledByDefault: true,
		},
		faster: true,
	},
	i18n: { defaultLocale: "en", locales: ["en"] },

	presets: [
		[
			"classic",
			{
				docs: {
					path: docsDir,
					routeBasePath: "docs",
					sidebarPath: "./sidebars.ts",
					editUrl: `${repoUrl}/edit/main/docs/`,
					beforeDefaultRemarkPlugins: [[remarkRepoLinks, { repoDir, docsDir, repoUrl }]],
				},
				blog: false,
				theme: { customCss: "./src/css/custom.css" },
			} satisfies Preset.Options,
		],
	],

	themes: ["@docusaurus/theme-mermaid"],

	plugins: [
		[
			// The API reference, from the packages' TSDoc: markdown in api/ (not committed), served at /api.
			"docusaurus-plugin-typedoc",
			{
				id: "typedoc",
				entryPointStrategy: "packages",
				entryPoints: ["client", "react", "connect", "react-connect", "store", "web-embed", "docs", "docusaurus"].map((name) => `../../packages/${name}`),
				packageOptions: { entryPoints: ["src/index.ts"], excludeInternal: true, readme: "none" },
				out: "api",
				readme: "none",
				excludePrivate: true,
				excludeProtected: true,
				sidebar: { pretty: true },
			},
		],
		[
			"@docusaurus/plugin-content-docs",
			{ id: "api", path: "api", routeBasePath: "api", sidebarPath: "./sidebars-api.ts", editUrl: undefined },
		],
		[
			"@leuria/docusaurus",
			{
				app: "Leuria docs",
				search: true,
				connectButton: true,
				pageEmbeddings: true,
				suggestions: ["How do I add Leuria to my site?", "How do page tools work?", "What happens when the visitor has no AI?"],
			},
		],
		["docusaurus-plugin-llms", { docsDir: "../../docs", generateMarkdownFiles: true }],
	],

	themeConfig: {
		image: "img/social/leuria-dev.jpg",
		metadata: [
			{ name: "keywords", content: "bring your own ai, ai sdk, browser ai, webmcp, docusaurus plugin, ai features, no api keys" },
			{ name: "twitter:card", content: "summary_large_image" },
		],
		colorMode: { respectPrefersColorScheme: true },
		navbar: {
			title: "leuria",
			logo: { alt: "", src: "img/mark.svg", srcDark: "img/mark-dark.svg", width: 28, height: 28 },
			items: [
				{ type: "docSidebar", sidebarId: "docs", position: "left", label: "Docs" },
				{ type: "docSidebar", sidebarId: "api", docsPluginId: "api", position: "left", label: "API" },
				{ to: "/tool-builder", label: "Tool builder", position: "left" },
				{ href: demosUrl, label: "Demos", position: "left" },
				{ href: `${repoUrl}`, label: "GitHub", position: "right" },
			],
		},
		footer: {
			links: [
				{
					title: "Build",
					items: [
						{ label: "Quickstart", to: "/docs/developers/quickstart" },
						{ label: "Examples", to: "/docs/developers/examples" },
						{ label: "Live demos", href: demosUrl },
						{ label: "API reference", to: "/api" },
						{ label: "Engine protocol", to: "/docs/developers/protocol" },
						{ label: "Ask AI for Docusaurus", to: "/docs/developers/docusaurus" },
					],
				},
				{
					title: "Use",
					items: [{ label: "Get the Leuria app", href: "https://leuria.eu/download" }],
				},
				{
					title: "Project",
					items: [
						{ label: "GitHub", href: repoUrl },
						{ label: "Security", to: "/docs/security" },
						{ label: "Privacy", href: "https://leuria.eu/privacy-policy" },
						{ html: '<button type="button" class="footer__link-item footer-consent" data-consent-open>Visit counting</button>' },
					],
				},
			],
			copyright: "Leuria · Apache-2.0",
		},
		prism: { theme: prismThemes.github, darkTheme: prismThemes.dracula, additionalLanguages: ["bash", "json"] },
	} satisfies Preset.ThemeConfig,
};

export default config;
