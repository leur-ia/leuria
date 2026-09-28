/**
 * Extra hardening for specific registry agents, on top of what ACP gives
 * every agent (no client fs/terminal, permission requests refused unless
 * for page tools, an empty sandbox directory, Claude-style `_meta`
 * session options that agents ignore when they do not know them).
 *
 * Keep this list short: it exists for agents whose defaults are unsafe
 * when a website writes the prompts.
 */

import type { InstalledAgent } from "./agents.js";
import { codexProfile } from "./codex.js";
import { geminiProfile } from "./gemini.js";
import type { AgentLaunch } from "./session-manager.js";

export interface AgentProfile {
	/** One-time preparation after install. */
	prepare?: (agent: InstalledAgent) => Promise<void>;
	/** Per-session environment, MCP servers and `_meta`. */
	configure?: AgentLaunch["configure"];
	/** Leuria's own folder for the agent's settings and sign-in; erased by a reset. */
	home?: () => string;
}

const PROFILES: Record<string, AgentProfile> = {
	"codex-acp": codexProfile,
	gemini: geminiProfile,
};

export function profileFor(id: string): AgentProfile | undefined {
	return PROFILES[id];
}
