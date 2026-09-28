import "@leuria/connect";

import { type Conversation, connection, type Message, messageText, NoProviderError } from "@leuria/client";
import { defaultClient, esc, icon, insteadLabel, LeuriaElement, mark, setDefaultClient } from "@leuria/connect/element";

import type { Docs } from "./docs.js";
import { renderMarkdown } from "./render.js";
import type { LeuriaSearch } from "./search.js";
import { askStyles } from "./styles.js";

export interface AskOptions {
	/** The panel's title. Default "Ask the docs". */
	title?: string;
	/** Questions offered before the first one. */
	suggestions?: string[];
	/** Replaces the assistant's instructions. */
	system?: string;
	/** Most tool calls per answer. Default 12. */
	maxSteps?: number;
}

type Mode = "tools" | "passages";

let current:
	| {
			docs: Docs;
			options: AskOptions;
			/** One conversation per mode; `shown` is the one on screen. */
			conversations: Partial<Record<Mode, Conversation>>;
			shown?: Conversation;
	  }
	| undefined;

/**
 * The docs every Ask panel, search and button on the page uses. Call it
 * once, when the page creates its `Docs`. The conversation is kept across
 * page changes of a single-page site.
 */
export function setupDocs(docs: Docs, options: AskOptions = {}): void {
	for (const convo of Object.values(current?.conversations ?? {})) convo.close();
	current = { docs, options, conversations: {} };
	if (!defaultClient()) setDefaultClient(docs.ai);
	for (const element of document.querySelectorAll<LeuriaAsk | LeuriaSearch>("leuria-ask, leuria-search")) element.refresh();
}

/** The docs given to `setupDocs`. */
export function pageDocs(): Docs | undefined {
	return current?.docs;
}

/**
 * How the next question is answered. An AI that can use tools searches
 * and reads the docs itself. One that can't (the browser's small model)
 * gets the best passages with the question instead.
 */
function mode(docs: Docs): Mode {
	const { active, providers } = docs.ai.getState();
	return providers.find((p) => p.id === active?.id)?.capabilities.includes("tools") ? "tools" : "passages";
}

function conversationFor(which: Mode): Conversation {
	const { docs, options, conversations } = current!;
	conversations[which] ??= docs.ai.conversation({
		system: options.system ?? systemPrompt(docs.site, which),
		tools: which === "tools" ? docs.tools : undefined,
		maxSteps: options.maxSteps ?? 12,
	});
	return conversations[which];
}

/** The conversation on screen (the one for the current mode until a question is asked). */
function conversation(): Conversation | undefined {
	if (!current) return undefined;
	current.shown ??= conversationFor(mode(current.docs));
	return current.shown;
}

/** The conversation for the next question: when the mode changed, it takes the thread along. */
function conversationToAsk(): Conversation | undefined {
	if (!current) return undefined;
	const shown = conversation()!;
	const next = conversationFor(mode(current.docs));
	if (next !== shown) {
		next.reset(
			shown
				.getState()
				.messages.map((m) => ({ role: m.role, content: messageText(m) }))
				.filter((m) => m.content.trim()),
		);
		current.shown = next;
	}
	return next;
}

function systemPrompt(site: string | undefined, which: Mode): string {
	const docs = site ? `the ${site} documentation` : "this documentation";
	const sources =
		which === "tools"
			? "Answer only from the docs: search them first with search_docs, read the pages you need with read_page, and never invent APIs, options or behaviour."
			: "Each question comes with passages from the docs. Answer only from them, and never invent APIs, options or behaviour.";
	return [
		`You answer questions about ${docs}, for a reader on the site.`,
		`${sources} When the docs don't cover something, say so plainly.`,
		"Link every page you rely on, as a Markdown link with the exact link given, e.g. [Tools](/docs/guides/tools#page-tools).",
		"Be brief: a few sentences, then code only when it is the answer, in a fenced block with its language.",
	].join("\n");
}

/** Passages for an AI that can't search: the best sections for the question, with their links. */
async function passages(docs: Docs, question: string): Promise<string | undefined> {
	const hits = await docs.search(question, { k: 4 });
	if (hits.length === 0) return undefined;
	return hits
		.map((hit) => {
			const text = docs.section(hit.id)?.text ?? hit.snippet;
			return `[${hit.heading ? `${hit.title}: ${hit.heading}` : hit.title}](${hit.href})\n${text.slice(0, 900)}`;
		})
		.join("\n\n---\n\n");
}

