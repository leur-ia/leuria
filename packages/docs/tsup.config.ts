import { defineConfig } from "tsup";

export default defineConfig([
	{
		entry: ["src/index.ts"],
		format: ["esm"],
		dts: true,
		clean: true,
		target: "es2022",
		platform: "browser",
	},
	{
		// Build time (Node): pages to a corpus.
		entry: ["src/build.ts"],
		format: ["esm"],
		dts: true,
		target: "node22",
		platform: "node",
	},
]);
