/**
 * A conversation with an LLM provider (LM Studio, Ollama, any
 * OpenAI-compatible API), driven by the engine itself.
 *
 * Unlike an ACP agent, a plain model has no loop of its own: the engine
 * streams `/chat/completions` with the page's tools, runs each tool call
 * through the WebMCP relay (in the page), sends the results back, and
 * repeats until the model answers. The model has no other tool, so there
 * is nothing on the visitor's machine for it to reach.
 *
 * Same surface as `AcpLiveSession`, so the session manager treats both alike.
 */

import type { PromptAttachment } from "../acp/acp-client.js";
import type { ToolCallEvent } from "../acp/acp-client.js";
import { authHeaders, type LlmProvider, unreachable } from "./providers.js";

type Content = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

type Message =
	| { role: "system" | "user"; content: Content }
	| { role: "assistant"; content: string | null; tool_calls?: ApiToolCall[] }
	| { role: "tool"; tool_call_id: string; content: string };

interface ApiToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

interface PageTools {
	list: () => Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>;
	call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

interface LlmSessionOptions {
	provider: LlmProvider;
	model: string;
	systemPrompt?: string;
	/** Most model calls per turn (tool round trips). Default 10. */
	maxSteps?: number;
	tools: PageTools;
	onChunk?: (text: string) => void;
	onThought?: (text: string) => void;
	onToolCall?: (event: ToolCallEvent) => void;
}

export class LlmSession {
	private readonly messages: Message[] = [];
	private turn: AbortController | null = null;
	private alive = false;

	constructor(private readonly options: LlmSessionOptions) {
		if (options.systemPrompt) this.messages.push({ role: "system", content: options.systemPrompt });
	}

	get isAlive(): boolean {
		return this.alive;
	}

	/** Nothing to spawn: check that the provider answers. */
	async start(): Promise<{ error?: string }> {
		const { provider } = this.options;
		try {
			const res = await fetch(`${provider.baseUrl}/models`, {
				headers: authHeaders(provider),
				signal: AbortSignal.timeout(5000),
			});
			if (res.status === 401 || res.status === 403) return { error: `${provider.name} refused the API key.` };
		} catch {
			return { error: unreachable(provider) };
		}
		this.alive = true;
		return {};
	}

	async prompt(text: string, attachments: PromptAttachment[] = []): Promise<{ error?: string }> {
		if (!this.alive) return { error: "Session is not alive" };
		this.messages.push({ role: "user", content: userContent(text, attachments) });
		const controller = new AbortController();
		this.turn = controller;
		const maxSteps = this.options.maxSteps ?? 10;
		try {
			for (let step = 0; step < maxSteps; step++) {
				const { content, toolCalls } = await this.complete(controller.signal, step === maxSteps - 1);
				this.messages.push({ role: "assistant", content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
				if (toolCalls.length === 0) return {};
				for (const call of toolCalls) {
					if (controller.signal.aborted) return {};
					this.messages.push({ role: "tool", tool_call_id: call.id, content: await this.runTool(call) });
				}
			}
			return {};
		} catch (error) {
			// A cancelled turn ends normally, like an ACP `cancelled` stop reason.
			if (controller.signal.aborted) return {};
			return { error: error instanceof Error ? error.message : String(error) };
		} finally {
			this.turn = null;
		}
	}

	async cancelTurn(): Promise<void> {
		this.turn?.abort();
	}

	close(): void {
		this.turn?.abort();
		this.alive = false;
	}

	private async runTool(call: ApiToolCall): Promise<string> {
		const notify = (status: string) =>
			this.options.onToolCall?.({ toolCallId: call.id, title: call.function.name, toolName: `mcp__webmcp__${call.function.name}`, kind: "other", status });
		notify("in_progress");
		let args: Record<string, unknown> = {};
		try {
			args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
		} catch {
			notify("failed");
			return JSON.stringify({ error: "The arguments were not valid JSON." });
		}
		try {
			const result = await this.options.tools.call(call.function.name, args);
			notify("completed");
			return typeof result === "string" ? result : JSON.stringify(result ?? null);
		} catch (error) {
			notify("failed");
			return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
		}
	}

	/** One streamed model call; text and reasoning go out as they arrive. */
	private async complete(signal: AbortSignal, lastStep: boolean): Promise<{ content: string; toolCalls: ApiToolCall[] }> {
		const { provider, model } = this.options;
		const tools = this.options.tools.list();
		const body: Record<string, unknown> = { model, messages: this.messages, stream: true };
		if (tools.length) {
			body.tools = tools.map((t) => ({
				type: "function",
				function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema },
			}));
			// Out of steps: ask for a text answer.
			if (lastStep) body.tool_choice = "none";
		}

		let res: Response;
		try {
			res = await fetch(`${provider.baseUrl}/chat/completions`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...authHeaders(provider) },
				body: JSON.stringify(body),
				signal,
			});
		} catch (error) {
			if (signal.aborted) throw error;
			throw new Error(unreachable(provider));
		}
		if (!res.ok || !res.body) {
			const raw = await res.text().catch(() => "");
			// OpenAI-style errors: { error: { message } } or { error: "…" }.
			let detail = raw.slice(0, 300);
			try {
				const parsed = JSON.parse(raw) as { error?: { message?: string } | string };
				detail = typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? detail);
			} catch {
				// not JSON
			}
			if (res.status === 404 && /model/i.test(detail)) throw new Error(`${provider.name} does not have the model "${model}".`);
			if (res.status === 401 || res.status === 403) throw new Error(`${provider.name} refused the API key.`);
			throw new Error(detail ? `${provider.name}: ${detail}` : `${provider.name} answered with an error (${res.status}).`);
		}

