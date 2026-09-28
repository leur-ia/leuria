import { AbortError, type ChatRequest, type ChatRun, type ProviderInfo } from "@leuria/client";
import { useCallback, useEffect, useRef, useState } from "react";

import { useLeuria } from "./context.js";

export interface ChatState {
	status: "idle" | "running" | "done" | "error";
	/** The answer so far, streamed. */
	text: string;
	/** Progress worth showing while it starts, e.g. "Starting Codex…". */
	progress?: string;
	/** Who answers. */
	provider?: ProviderInfo;
	error?: Error;
}

export interface UseChat extends ChatState {
	/**
	 * Start a one-shot request; a running one is stopped. Await
	 * `run.text()` or `run.object()` for the result.
	 */
	start: <T = unknown>(request: ChatRequest<T>) => ChatRun<T>;
	stop: () => void;
}

const IDLE: ChatState = { status: "idle", text: "" };

/** One-shot requests (summaries, structured output) with their progress as state. */
export function useChat(): UseChat {
	const client = useLeuria();
	const [state, setState] = useState<ChatState>(IDLE);
	const current = useRef<ChatRun<unknown> | null>(null);

	const start = useCallback(
		<T = unknown>(request: ChatRequest<T>): ChatRun<T> => {
			current.current?.abort(new AbortError());
			const run = client.chat(request);
			current.current = run as ChatRun<unknown>;
			setState({ status: "running", text: "" });
			run.on((event) => {
				if (current.current !== run) return;
				if (event.type === "start") setState((s) => ({ ...s, provider: event.provider }));
				else if (event.type === "status") setState((s) => ({ ...s, progress: event.message }));
				else if (event.type === "text-delta") setState((s) => ({ ...s, progress: undefined, text: s.text + event.text }));
				else if (event.type === "finish") setState((s) => ({ ...s, status: "done", progress: undefined, text: event.text }));
				else if (event.type === "error") {
					// Stopping is the caller's choice, not a failure.
					const stopped = event.error instanceof AbortError;
					setState((s) => ({ ...s, status: stopped ? "idle" : "error", progress: undefined, error: stopped ? undefined : event.error }));
				}
			});
			return run;
		},
		[client],
	);

	const stop = useCallback(() => current.current?.abort(new AbortError()), []);
	useEffect(() => () => current.current?.abort(new AbortError()), []);

	return { ...state, start, stop };
}
