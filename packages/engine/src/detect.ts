/**
 * Which agent CLIs are already on this computer, to suggest one in
 * onboarding ("You already have Codex"). The CLI → registry id map is the
 * only hardcoded knowledge; everything else comes from the registry.
 */

import { execFileSync } from "node:child_process";

const CLI_TO_REGISTRY_ID: Record<string, string> = {
	claude: "claude-acp",
	codex: "codex-acp",
	opencode: "opencode",
	vibe: "mistral-vibe",
	gemini: "gemini",
	copilot: "github-copilot-cli",
	pi: "pi-acp",
	goose: "goose",
	qwen: "qwen-code",
};

function onPath(command: string): boolean {
	try {
		execFileSync(process.platform === "win32" ? "where" : "which", [command], { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

/** Registry ids whose CLI is installed on this machine. */
export function detectInstalledClis(): string[] {
	return Object.entries(CLI_TO_REGISTRY_ID)
		.filter(([cli]) => onPath(cli))
		.map(([, id]) => id);
}
