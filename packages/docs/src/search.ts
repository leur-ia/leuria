import "@leuria/connect";
import type { Leuria } from "@leuria/client";
import { esc, LeuriaElement } from "@leuria/connect/element";

import { openAsk, pageDocs } from "./ask.js";
import { type DocsHit, STOPWORDS } from "./docs.js";
import { searchStyles } from "./styles.js";

/** Open the search dialog (made once, at the end of the page), optionally with a query. */
export function openSearch(query?: string): void {
	const dialog = document.querySelector("leuria-search") ?? document.body.appendChild(document.createElement("leuria-search"));
	dialog.show(query);
}

let shortcut = false;

/** ⌘K / Ctrl+K opens the search, once a search button is on the page. */
function listenForShortcut(): void {
	if (shortcut || typeof document === "undefined") return;
	shortcut = true;
	document.addEventListener("keydown", (event) => {
		if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
			event.preventDefault();
			openSearch();
		}
	});
}

/**
 * `<leuria-search>`: the search dialog. Finds by words at once, and by
 * meaning once the reader has an embedding model (their own, or a small
 * one in the page); offers to ask the question instead. One per page,
 * made by `openSearch()`.
 */
export class LeuriaSearch extends LeuriaElement {
	static styles = searchStyles;
	static observedAttributes = ["appearance"];

	private readonly dialog: HTMLDialogElement;
	private readonly input: HTMLInputElement;
	private readonly body: HTMLElement;
	private readonly status: HTMLElement;
	private readonly connectRow: HTMLElement;
	private hits: DocsHit[] = [];
	private active = 0;
	private token = 0;
	private stopDocs?: () => void;
	private stopIndex?: () => void;

	constructor() {
		super();
		this.shadow.innerHTML += `
			<div class="root search-root">
				<dialog class="search" aria-label="Search the docs">
					<div class="search-field">
						${searchIcon}
						<input type="search" placeholder="Search the docs" aria-label="Search the docs" autocomplete="off" spellcheck="false"
							role="combobox" aria-expanded="true" aria-controls="results" aria-autocomplete="list">
						<kbd>esc</kbd>
					</div>
					<div class="search-body" id="results" role="listbox"></div>
					<footer class="search-foot">
						<span class="search-status" aria-live="polite"></span>
						<div class="search-connect" hidden>
							<p>For better results, use your own AI.</p>
							<leuria-connect-button size="1" hide-byline></leuria-connect-button>
						</div>
					</footer>
				</dialog>
			</div>`;
		this.dialog = this.shadow.querySelector("dialog")!;
		this.input = this.shadow.querySelector("input")!;
		this.body = this.shadow.querySelector(".search-body")!;
		this.status = this.shadow.querySelector(".search-status")!;
		this.connectRow = this.shadow.querySelector(".search-connect")!;

		this.input.addEventListener("input", () => this.run());
		this.input.addEventListener("keydown", (event) => this.onKey(event));
		this.dialog.addEventListener("click", (event) => {
			if (event.target === this.dialog) this.hide();
		});
		this.shadow.addEventListener("click", (event) => {
			const target = (event.target as Element).closest<HTMLElement>("[data-index], [data-action]");
			if (!target) return;
			if (target.dataset.action === "meaning") {
				void this.client?.connect(target.dataset.provider).catch(() => undefined);
				return;
			}
			if ((event as MouseEvent).metaKey || (event as MouseEvent).ctrlKey) return;
			event.preventDefault();
			this.choose(Number(target.dataset.index));
		});
	}

	show(query?: string): void {
		if (!this.dialog.open) this.dialog.showModal();
		void pageDocs()?.load();
		if (query !== undefined) this.input.value = query;
		this.input.focus();
		this.input.select();
		this.run();
	}

	hide(): void {
		this.dialog.close();
	}

	refresh(): void {
		this.bind();
	}

	protected watch(client: Leuria): () => void {
		this.stopDocs?.();
		// The reader's own AI turning up (or connecting) shows or hides the invitation.
		const stopClient = client.subscribe(() => this.update());
		const docs = pageDocs();
		this.stopDocs = docs?.subscribe(() => {
			this.followIndex();
			this.update();
		});
		this.followIndex();
		return () => {
			stopClient();
			this.stopDocs?.();
			this.stopIndex?.();
		};
	}

	private followIndex(): void {
		this.stopIndex?.();
		const index = pageDocs()?.index;
		this.stopIndex = index?.subscribe(() => {
			const wasReady = this.lastStatus === "ready";
			this.update();
			// Search by meaning just became ready: search again with it.
			if (!wasReady && this.lastStatus === "ready" && this.input.value.trim()) this.run();
		});
	}

	private lastStatus?: string;

	/** Words at once, then words and meaning; only the latest query lands. */
	private async run(): Promise<void> {
		const docs = pageDocs();
		const query = this.input.value.trim();
		const token = ++this.token;
		if (!docs || !query) {
			this.hits = [];
			this.active = 0;
			this.renderBody(query);
			return;
		}
		const words = await docs.search(query, { by: "words" });
		if (token !== this.token) return;
		this.hits = words;
		this.active = Math.min(this.active, this.hits.length);
		this.renderBody(query);
		if (docs.meaningState()?.status !== "ready") return;
		const both = await docs.search(query);
		if (token !== this.token) return;
		this.hits = both;
		this.renderBody(query);
	}

