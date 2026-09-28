/**
 * The site's own server, as the last step of the cascade. It speaks the
 * OpenAI Chat Completions API with streaming, which most gateways, proxies
 * and local servers expose. Point it at your own endpoint, which adds the
 * key server-side; never put an API key in the page.
 *
 * Tools still run in the page: the provider streams the model's tool
 * calls, runs them through the core, and sends the results back.
 */

import { fileText, messageFiles, messageText } from "../messages.js";
import type { Message, MessagePart, ProviderSession, SessionOptions, TurnContext } from "../types.js";
import { BaseProvider } from "./base.js";

export interface ServerProviderOptions {
	/** Chat Completions URL, e.g. `/api/ai/chat/completions`. */
	url: string;
	/** Sent as `model`. Optional when your endpoint picks it. */
	model?: string;
	/** Extra headers, e.g. a CSRF token. Called per request. */
	headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
	/** Supports `response_format: { type: "json_schema" }`. Default false: structured output uses a tool. */
	jsonSchema?: boolean;
	/** Supports tool calls. Default true. */
	tools?: boolean;
	/** Accepts images (`image_url` content parts). Default false. */
	images?: boolean;
	id?: string;
	label?: string;
	fetch?: typeof fetch;
}

type ApiContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

type ApiMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: ApiContent }
	| { role: "assistant"; content: string | null; tool_calls?: ApiToolCall[] }
	| { role: "tool"; tool_call_id: string; content: string };

interface ApiToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

export class ServerProvider extends BaseProvider {
	constructor(private readonly options: ServerProviderOptions) {
		super(options.id ?? "server", options.label ?? "This site's AI", "site", { status: "unknown", capabilities: [] });
	}

	async detect(): Promise<void> {
		const capabilities: Array<"chat" | "tools" | "structured" | "images"> = ["chat"];
		if (this.options.tools !== false) capabilities.push("tools");
		if (this.options.jsonSchema) capabilities.push("structured");
		if (this.options.images) capabilities.push("images");
		this.setState({ status: "ready", capabilities, model: this.options.model });
	}

	async createSession(options: SessionOptions): Promise<ProviderSession> {
		return new ServerSession(this.options, options);
	}
}

class ServerSession implements ProviderSession {
	private readonly messages: ApiMessage[] = [];

	constructor(
		private readonly config: ServerProviderOptions,
		private readonly options: SessionOptions,
	) {
		if (options.system) this.messages.push({ role: "system", content: options.system });
		for (const message of options.history) this.messages.push(...toApiMessages(message));
	}

	async send(message: Message, context: TurnContext): Promise<{ text: string }> {
		this.messages.push({ role: "user", content: userContent(message) });
		let text = "";
		// One step per model call; tool results trigger the next step.
		for (let step = 0; step <= this.options.maxSteps; step++) {
			const { content, toolCalls } = await this.complete(context, step === this.options.maxSteps);
			text += content;
			this.messages.push({ role: "assistant", content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
			if (toolCalls.length === 0) return { text };
			for (const call of toolCalls) {
				let args: Record<string, unknown> = {};
				try {
					args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
				} catch {
					this.messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Arguments are not valid JSON." }) });
					continue;
				}
				const outcome = await context.runTool({ name: call.function.name, args, callId: call.id });
				this.messages.push({
					role: "tool",
					tool_call_id: call.id,
					content: JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error }),
				});
			}
		}
		return { text };
	}

	close(): void {
		// Stateless: nothing to release.
	}

	private async complete(context: TurnContext, lastStep: boolean): Promise<{ content: string; toolCalls: ApiToolCall[] }> {
		const headers = typeof this.config.headers === "function" ? await this.config.headers() : (this.config.headers ?? {});
		const body: Record<string, unknown> = { messages: this.messages, stream: true };
		if (this.config.model) body.model = this.config.model;
		if (this.options.tools.length && this.config.tools !== false) {
			body.tools = this.options.tools.map((t) => ({
				type: "function",
				function: { name: t.name, description: t.description, parameters: t.inputSchema },
			}));
			// Out of steps: force a text answer.
			if (lastStep) body.tool_choice = "none";
		}
		if (this.options.schema) {
			body.response_format = { type: "json_schema", json_schema: { name: "result", schema: this.options.schema, strict: true } };
		}

		const res = await (this.config.fetch ?? fetch)(this.config.url, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...headers },
			body: JSON.stringify(body),
			signal: context.signal,
		});
		if (!res.ok || !res.body) {
			const detail = await res.text().catch(() => "");
			throw new Error(`The site's AI endpoint failed: ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ""}`);
		}

		let content = "";
		const calls = new Map<number, ApiToolCall>();
		for await (const data of sseData(res.body)) {
			if (data === "[DONE]") break;
			const chunk = JSON.parse(data) as {
				choices?: Array<{
					delta?: {
						content?: string | null;
						tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
					};
				}>;
			};
			const delta = chunk.choices?.[0]?.delta;
			if (!delta) continue;
			if (delta.content) {
				content += delta.content;
				context.text(delta.content);
			}
			for (const part of delta.tool_calls ?? []) {
				const call = calls.get(part.index) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
				if (part.id) call.id = part.id;
				if (part.function?.name) call.function.name += part.function.name;
				if (part.function?.arguments) call.function.arguments += part.function.arguments;
				calls.set(part.index, call);
			}
		}
		const toolCalls = [...calls.values()].map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
		return { content, toolCalls };
	}
}

/** Previous messages in Chat Completions form, tool calls included. */
function toApiMessages(message: Message): ApiMessage[] {
	if (message.role === "user") return [{ role: "user", content: userContent(message) }];
	const calls = message.parts.filter((p): p is Extract<MessagePart, { type: "tool-call" }> => p.type === "tool-call");
	if (calls.length === 0) return [{ role: "assistant", content: messageText(message) }];
	return [
		{
			role: "assistant",
			content: null,
			tool_calls: calls.map((c) => ({ id: c.callId, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })),
		},
		...calls.map((c) => ({
			role: "tool" as const,
			tool_call_id: c.callId,
			content: JSON.stringify(c.error ? { error: c.error } : c.result),
		})),
		{ role: "assistant", content: messageText(message) },
	];
}

/** User text, text files inlined, images as `image_url` parts. */
function userContent(message: Message): ApiContent {
	const files = messageFiles(message);
	if (files.length === 0) return messageText(message);
	const content: Exclude<ApiContent, string> = [{ type: "text", text: messageText(message) }];
	for (const file of files) {
		const text = fileText(file);
		if (file.mediaType.startsWith("image/")) content.push({ type: "image_url", image_url: { url: file.url } });
		else if (text !== null) content.push({ type: "text", text: `<file name="${file.filename ?? "attachment"}">\n${text}\n</file>` });
	}
	return content;
}

/** `data:` payloads of a server-sent event stream. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
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

export function server(options: ServerProviderOptions): ServerProvider {
	return new ServerProvider(options);
}
