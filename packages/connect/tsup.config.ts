import { defineConfig } from "tsup";

export default defineConfig([
	{
		entry: ["src/index.ts", "src/kit.ts"],
		format: ["esm"],
		dts: true,
		clean: true,
		target: "es2022",
		platform: "browser",
	},
	{
		// One file with the client inside, for pages without a bundler.
		entry: ["src/standalone.ts"],
		format: ["esm"],
		dts: true,
		target: "es2022",
		platform: "browser",
		noExternal: ["@leuria/client"],
	},
]);
