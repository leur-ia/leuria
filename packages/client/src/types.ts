/**
 * Core types shared by the cascade, the providers and, later, the
 * framework adapters (React, assistant-ui, AI SDK). Keep them plain data:
 * adapters map them one to one.
 */

// ── Tools ──────────────────────────────────────────────────────────────

/** JSON Schema object, as sent to models. */
export type JsonSchema = Record<string, unknown>;

export interface ToolDefinition<Args = Record<string, unknown>, Result = unknown> {
	/** `[a-zA-Z0-9_-]`, unique within a request. */
	name: string;
	description: string;
	inputSchema: JsonSchema;
	/**
	 * Runs in the page. The result is sent to the model as JSON; a thrown
	 * error is sent as `{ error }` so the model can react.
	 *
	 * Omit it for a tool the visitor answers: the call waits, with its part
	 * in `awaiting-input` state, until the UI calls
	 * `conversation.submitToolResult(callId, result)`.
	 */
	execute?: (args: Args, context: ToolContext) => Promise<Result> | Result;
	/** Hints for the browser's agents when the tool is offered through WebMCP (`exposeTools`). */
	annotations?: ToolAnnotations;
}

/** Hints for the browser's agents, from the WebMCP spec. */
export interface ToolAnnotations {
	/** The tool only reads: safe to call without asking. */
	readOnlyHint?: boolean;
	/** Its result may contain text the page doesn't control (reviews, messages). */
	untrustedContentHint?: boolean;
	/** It does something that matters (orders, sends, deletes): the agent should confirm first. */
	consequentialHint?: boolean;
}

export interface ToolContext<TurnContextValue = unknown> {
	/** Id of this call, stable across events. */
	callId: string;
	turnId: string;
	/**
	 * The turn's context from `send(text, { context })`: values the page
	 * binds to this turn (current account, selection…). The model never
	 * sets them.
	 */
	context: TurnContextValue;
	/** How many times this tool has been called in this turn, this call included. */
	callCount: number;
	/**
	 * End the turn once this call returns: the agent is stopped and the run
	 * resolves with `outcome` (for "terminal" tools, e.g. `render_view`).
	 */
	endTurn: (outcome?: unknown) => void;
	/** Aborted when the turn is cancelled, times out or ends. */
	signal: AbortSignal;
}

export interface ToolCall {
	callId: string;
	turnId: string;
	name: string;
	args: Record<string, unknown>;
	context: unknown;
}

/**
 * Wraps every tool call: observe, redact, block or rewrite results.
 * Call `next()` to run the tool (or the next middleware).
 */
export type ToolMiddleware = (call: ToolCall, next: () => Promise<ToolOutcome>) => Promise<ToolOutcome>;

// ── Messages ───────────────────────────────────────────────────────────

export type Role = "user" | "assistant";

export type MessagePart =
	| { type: "text"; text: string }
	| { type: "reasoning"; text: string }
	| {
			type: "file";
			/** IANA media type, e.g. `image/png`, `text/markdown`. */
			mediaType: string;
			/** `data:` URL. */
			url: string;
			filename?: string;
	  }
	| {
			type: "tool-call";
			callId: string;
			name: string;
			args: Record<string, unknown>;
			/** `awaiting-input`: a tool without `execute`, waiting for the UI. */
			state: "running" | "awaiting-input" | "done" | "error";
			result?: unknown;
			error?: string;
	  };

export interface Message {
	id: string;
	role: Role;
	parts: MessagePart[];
	/**
	 * User messages: the turn context, sent to the model apart from the
	 * text (see `formatContext`). Not shown as the visitor's words.
	 */
	context?: unknown;
	/** Assistant messages: who answered, when, and what ended the turn. */
	metadata?: {
		turnId: string;
		provider?: ProviderInfo;
		startedAt: number;
		finishedAt?: number;
		outcome?: unknown;
		/** The AI couldn't use the conversation's tools and answered with the page's context instead. */
		limited?: boolean;
	};
}

/** A file to send: a browser `File`/`Blob`, or an already encoded data URL. */
export type FileInput = Blob | { url: string; mediaType: string; filename?: string };

/** A message given by the caller: a plain string is a user text message. */
export type MessageInput =
	| string
	| { role: Role; content: string; files?: FileInput[] }
	| Message;

// ── Capabilities ───────────────────────────────────────────────────────

export type Capability =
	/** Text generation. Every provider has it. */
	| "chat"
	/** Calls page tools. */
	| "tools"
	/** Returns JSON that matches a schema (natively or through a tool). */
	| "structured"
	/** Runs a multi-step agent loop on its own. */
	| "agent"
	/** Accepts images in user messages. */
	| "images"
	/** Produces embeddings. */
	| "embed";

/** Where requests go, so the page can tell the visitor. */
export type Locality =
	/** The visitor's own machine (engine, browser AI, in-page model). */
	| "device"
	/** A service the visitor chose, reached from their machine (engine with an API key). */
	| "visitor-cloud"
	/** The site's own server. */
	| "site";

// ── Providers ──────────────────────────────────────────────────────────

export type ProviderStatus =
	/** Not checked yet. */
	| "unknown"
	/** Being checked. */
	| "detecting"
	/** Cannot work here (no engine, no browser AI, …). */
	| "unavailable"
	/** Present, but the visitor must act: connect the site, allow a download… */
	| "needs-action"
	/** Model is downloading; see `progress`. */
	| "downloading"
	| "ready";