/** Open the Ask panel (made once, at the end of the page), optionally with a question. */
export function openAsk(question?: string): void {
	const panel = document.querySelector("leuria-ask") ?? document.body.appendChild(document.createElement("leuria-ask"));
	panel.show(question);
}

const TOOL_WORDS: Record<string, string> = {
	search_docs: "Searched the docs",
	read_page: "Read a page",
	list_pages: "Looked at the list of pages",
};

/**
 * `<leuria-ask>`: the Ask panel. Answers from the site's docs, with the
 * reader's own AI, and links to the pages it used. One per page, made by
 * `openAsk()`; `<leuria-ask-button>` opens it.
 */
export class LeuriaAsk extends LeuriaElement {
	static styles = askStyles;
	static observedAttributes = ["appearance"];

	private readonly panel: HTMLElement;
	private readonly thread: HTMLElement;
	private readonly input: HTMLTextAreaElement;
	private readonly send: HTMLButtonElement;
	private readonly connectRow: HTMLElement;
	private readonly selectionChip: HTMLElement;
	private selection?: string;
	/** Looking for passages before asking an AI that can't search. */
	private searching = false;
	private stopConversation?: () => void;
	private stopDocs?: () => void;
	private bound?: Conversation;

	constructor() {
		super();
		this.shadow.innerHTML += `
			<div class="root ask-root">
				<aside class="ask" popover="manual" aria-labelledby="ask-title">
					<header class="ask-head">
						<div class="ask-title-row">
							${mark(22)}
							<h2 class="ask-title" id="ask-title"></h2>
							<button class="icon-btn" type="button" data-action="reset" aria-label="New conversation" title="New conversation">${plusIcon}</button>
							<button class="icon-btn" type="button" data-action="close" aria-label="Close">${icon("x", 18)}</button>
						</div>
						<leuria-ai-status></leuria-ai-status>
					</header>
					<div class="ask-thread" aria-live="polite"></div>
					<div class="ask-connect" hidden>
						<p></p>
						<leuria-connect-button size="1" hide-byline></leuria-connect-button>
						<div class="instead" hidden></div>
					</div>
					<form class="ask-composer">
						<div class="ask-selection" hidden>
							<span class="ask-selection-text"></span>
							<button type="button" class="chip-x" data-action="drop-selection" aria-label="Don't ask about the selected text">${icon("x", 14)}</button>
						</div>
						<div class="ask-input-row">
							<textarea rows="1" aria-label="Your question" placeholder="Ask a question…"></textarea>
							<button class="send" type="submit" aria-label="Ask">${sendIcon}</button>
						</div>
					</form>
					<p class="ask-foot">Answered by your own AI, from these docs.</p>
				</aside>
			</div>`;
		this.panel = this.shadow.querySelector(".ask")!;
		this.thread = this.shadow.querySelector(".ask-thread")!;
		this.input = this.shadow.querySelector("textarea")!;
		this.send = this.shadow.querySelector(".send")!;
		this.connectRow = this.shadow.querySelector(".ask-connect")!;
		this.selectionChip = this.shadow.querySelector(".ask-selection")!;

		this.shadow.querySelector("form")!.addEventListener("submit", (event) => {
			event.preventDefault();
			if (conversation()?.getState().status === "running") conversation()?.stop();
			else this.ask(this.input.value);
		});
		this.input.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
				event.preventDefault();
				this.ask(this.input.value);
			}
		});
		this.input.addEventListener("input", () => this.fitInput());
		this.panel.addEventListener("keydown", (event) => {
			if (event.key === "Escape") this.hide();
		});
		this.shadow.addEventListener("click", (event) => this.onClick(event));
	}

	/** Open the panel, with the text the reader selected on the page, and ask `question` if given. */
	show(question?: string): void {
		const selected = pageSelection(this);
		if (selected) this.setSelection(selected);
		if (!this.isOpen()) {
			this.panel.showPopover?.();
			this.panel.classList.add("open");
		}
		this.update();
		if (question) this.ask(question);
		else this.input.focus();
	}

	hide(): void {
		if (!this.isOpen()) return;
		if (this.panel.matches?.("[popover]") && this.panel.hidePopover) this.panel.hidePopover();
		this.panel.classList.remove("open");
	}

	/** Open: the class shows it (and stands in where there are no popovers, as in test DOMs). */
	isOpen(): boolean {
		return this.panel.classList.contains("open");
	}

	/** Follow the docs given to `setupDocs` again. */
	refresh(): void {
		this.bind();
	}

	protected watch(): () => void {
		this.stopDocs?.();
		this.stopDocs = current?.docs.subscribe(() => this.update());
		this.bindConversation();
		return () => {
			this.stopDocs?.();
			this.stopConversation?.();
			this.bound = undefined;
		};
	}

	private bindConversation(): void {
		const convo = current ? conversation() : undefined;
		if (convo === this.bound) return;
		this.stopConversation?.();
		this.bound = convo;
		this.stopConversation = convo?.subscribe(() => this.update());
	}

	private ask(text: string): void {
		const question = text.trim();
		if (!question || !current || conversation()?.getState().status === "running") return;
		const docs = current.docs;
		const page = docs.currentPage();
		const selection = this.selection;
		this.input.value = "";
		this.fitInput();
		this.setSelection(undefined);
		const convo = conversationToAsk()!;
		this.bindConversation();
		const context: Record<string, string | undefined> = {
			"Page open on screen": page ? `${page.title} (${page.url})` : typeof location === "undefined" ? undefined : location.pathname,
			"Text the reader selected on the page": selection,
			"Docs version": docs.version(),
		};
		const send = () => void convo.send(question, { context }).result().catch(() => undefined);
		if (current.conversations.tools === convo) {
			send();
			return;
		}
		this.searching = true;
		this.update();
		passages(docs, question)
			.catch(() => undefined)
			.then((found) => {
				this.searching = false;
				context["Passages from the docs"] = found ?? "None matched this question.";
				send();
			});
	}

	private setSelection(text: string | undefined): void {
		this.selection = text;
		this.selectionChip.hidden = !text;
		this.shadow.querySelector(".ask-selection-text")!.textContent = text ? `About: “${text.length > 80 ? `${text.slice(0, 80)}…` : text}”` : "";
	}

	private fitInput(): void {
		this.input.style.height = "auto";
		this.input.style.height = `${Math.min(this.input.scrollHeight, 160)}px`;
	}

	private onClick(event: Event): void {
		const target = event.target as Element;
		const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
		if (action === "close") this.hide();
		else if (action === "reset") conversation()?.reset();
		else if (action === "drop-selection") this.setSelection(undefined);
		else if (action === "instead" && this.client) {
			const id = target.closest<HTMLElement>("[data-provider]")?.dataset.provider;
			if (id) connection(this.client).chooseInstead(id);
		}
		else if (action === "suggest") this.ask(target.closest<HTMLElement>("[data-action]")!.textContent ?? "");

		const link = target.closest<HTMLAnchorElement>("a[data-internal]");
		if (link && current && !(event as MouseEvent).metaKey && !(event as MouseEvent).ctrlKey) {
			event.preventDefault();
			current.docs.open(link.getAttribute("href")!);
			if (matchMedia("(max-width: 640px)").matches) this.hide();
		}
	}

	protected update(): void {
		this.bindConversation();
		const title = current?.options.title ?? "Ask the docs";
		this.shadow.querySelector(".ask-title")!.textContent = title;
		const state = this.bound?.getState();
		const running = state?.status === "running";
		this.send.innerHTML = running ? stopIcon : sendIcon;
		this.send.setAttribute("aria-label", running ? "Stop" : "Ask");
		this.send.classList.toggle("stop", running);

		const ai = this.client?.getState();
		const noAI = !ai?.active || state?.error instanceof NoProviderError;
		this.connectRow.hidden = !(ai?.pending || (noAI && ai));
		this.connectRow.classList.toggle("compact", !noAI);
		this.connectRow.querySelector("p")!.textContent = noAI
			? "Connect your own AI to ask the docs. Leuria asks you first, and this site never sees your AI's keys."
			: "For better answers, use your own AI.";
		// Secondary, small: another AI for this page, if the visitor prefers.
		const alternatives = noAI ? (ai?.alternatives ?? []) : [];
		const instead = this.connectRow.querySelector<HTMLElement>(".instead")!;
		instead.hidden = alternatives.length === 0;
		instead.innerHTML = alternatives
			.map((p) => `<button class="link" type="button" data-action="instead" data-provider="${esc(p.id)}">${esc(insteadLabel(p))}</button>`)
			.join(`<span aria-hidden="true">·</span>`);
		if (alternatives.length) instead.insertAdjacentHTML("afterbegin", "<span>Or, for now:</span> ");

		const atBottom = this.thread.scrollHeight - this.thread.scrollTop - this.thread.clientHeight < 48;
		this.thread.innerHTML = this.renderThread(state?.messages ?? [], state);
		if (atBottom) this.thread.scrollTop = this.thread.scrollHeight;
	}

	private renderThread(messages: Message[], state: ReturnType<Conversation["getState"]> | undefined): string {
		if (messages.length === 0 && !this.searching) {
			const suggestions = current?.options.suggestions ?? [];
			const site = current?.docs.site;
			return `<div class="ask-empty">
				<p>Ask anything about ${esc(site ?? "these docs")}. Answers come from these pages, with links to them.</p>
				${suggestions.length ? `<div class="ask-suggestions">${suggestions.map((s) => `<button type="button" class="suggestion" data-action="suggest">${esc(s)}</button>`).join("")}</div>` : ""}
			</div>`;
		}
		const html = messages.map((message) => this.renderMessage(message)).join("");
		const last = messages.at(-1);
		const answering = last?.role === "assistant" && last.parts.some((p) => p.type === "text" && p.text.trim());
		let tail = "";
		if (this.searching) {
			tail = `<div class="ask-wait"><span class="spinner" aria-hidden="true"></span>Reading the docs…</div>`;
		} else if (state?.status === "running" && !answering) {
			const tool = last?.role === "assistant" && last.parts.some((p) => p.type === "tool-call" && p.state === "running");
			const words = state.session === "starting" ? "Starting your AI…" : tool ? "Reading the docs…" : "Thinking…";
			tail = `<div class="ask-wait"><span class="spinner" aria-hidden="true"></span>${words}</div>`;
		} else if (state?.status === "error") {
			tail = `<div class="ask-error">${
				state.error instanceof NoProviderError ? "No AI can answer yet. Connect yours below." : "Your AI couldn't answer this time. Try again."
			}</div>`;
		}
		return html + tail;
	}

	private renderMessage(message: Message): string {
		if (message.role === "user") {
			const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
			return `<div class="bubble me">${esc(text)}</div>`;
		}
		const tools = message.parts.filter((p) => p.type === "tool-call");
		const words = [...new Set(tools.map((p) => TOOL_WORDS[p.name] ?? "Checked the docs"))];
		const read = tools
			.filter((p) => p.name === "read_page" && p.state === "done")
			.map((p) => current?.docs.page(String(p.args.url ?? "")))
			.filter((page) => page !== undefined);
		const toolLine = words.length
			? `<div class="tool-line">${esc(words.join(" · "))}${read.length ? `: ${read.map((page) => `<a href="${esc(page.url)}" data-internal="">${esc(page.title)}</a>`).join(", ")}` : ""}</div>`
			: "";
		const text = message.parts
			.filter((p) => p.type === "text")
			.map((p) => p.text)
			.join("");
		return `${toolLine}${text.trim() ? `<div class="bubble ai">${renderMarkdown(text)}</div>` : ""}`;
	}
}

