import { BaseProvider } from "../src/providers/base.js";
import type { Capability, Locality, Message, ProviderSession, ProviderState, SessionOptions, TurnContext } from "../src/types.js";

export type Script = (input: { message: Message; context: TurnContext; options: SessionOptions; turn: number }) => Promise<string> | string;

/** A provider whose turns are scripted by the test. */
export class ScriptedProvider extends BaseProvider {
	sessions: SessionOptions[] = [];
	closed = 0;

	constructor(
		id: string,
		private readonly script: Script,
		options: { capabilities?: Capability[]; status?: ProviderState["status"]; locality?: Locality } = {},
	) {
		super(id, `Provider ${id}`, options.locality ?? "device", {
			status: options.status ?? "ready",
			capabilities: options.capabilities ?? ["chat", "tools"],
		});
	}

	set(patch: Partial<ProviderState>): void {
		this.setState(patch);
	}

	async detect(): Promise<void> {}

	async createSession(options: SessionOptions): Promise<ProviderSession> {
		this.sessions.push(options);
		let turn = 0;
		return {
			send: async (message, context) => ({ text: await this.script({ message, context, options, turn: turn++ }) }),
			close: () => {
				this.closed++;
			},
		};
	}
}

export function sse(chunks: unknown[]): Response {
	const body = `${chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;
	return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}