export interface ProviderState {
	status: ProviderStatus;
	capabilities: Capability[];
	/** The embedding model, when the provider can embed now (`embed` capability). Vectors of different models can't be compared. */
	embedModel?: string;
	/** Plain-language model or agent name, e.g. "Claude Code", "Gemini Nano". */
	model?: string;
	/** What `connect()` would do, when `status` is `needs-action`. */
	action?: "connect" | "download";
	/** 0..1 while downloading. */
	progress?: number;
	/** Human-readable reason for the status. */
	detail?: string;
}

export interface ProviderInfo {
	id: string;
	label: string;
	locality: Locality;
}

/** Everything a provider needs from the core while it runs a turn. */
export interface TurnContext {
	turnId: string;
	/** Stream text to the caller. */
	text: (delta: string) => void;
	/** Stream reasoning to the caller, when the model exposes it. */
	reasoning: (delta: string) => void;
	/** Progress the caller may show, e.g. "Starting your agent…". */
	status: (message: string) => void;
	/**
	 * Run a page tool and return what the model should see. Emits the
	 * `tool-call` and `tool-result` events. Never throws: failures come
	 * back as `{ error }`.
	 */
	runTool: (call: { name: string; args: Record<string, unknown>; callId?: string }) => Promise<ToolOutcome>;
	/** Aborted when the turn is cancelled, times out or is ended by a tool. */
	signal: AbortSignal;
}

export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: string };

export interface SessionOptions {
	system?: string;
	/** Tool descriptors; execution always goes through `TurnContext.runTool`. */
	tools: Array<Pick<ToolDefinition, "name" | "description" | "inputSchema">>;
	/** Present when the provider declared native `structured` support. */
	schema?: JsonSchema;
	/** Conversation so far, before the first `send`. */
	history: Message[];
	maxSteps: number;
}

/**
 * A provider-side conversation. The core owns the message history; a
 * session gets each new user message and may keep its own context
 * (an agent session) or resend the history (a stateless HTTP API).
 *
 * `message` is the user message as the model should see it: the turn
 * context is already rendered into its text (see `promptText`).
 */
export interface ProviderSession {
	/**
	 * Run one turn. Resolves with the assistant text when the turn ends.
	 * When `context.signal` aborts, stop the turn and settle soon after,
	 * keeping the session usable if possible.
	 */
	send: (message: Message, context: TurnContext) => Promise<{ text: string }>;
	/** Get ready ahead of the first turn (start an agent, load a model). */
	warm?: () => Promise<void>;
	close: () => void;
	/**
	 * The provider ended this session on its own (e.g. the visitor changed
	 * the AI or model for this site): the conversation opens a new one.
	 */
	readonly closed?: boolean;
}

/** What a provider is for. */
export type Service = "chat" | "embed";

export interface EmbedRequest {
	texts: string[];
	/**
	 * `query` for what the visitor searches, `document` for what is
	 * searched: some models embed them differently.
	 */
	kind: "query" | "document";
	signal?: AbortSignal;
}

export interface EmbedResult {
	/** One vector per text, in order. */
	vectors: number[][];
	/** The model that made them. */
	model: string;
}

export interface Provider extends ProviderInfo {
	/** What it serves. Default `["chat"]`; an embedder alone is `["embed"]`. */
	readonly offers?: readonly Service[];
	/**
	 * The visitor's own AI, to propose first: while it isn't ready, the chat
	 * providers after it wait until the visitor picks one
	 * (`ai.chooseInstead(id)`), unless the client has `fallback: "auto"`.
	 */
	readonly asksFirst?: boolean;
	/** Current state; the core re-reads it after `onChange` fires. */
	getState: () => ProviderState;
	/** Subscribe to state changes. Returns the unsubscribe function. */
	onChange: (listener: () => void) => () => void;
	/** Check availability. Cheap and safe to call often. */
	detect: () => Promise<void>;
	/**
	 * Resolve `needs-action`: pair with the engine, start a model
	 * download… Must be called from a user gesture.
	 */
	connect?: () => Promise<void>;
	/** Forget the visitor's grant in this browser, if any. */
	disconnect?: () => void;
	/** Open the visitor's own settings for this site (their AI and model), from a click. */
	manage?: () => void;
	createSession: (options: SessionOptions) => Promise<ProviderSession>;
	/** Embed texts; present on providers that offer `embed`. */
	embed?: (request: EmbedRequest) => Promise<EmbedResult>;
}

// ── Runs ───────────────────────────────────────────────────────────────

export type ChatEventBody =
	| { type: "start"; provider: ProviderInfo }
	| { type: "status"; message: string }
	| { type: "text-delta"; text: string }
	| { type: "reasoning-delta"; text: string }
	| { type: "tool-call"; callId: string; name: string; args: Record<string, unknown> }
	/** A tool without `execute` waits for `submitToolResult`. */
	| { type: "tool-input"; callId: string; name: string; args: Record<string, unknown> }
	| { type: "tool-result"; callId: string; name: string; result?: unknown; error?: string }
	| { type: "finish"; text: string; object?: unknown; outcome?: unknown }
	| { type: "error"; error: Error };

/** Every event names its turn and carries a timestamp (ms since epoch). */
export type ChatEvent = ChatEventBody & { turnId: string; at: number };

export interface ChatResult<T = unknown> {
	text: string;
	/** Parsed and validated structured output, when a schema was given. */
	object?: T;
	/** Value passed to `endTurn()` by a tool, if one ended the turn. */
	outcome?: unknown;
	/** The assistant message, with its tool calls. */
	message: Message;
	provider: ProviderInfo;
}