	private onKey(event: KeyboardEvent): void {
		const count = this.input.value.trim() ? this.hits.length + 1 : 0;
		if (event.key === "ArrowDown" && count) {
			event.preventDefault();
			this.active = (this.active + 1) % count;
			this.markActive();
		} else if (event.key === "ArrowUp" && count) {
			event.preventDefault();
			this.active = (this.active - 1 + count) % count;
			this.markActive();
		} else if (event.key === "Enter" && count) {
			event.preventDefault();
			this.choose(this.active);
		}
	}

	/** 0 asks the question; 1… opens a hit. */
	private choose(index: number): void {
		const query = this.input.value.trim();
		if (index === 0) {
			if (!query) return;
			this.hide();
			openAsk(query);
			return;
		}
		const hit = this.hits[index - 1];
		if (!hit) return;
		this.hide();
		pageDocs()?.open(hit.href);
	}

	private markActive(): void {
		for (const option of this.body.querySelectorAll<HTMLElement>("[data-index]")) {
			const on = Number(option.dataset.index) === this.active;
			option.setAttribute("aria-selected", String(on));
			if (on) option.scrollIntoView({ block: "nearest" });
		}
	}

	private renderBody(query: string): void {
		if (!query) {
			this.body.innerHTML = `<p class="search-empty">Search by words and by meaning: “make the answer a JSON object” finds structured output.</p>`;
			return;
		}
		const words = query
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 2 && !STOPWORDS.has(w));
		const hits = this.hits
			.map(
				(hit, i) => `<a class="hit" href="${esc(hit.href)}" role="option" data-index="${i + 1}">
					<span class="hit-title">${esc(hit.title)}${hit.heading ? `<span class="hit-sep">›</span>${esc(hit.heading)}` : ""}</span>
					<span class="hit-snippet">${highlight(hit.snippet, words)}</span>
					${hit.via === "meaning" ? `<span class="hit-via">By meaning</span>` : ""}
				</a>`,
			)
			.join("");
		this.body.innerHTML = `
			<a class="hit ask-row" href="#" role="option" data-index="0">${sparkIcon}<span>Ask AI: <strong>${esc(query)}</strong></span></a>
			${hits || `<p class="search-empty">No page matches these words.</p>`}`;
		this.markActive();
	}

	protected update(): void {
		const state = pageDocs()?.meaningState();
		this.lastStatus = state?.status;
		// Every embedder a click would turn on: the reader's own AI, a model in the page.
		const offers = (this.client?.getState().providers ?? []).filter((p) => p.offers.includes("embed") && p.status === "needs-action");
		let html = "";
		if (!state) html = "Searching by words.";
		else if (state.status === "ready") html = `<span class="dot tone-live" aria-hidden="true"></span>Searching by words and by meaning.`;
		else if (state.status === "indexing")
			html = `<span class="spinner" aria-hidden="true"></span>Getting search by meaning ready… ${state.total ? Math.round((state.done / state.total) * 100) : 0}%`;
		else if (offers.length)
			html = `Searching by words. Also search by meaning: ${offers
				.map(
					(p) =>
						`<button type="button" class="link" data-action="meaning" data-provider="${esc(p.id)}">${
							p.action === "download" ? "with a model in this page (one download, about 40 MB)" : "with your own AI"
						}</button>`,
				)
				.join(" or ")}`;
		else html = "Searching by words.";
		this.status.innerHTML = html;
		// Meaning comes from a model in the page while the reader's own AI waits for a click: invite them, as the Ask panel does.
		const searching = state?.status === "indexing" || state?.status === "ready";
		this.connectRow.hidden = !(searching && this.client?.getState().embedPending);
	}
}

/**
 * `<leuria-search-button>`: opens the search, like a search field. ⌘K
 * (Ctrl+K) opens it too. Attribute: `label` (default "Search").
 */
export class LeuriaSearchButton extends LeuriaElement {
	static styles = searchStyles;
	static observedAttributes = ["label", "appearance"];

	private readonly button: HTMLButtonElement;

	constructor() {
		super();
		this.shadow.innerHTML += `<div class="root"><button class="search-button" type="button" part="button"></button></div>`;
		this.button = this.shadow.querySelector("button")!;
		this.button.addEventListener("click", () => openSearch());
	}

	connectedCallback(): void {
		super.connectedCallback();
		listenForShortcut();
	}

	protected update(): void {
		const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
		this.button.innerHTML = `${searchIcon}<span class="search-label">${esc(this.getAttribute("label") ?? "Search")}</span><kbd>${mac ? "⌘" : "Ctrl "}K</kbd>`;
	}
}

/** Escaped text with the query's words marked. */
function highlight(text: string, words: string[]): string {
	const escaped = esc(text);
	if (words.length === 0) return escaped;
	const pattern = new RegExp(`(${words.map((w) => esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
	return escaped.replace(pattern, "<mark>$1</mark>");
}

const searchIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>`;
const sparkIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z"/></svg>`;

declare global {
	interface HTMLElementTagNameMap {
		"leuria-search": LeuriaSearch;
		"leuria-search-button": LeuriaSearchButton;
	}
}