/**
 * `<leuria-ask-button>`: opens the Ask panel. In a navigation bar, or
 * `floating` at the bottom right of the page. Attribute: `label`
 * (default "Ask AI").
 */
export class LeuriaAskButton extends LeuriaElement {
	static styles = askStyles;
	static observedAttributes = ["label", "floating", "appearance"];

	private readonly button: HTMLButtonElement;

	constructor() {
		super();
		this.shadow.innerHTML += `<div class="root"><button class="ask-button" type="button" part="button"></button></div>`;
		this.button = this.shadow.querySelector("button")!;
		// Keep the page's selection: it goes with the question.
		this.button.addEventListener("mousedown", (event) => event.preventDefault());
		this.button.addEventListener("click", () => openAsk());
	}

	protected update(): void {
		this.button.classList.toggle("floating", this.hasAttribute("floating"));
		this.button.innerHTML = `${sparkIcon}<span>${esc(this.getAttribute("label") ?? "Ask AI")}</span>`;
	}
}

/** The text the reader selected on the page (not in the panel), if short enough to ask about. */
function pageSelection(panel: Element): string | undefined {
	const selection = typeof getSelection === "undefined" ? null : getSelection();
	const text = selection?.toString().trim();
	if (!text || text.length > 2000) return undefined;
	if (selection?.anchorNode && panel.contains(selection.anchorNode)) return undefined;
	return text;
}

/* Heroicons outline 24 (MIT), at Pearl's 1.75 stroke. */
const svg = (d: string, size = 18) =>
	`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const plusIcon = svg("M12 4.5v15m7.5-7.5h-15");
const sendIcon = svg("M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18");
const stopIcon = `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect width="14" height="14" rx="3" fill="currentColor"/></svg>`;
const sparkIcon = svg(
	"M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z",
	16,
);

declare global {
	interface HTMLElementTagNameMap {
		"leuria-ask": LeuriaAsk;
		"leuria-ask-button": LeuriaAskButton;
	}
}
