import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
	docs: [
		"README",
		{ type: "category", label: "Get started", collapsed: false, items: ["developers/quickstart", "developers/sdk", "developers/docusaurus"] },
		{
			type: "category",
			label: "Guides",
			collapsed: false,
			items: [
				"developers/guides/providers",
				"developers/guides/conversations",
				"developers/guides/tools",
				"developers/guides/skills",
				"developers/guides/structured-output",
				"developers/guides/embeddings",
				"developers/guides/connect-ui",
				"developers/guides/react",
				"developers/guides/custom-providers",
				"developers/production",
			],
		},
		{
			type: "category",
			label: "Examples",
			link: { type: "doc", id: "developers/examples/index" },
			items: [
				"developers/examples/first-answer",
				"developers/examples/page-tool",
				"developers/examples/structured-output",
				"developers/examples/conversation-context",
				"developers/examples/visitor-answers",
				"developers/examples/search-by-meaning",
				"developers/examples/middleware",
				"developers/examples/routing",
			],
		},
		"developers/cli",
		"developers/protocol",
		"security",
		{ type: "category", label: "Contribute", items: ["contributing/architecture", "contributing/development"] },
	],
};

export default sidebars;
