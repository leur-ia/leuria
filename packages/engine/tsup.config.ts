import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };

export default defineConfig({
	entry: ["src/cli.ts"],
	format: ["esm"],
	clean: true,
	target: "node22",
	define: { __LEURIA_VERSION__: JSON.stringify(version) },
});
