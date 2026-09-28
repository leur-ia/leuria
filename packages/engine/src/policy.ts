/**
 * Harness policy for agents started on behalf of a website.
 *
 * Two layers, because the agent is an untrusted component:
 *
 *   1. Session options sent to the adapter on `session/new`
 *      ({@link buildSessionMeta}). For claude-agent-acp these are spread
 *      into the Claude Agent SDK options: no built-in tools, no user or
 *      project settings (so no plugins, hooks or extra MCP servers), no
 *      bypass mode, and the WebMCP server's tools pre-allowed.
 *
 *   2. The ACP `session/request_permission` handler
 *      ({@link decidePermission}). Anything that still asks for
 *      permission is denied unless it is one of the page's WebMCP
 *      tools. This holds even if an adapter ignores layer 1.
 */

/** MCP server name the bridge registers for the browser tools. */
export const WEBMCP_SERVER_NAME = "webmcp";

/** Tool-name prefixes allowed through the permission handler (Claude and Codex naming). */
const ALLOWED_TOOL_PREFIXES = [`mcp__${WEBMCP_SERVER_NAME}__`, `mcp.${WEBMCP_SERVER_NAME}.`];

/**
 * Claude Code built-in tools. `tools: []` already removes them; this list
 * is a second guard for adapters or SDK versions that ignore `tools`.
 */
const BUILT_IN_TOOLS = [
	"Agent",
	"Bash",
	"BashOutput",
	"Edit",
	"ExitPlanMode",
	"Glob",
	"Grep",
	"KillShell",
	"MultiEdit",
	"NotebookEdit",
	"Read",
	"Task",
	"TodoWrite",
	"WebFetch",
	"WebSearch",
	"Write",
];

export interface SessionConfig {
	/** System prompt. Replaces the adapter's coding-agent preset. */
	systemPrompt?: string;
	model?: string;
	maxTurns?: number;
}

/** Build the `_meta` payload for ACP `session/new`. */
export function buildSessionMeta(
	config: SessionConfig = {},
): Record<string, unknown> {
	const options: Record<string, unknown> = {
		tools: [],
		allowedTools: [`mcp__${WEBMCP_SERVER_NAME}`],
		disallowedTools: BUILT_IN_TOOLS,
		settingSources: [],
		strictMcpConfig: true,
		allowDangerouslySkipPermissions: false,
	};
	if (config.model) options.model = config.model;
	if (config.maxTurns) options.maxTurns = config.maxTurns;

	const meta: Record<string, unknown> = { claudeCode: { options } };
	// A string replaces the adapter's preset prompt: the agent is
	// the website's assistant, not a coding assistant.
	if (config.systemPrompt) meta.systemPrompt = config.systemPrompt;
	return meta;
}

export interface PermissionDecision {
	allow: boolean;
	toolName: string;
	/** ACP response for `session/request_permission`. */
	response: {
		outcome:
			| { outcome: "selected"; optionId: string }
			| { outcome: "cancelled" };
	};
}

interface PermissionOption {
	optionId?: unknown;
	kind?: unknown;
}

/** Decide an ACP `session/request_permission` request. Deny by default. */
export function decidePermission(params: unknown): PermissionDecision {
	const p = (params ?? {}) as Record<string, unknown>;
	const toolName = extractToolName(p);
	const allow = ALLOWED_TOOL_PREFIXES.some((prefix) =>
		toolName.startsWith(prefix),
	);
	const options = Array.isArray(p.options)
		? (p.options as PermissionOption[])
		: [];
	const wanted = allow
		? ["allow_once", "allow_always"]
		: ["reject_once", "reject_always"];
	const option = options.find(
		(o) => typeof o.kind === "string" && wanted.includes(o.kind),
	);
	if (option && typeof option.optionId === "string") {
		return {
			allow,
			toolName,
			response: {
				outcome: { outcome: "selected", optionId: option.optionId },
			},
		};
	}
	// No matching option: cancelling the request is a refusal in ACP.
	return {
		allow: false,
		toolName,
		response: { outcome: { outcome: "cancelled" } },
	};
}

function extractToolName(p: Record<string, unknown>): string {
	const toolCall = (p.toolCall ?? {}) as Record<string, unknown>;
	const meta = (toolCall._meta ?? {}) as Record<string, unknown>;
	const claudeCode = (meta.claudeCode ?? {}) as Record<string, unknown>;
	const candidates = [claudeCode.toolName, p.toolName, toolCall.title];
	const name = candidates.find(
		(c): c is string => typeof c === "string" && c.length > 0,
	);
	return name ?? "unknown";
}
