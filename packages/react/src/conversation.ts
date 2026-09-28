import type { ChatRun, Conversation, ConversationOptions, ConversationState, MessageInput, SendOptions } from "@leuria/client";
import { useEffect, useMemo, useState } from "react";

import { useLeuria } from "./context.js";
import { useSelector } from "./store.js";

export interface UseConversation<T = unknown> extends ConversationState {
	conversation: Conversation<T>;
	/** Send a user message; queued behind the running turn, if any. */
	send: (input: MessageInput, options?: SendOptions) => ChatRun<T>;
	/** Cancel the running turn and every queued one. */
	stop: () => void;
	/** Clear the history and end the provider session. */
	reset: (messages?: MessageInput[]) => void;
	/** Start the visitor's AI ahead of the first message. */
	warm: () => Promise<boolean>;
	/** Answer a tool call that has no `execute` (see `pendingInputs`). */
	submitToolResult: (callId: string, result: unknown) => void;
	/** Refuse a tool call that has no `execute`. */
	rejectToolCall: (callId: string, error?: string) => void;
}

const whole = (state: ConversationState) => state;

/** Follow the state of a conversation created elsewhere. */
export function useConversationState(conversation: Conversation<unknown>): ConversationState {
	return useSelector(conversation.subscribe, conversation.getState, whole);
}

/**
 * A multi-turn conversation that lives as long as the component. Options
 * are read on the first render: to change the system prompt or tools,
 * remount (give the component a new `key`) or call `reset`.
 */
export function useConversation<T = unknown>(options: ConversationOptions<T> = {}): UseConversation<T> {
	const client = useLeuria();
	const [conversation] = useState(() => client.conversation<T>(options));
	const state = useConversationState(conversation as Conversation<unknown>);

	useEffect(() => {
		// `close` keeps the history and a later `send` opens a new session,
		// so a remount (React's StrictMode) finds the conversation usable.
		const onHide = () => conversation.close();
		window.addEventListener("pagehide", onHide);
		return () => {
			window.removeEventListener("pagehide", onHide);
			conversation.close();
		};
	}, [conversation]);

	const actions = useMemo(
		() => ({
			conversation,
			send: (input: MessageInput, sendOptions?: SendOptions) => conversation.send(input, sendOptions),
			stop: () => conversation.stop(),
			reset: (messages?: MessageInput[]) => conversation.reset(messages),
			warm: () => conversation.warm(),
			submitToolResult: (callId: string, result: unknown) => conversation.submitToolResult(callId, result),
			rejectToolCall: (callId: string, error?: string) => conversation.rejectToolCall(callId, error),
		}),
		[conversation],
	);
	return { ...state, ...actions };
}
