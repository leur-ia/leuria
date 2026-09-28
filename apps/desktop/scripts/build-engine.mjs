#!/usr/bin/env node
// Compile the engine (packages/engine) into one Bun binary, named with the
// Rust target triple as Tauri's sidecar convention requires:
//   src-tauri/binaries/leuria-engine-<triple>[.exe]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const engine = `${root}packages/engine`;
const triple =
	process.env.TAURI_ENV_TARGET_TRIPLE ??
	execFileSync("rustc", ["-vV"], { encoding: "utf-8" }).match(/^host: (.+)$/m)?.[1];
if (!triple) throw new Error("Could not find the Rust target triple (install Rust: https://rustup.rs)");

const { version } = JSON.parse(readFileSync(`${engine}/package.json`, "utf-8"));
const bunTarget = {
	"aarch64-apple-darwin": "bun-darwin-arm64",
	"x86_64-apple-darwin": "bun-darwin-x64",
	"x86_64-pc-windows-msvc": "bun-windows-x64",
	"aarch64-pc-windows-msvc": "bun-windows-arm64",
	"x86_64-unknown-linux-gnu": "bun-linux-x64",
	"aarch64-unknown-linux-gnu": "bun-linux-arm64",
}[triple];
if (!bunTarget) throw new Error(`No Bun target for ${triple}`);
const ext = triple.includes("windows") ? ".exe" : "";
const out = fileURLToPath(new URL(`../src-tauri/binaries/leuria-engine-${triple}${ext}`, import.meta.url));

execFileSync(
	"bun",
	["build", "src/cli.ts", "--compile", "--minify", `--target=${bunTarget}`, "--define", `__LEURIA_VERSION__="${version}"`, "--outfile", out],
	{ cwd: engine, stdio: "inherit" },
);
console.log(`engine ${version} → ${out}`);