		let content = "";
		const calls = new Map<number, ApiToolCall>();
		for await (const data of sseData(res.body)) {
			if (data === "[DONE]") break;
			let chunk: {
				choices?: Array<{
					delta?: {
						content?: string | null;
						reasoning_content?: string | null;
						reasoning?: string | null;
						tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
					};
				}>;
				error?: { message?: string };
			};
			try {
				chunk = JSON.parse(data);
			} catch {
				continue;
			}
			if (chunk.error?.message) throw new Error(`${provider.name}: ${chunk.error.message}`);
			const delta = chunk.choices?.[0]?.delta;
			if (!delta) continue;
			// LM Studio and DeepSeek say `reasoning_content`, Ollama says `reasoning`.
			const thought = delta.reasoning_content ?? delta.reasoning;
			if (thought) this.options.onThought?.(thought);
			if (delta.content) {
				content += delta.content;
				this.options.onChunk?.(delta.content);
			}
			for (const part of delta.tool_calls ?? []) {
				const index = part.index ?? calls.size;
				const call = calls.get(index) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
				if (part.id) call.id = part.id;
				if (part.function?.name) call.function.name += part.function.name;
				if (part.function?.arguments) call.function.arguments += part.function.arguments;
				calls.set(index, call);
			}
		}
		const toolCalls = [...calls.values()].map((c, i) => ({ ...c, id: c.id || `call_${i}_${Date.now()}` }));
		return { content, toolCalls };
	}
}

function userContent(text: string, attachments: PromptAttachment[]): Content {
	if (attachments.length === 0) return text;
	const parts: Exclude<Content, string> = [{ type: "text", text }];
	for (const file of attachments) {
		if (file.type === "image") parts.push({ type: "image_url", image_url: { url: `data:${file.mimeType};base64,${file.data}` } });
		else parts.push({ type: "text", text: `<file name="${file.name ?? "attachment"}">\n${file.text}\n</file>` });
	}
	return parts;
}

/** `data:` payloads of a server-sent event stream. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let index: number;
			while ((index = buffer.search(/\r?\n\r?\n/)) >= 0) {
				const block = buffer.slice(0, index);
				buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, "");
				const data = block
					.split(/\r?\n/)
					.filter((line) => line.startsWith("data:"))
					.map((line) => line.slice(5).trimStart())
					.join("\n");
				if (data) yield data;
			}
		}
	} finally {
		reader.releaseLock();
	}
}
