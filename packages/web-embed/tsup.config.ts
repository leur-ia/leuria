import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/cdn.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	target: "es2022",
	platform: "browser",
	// Loaded only when the visitor asks for the model.
	external: ["@huggingface/transformers"],
	// The CDN worker is a blob: it can't import ./listen.js, so it gets its text.
	define: { WORKER_LISTEN: JSON.stringify(readFileSync("src/listen.js", "utf8")) },
});
