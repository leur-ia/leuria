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
});
