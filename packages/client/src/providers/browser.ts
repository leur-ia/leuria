/**
 * The browser's built-in model, through the Prompt API (`LanguageModel`,
 * Gemini Nano in Chrome). Free and on-device, but small: good for short
 * answers, extraction and structured output, less so for long agentic work.
 *
 * Structured output is native (`responseConstraint`). Tool use is off by
 * default because browser support varies; enable it with `tools: true`.
 */

import { fileText, messageFiles, messageText } from "../messages.js";
import type { Capability, Message, ProviderSession, SessionOptions, TurnContext } from "../types.js";
import { BaseProvider } from "./base.js";

export interface BrowserAIOptions {
	/** Pass page tools to the model (`LanguageModel.create({ tools })`). Default false. */
	tools?: boolean;
	/** Languages for `expectedInputs` / `expectedOutputs`, e.g. `["en"]`. */
	languages?: string[];
	id?: string;
	label?: string;
}

type Availability = "unavailable" | "downloadable" | "downloading" | "available";

interface LanguageModelSession {
	promptStreaming(input: string, options?: { signal?: AbortSignal; responseConstraint?: unknown }): ReadableStream<string>;
	destroy(): void;
}

interface LanguageModelStatic {
	availability(options?: Record<string, unknown>): Promise<Availability>;
	create(options?: Record<string, unknown>): Promise<LanguageModelSession>;
}

function languageModel(): LanguageModelStatic | undefined {
	return (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel;
}

export class BrowserAIProvider extends BaseProvider {
	constructor(private readonly options: BrowserAIOptions = {}) {
		super(options.id ?? "browser", options.label ?? "Browser AI", "device", { status: "unknown", capabilities: [] });
	}

	private get capabilities(): Capability[] {
		return this.options.tools ? ["chat", "structured", "tools"] : ["chat", "structured"];
	}

	private get baseOptions(): Record<string, unknown> {
		const languages = this.options.languages;
		return languages
			? { expectedInputs: [{ type: "text", languages }], expectedOutputs: [{ type: "text", languages }] }
			: {};
	}

	async detect(): Promise<void> {
		const api = languageModel();
		if (!api) {
			this.setState({ status: "unavailable", capabilities: [], detail: "This browser has no built-in AI" });
			return;
		}
		let availability: Availability;
		try {
			availability = await api.availability(this.baseOptions);
		} catch {
			availability = "unavailable";
		}
		if (this.getState().status === "downloading" && availability !== "available") return;
		switch (availability) {
			case "available":
				this.setState({ status: "ready", capabilities: this.capabilities, action: undefined, detail: undefined, progress: undefined });
				break;
			case "downloadable":
				this.setState({
					status: "needs-action",
					action: "download",
					capabilities: this.capabilities,
					detail: "The browser's model must be downloaded first",
				});
				break;
			case "downloading":
				this.setState({ status: "downloading", capabilities: this.capabilities, detail: "The browser's model is downloading" });
				break;
			default:
				this.setState({ status: "unavailable", capabilities: [], detail: "The browser's built-in AI is not available on this device" });
		}
	}

	/** Start the model download. Needs a user gesture. */
	async connect(): Promise<void> {
		const api = languageModel();
		if (!api) throw new Error("This browser has no built-in AI.");
		this.setState({ status: "downloading", progress: 0, detail: "The browser's model is downloading" });
		const session = await api.create({
			...this.baseOptions,
			monitor: (monitor: EventTarget) => {
				monitor.addEventListener("downloadprogress", (event) => {
					this.setState({ progress: (event as unknown as { loaded: number }).loaded });
				});
			},
		});
		session.destroy();
		this.setState({ status: "ready", capabilities: this.capabilities, progress: undefined, action: undefined, detail: undefined });
	}

	async createSession(options: SessionOptions): Promise<ProviderSession> {
		const api = languageModel();
		if (!api) throw new Error("This browser has no built-in AI.");
		const holder: { context: TurnContext | null } = { context: null };
		const initialPrompts: Array<{ role: string; content: string }> = [];
		if (options.system) initialPrompts.push({ role: "system", content: options.system });
		for (const message of options.history) {
			const text = messageText(message);
			if (text) initialPrompts.push({ role: message.role, content: text });
		}
		const create: Record<string, unknown> = { ...this.baseOptions, initialPrompts };
		if (this.options.tools && options.tools.length) {
			create.tools = options.tools.map((tool) => ({
				...tool,
				// The browser runs the loop; the core runs the tool.
				execute: async (args: Record<string, unknown>) => {
					const outcome = await holder.context!.runTool({ name: tool.name, args });
					return JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error });
				},
			}));
		}
		const session = await api.create(create);
		return new BrowserSession(session, options, holder);
	}
}

class BrowserSession implements ProviderSession {
	constructor(
		private readonly session: LanguageModelSession,
		private readonly options: SessionOptions,
		private readonly holder: { context: TurnContext | null },
	) {}

	async send(message: Message, context: TurnContext): Promise<{ text: string }> {
		this.holder.context = context;
		const files = messageFiles(message)
			.map((file) => ({ file, text: fileText(file) }))
			.filter((f) => f.text !== null)
			.map(({ file, text }) => `<file name="${file.filename ?? "attachment"}">\n${text}\n</file>`);
		const stream = this.session.promptStreaming([messageText(message), ...files].join("\n\n"), {
			signal: context.signal,
			...(this.options.schema ? { responseConstraint: this.options.schema } : {}),
		});
		let text = "";
		const reader = stream.getReader();
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				// Early Chrome versions streamed the whole text so far; later ones stream deltas.
				const delta = text && value.startsWith(text) ? value.slice(text.length) : value;
				text += delta;
				context.text(delta);
			}
		} finally {
			reader.releaseLock();
		}
		return { text };
	}

	close(): void {
		this.session.destroy();
	}
}

/**
 * The browser's built-in model, through the Prompt API (`LanguageModel`, in
 * Chrome with Gemini Nano). Where the browser has none, it is skipped. Its
 * provider id is `"browser"`.
 */
export function promptAPI(options: BrowserAIOptions = {}): BrowserAIProvider {
	return new BrowserAIProvider(options);
}

/** @deprecated The same as {@link promptAPI}, its first name. */
export const browserAI = promptAPI;
