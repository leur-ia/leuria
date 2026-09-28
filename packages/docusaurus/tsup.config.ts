import { defineConfig } from "tsup";

export default defineConfig([
	{
		// The plugin: runs in Node, while Docusaurus builds the site.
		entry: ["src/index.ts"],
		format: ["esm"],
		dts: true,
		clean: true,
		target: "node20",
		platform: "node",
	},
	{
		// The client module: bundled into the site by Docusaurus.
		entry: { "client/index": "src/client/index.ts" },
		format: ["esm"],
		dts: true,
		target: "es2022",
		platform: "browser",
		external: [/^@docusaurus\//, /^@leuria\//, /^@leuria-docusaurus\//],
	},
]);
