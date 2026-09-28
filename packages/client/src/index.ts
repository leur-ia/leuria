/**
 * @leuria/client: AI features for web pages, served by the visitor's own
 * AI when they have one, with fallbacks when they don't.
 *
 *   import { createLeuria, bridge, browserAI, server, defineTool } from "@leuria/client"
 *
 *   const ai = createLeuria({ providers: [bridge(), browserAI(), server({ url: "/api/ai" })] })
 *   const answer = await ai.chat({ prompt: "Which mug is cheapest?", tools: [searchProducts] }).text()
 */

import type { ToolDefinition } from "./types.js";

export { createLeuria, Leuria } from "./leuria.js";
export type { ChatRequest, EmbedOptions, EmbedResponse, LeuriaOptions, LeuriaState, ProviderSnapshot } from "./leuria.js";
export { connection } from "./connection.js";
export { exposeTools, modelContext } from "./webmcp.js";
export type { Connection, ConnectionState, ConnectStatus } from "./connection.js";
export { Conversation } from "./conversation.js";
export type {
	ConversationOptions,
	ConversationState,
	ConversationHooks,
	ConversationStatus,
	PendingInput,
	Requirements,
	SendOptions,
	RoutingOptions,
} from "./conversation.js";
export { ChatRun } from "./run.js";
export { AbortError, LeuriaError, NoProviderError, StructuredOutputError, TimeoutError } from "./errors.js";
export {
	defaultFormatContext,
	fileText,
	messageFiles,
	messageText,
	newId,
	parseDataUrl,
	promptText,
	toMessage,
	transcript,
} from "./messages.js";
export type { ContextFormatter } from "./messages.js";
export { extractJson, SUBMIT_TOOL } from "./structured.js";

export { BaseProvider } from "./providers/base.js";
export { bridge, BridgeProvider } from "./providers/bridge.js";
export type { BridgeProviderOptions } from "./providers/bridge.js";
export { browserAI, BrowserAIProvider } from "./providers/browser.js";
export type { BrowserAIOptions } from "./providers/browser.js";
export { server, ServerProvider, sseData } from "./providers/server.js";
export type { ServerProviderOptions } from "./providers/server.js";

export { BridgeClient, BridgeSession, DEFAULT_URL, LeuriaNotConnectedError, LeuriaNotRunningError } from "./bridge/transport.js";
export type {
	BridgeAttachment,
	BridgeClientOptions,
	BridgeEvent,
	BridgeSessionOptions,
	BridgeStatus,
	BridgeTool,
	ConnectOptions,
	Detection,
	SiteNeeds,
} from "./bridge/transport.js";

export type * from "./types.js";

/** Identity helper that types a tool's arguments. */
export function defineTool<Args = Record<string, unknown>, Result = unknown>(
	tool: ToolDefinition<Args, Result>,
): ToolDefinition {
	return tool as unknown as ToolDefinition;
}
