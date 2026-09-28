/**
 * Gemini profile. Gemini CLI keeps its settings and sign-in in the user's
 * `~/.gemini`, shared with the Gemini CLI they may use themselves. A
 * sign-in method chosen there (Vertex AI with old gcloud credentials, say)
 * makes the ACP sign-in fail with "invalid_grant" before any browser page
 * opens. So Leuria gives Gemini its own home, `~/.leuria/gemini`:
 *
 *   - `GEMINI_CLI_HOME` moves `.gemini` (settings, accounts, trusted
 *     folders) there;
 *   - `GEMINI_FORCE_FILE_STORAGE` keeps the Google sign-in in that folder
 *     instead of the macOS Keychain, so erasing the folder signs out.
 *
 * Checked against gemini 0.61.0: with an empty home, `session/new` asks for
 * a sign-in and "Log in with Google" opens the browser.
 */

import { mkdirSync } from "node:fs";

import { homePath } from "./home.js";
import type { AgentProfile } from "./profiles.js";

export function geminiHome(): string {
	return homePath("gemini");
}

export const geminiProfile: AgentProfile = {
	home: geminiHome,
	configure: () => {
		mkdirSync(geminiHome(), { recursive: true, mode: 0o700 });
		return { env: { GEMINI_CLI_HOME: geminiHome(), GEMINI_FORCE_FILE_STORAGE: "true" } };
	},
};
