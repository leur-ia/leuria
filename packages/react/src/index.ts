/**
 * @leuria/react: the visitor's AI as React state.
 *
 *   import { LeuriaProvider, useConnect, useConversation } from "@leuria/react"
 *
 *   <LeuriaProvider client={ai}>…</LeuriaProvider>
 *   const { messages, status, send } = useConversation({ system, tools: [searchProducts] })
 */

export { LeuriaProvider, useLeuria } from "./context.js";
export { useLeuriaState, useProvider } from "./state.js";
export { useConversation, useConversationState } from "./conversation.js";
export type { UseConversation } from "./conversation.js";
export { useChat } from "./chat.js";
export type { ChatState, UseChat } from "./chat.js";
export { useConnect } from "./connect.js";
export { useExposedTools } from "./webmcp.js";
export type { UseConnect } from "./connect.js";
export type { ConnectStatus } from "@leuria/client";
