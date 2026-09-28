import { type Connection, type ConnectionState, connection, type Leuria } from "@leuria/client";

import { LeuriaElement } from "./element.js";
import { esc, icon, mark, statusMark } from "./icons.js";

/** How an alternative is offered: in the visitor's words, never a provider's name. */
export function insteadLabel(provider: { id: string; locality: string; label: string; status: string; action?: string }): string {
	if (provider.id === "browser") return provider.status === "ready" ? "use this browser's AI" : "use this browser's AI (a one-time download)";
	if (provider.locality === "site") return "use this site's AI";
	return `use ${provider.label}`;
}

/** Where visitors get Leuria. */
export const DOWNLOAD_URL = "https://leuria.eu";

const CHECKING: ConnectionState = { status: "checking", alternatives: [] };

/**
 * `<leuria-connect-button>`: "Connect your AI", one per page. Reports where
 * the visitor is (looking, waiting for their approval, connected, not
 * connected), opens Leuria's approval window, explains how to get Leuria
 * when it isn't running, and offers to disconnect once connected.
 *
 * Attributes: `size` (1: 36px, for navigation bars; 2: 48px; 3: 56px),
 * `hide-byline`, `appearance` (`light`, `dark`; the system by default).
 * Event: `leuria-disconnect`, after the visitor disconnects the site.
 */
export class LeuriaConnectButton extends LeuriaElement {
	static observedAttributes = ["size", "hide-byline", "appearance"];

	private flow?: Connection;
	private readonly button: HTMLButtonElement;
	private readonly menu: HTMLDivElement;
	private readonly dialog: HTMLDialogElement;
	private readonly download: HTMLAnchorElement;
	private readonly instead: HTMLDivElement;
	/** The status last drawn, to open the dialog when a connect finds no Leuria. */
	private last?: string;

	constructor() {
		super();
		this.shadow.innerHTML += `
			<div class="root" part="root">
				<button class="connect" type="button" part="button" aria-live="polite"></button>
				<div class="menu" popover role="menu" aria-label="Your AI on this site">
					<div class="menu-head">
						${statusMark(28, "live")}
						<div><div class="menu-title"></div><div class="menu-desc">This site answers with your own AI.</div></div>
					</div>
					<div class="sep"></div>
					<button class="item" type="button" role="menuitem" data-action="manage">Change AI or model…</button>
					<button class="item item-danger" type="button" role="menuitem" data-action="disconnect">Disconnect this site</button>
					<div class="menu-foot" aria-hidden="true">by <span class="wordmark">leuria</span></div>
				</div>
				<dialog class="dialog" aria-labelledby="get-title" aria-describedby="get-desc">
					<div class="dialog-body">
						${mark(32)}
						<h2 class="dialog-title" id="get-title">Use the AI you already have</h2>
						<p class="dialog-desc" id="get-desc">Leuria lets this site answer with your own AI. It asks you first, and the site can't see your files.</p>
						<ol class="steps">
							<li>Download Leuria and open it.</li>
							<li>Choose the AI you want to use.</li>
							<li>Come back here and connect.</li>
						</ol>
						<p class="dialog-note">Already have Leuria? Open it, then try again.</p>
						<div class="actions">
							<button class="btn btn-ghost" type="button" data-action="connect">Try again</button>
							<a class="btn btn-ink download" target="_blank" rel="noopener">Download Leuria</a>
						</div>
						<div class="instead" hidden></div>
						<button class="close" type="button" aria-label="Close" data-action="close">${icon("x", 18)}</button>
					</div>
				</dialog>
			</div>`;
		this.button = this.shadow.querySelector(".connect")!;
		this.menu = this.shadow.querySelector(".menu")!;
		this.dialog = this.shadow.querySelector(".dialog")!;
		this.download = this.shadow.querySelector(".download")!;
		this.download.href = DOWNLOAD_URL;
		this.instead = this.shadow.querySelector(".instead")!;

		this.button.addEventListener("click", () => this.onClick());
		this.menu.addEventListener("toggle", (event) => {
			const open = (event as ToggleEvent).newState === "open";
			this.button.setAttribute("aria-expanded", String(open));
			if (open) this.menu.querySelector<HTMLElement>("[role=menuitem]")?.focus();
		});
		this.shadow.addEventListener("click", (event) => {
			const action = (event.target as Element).closest<HTMLElement>("[data-action]")?.dataset.action;
			if (action === "manage") {
				this.menu.hidePopover?.();
				this.flow?.manage();
			} else if (action === "disconnect") {
				this.menu.hidePopover?.();
				this.flow?.disconnect();
				this.dispatchEvent(new CustomEvent("leuria-disconnect", { bubbles: true, composed: true }));
			} else if (action === "close") {
				this.dialog.close();
			} else if (action === "connect") {
				this.flow?.connect();
				this.dialog.close();
			} else if (action === "instead") {
				const id = (event.target as Element).closest<HTMLElement>("[data-provider]")?.dataset.provider;
				if (id) this.flow?.chooseInstead(id);
				this.dialog.close();
			}
		});
		// A click on the backdrop closes the dialog (the body covers the dialog itself).
		this.dialog.addEventListener("click", (event) => {
			if (event.target === this.dialog) this.dialog.close();
		});
	}

	protected watch(client: Leuria): () => void {
		this.flow = connection(client);
		const stop = this.flow.subscribe(() => this.update());
		return () => {
			stop();
			this.flow = undefined;
		};
	}


	private onClick(): void {
		const { status } = this.flow?.getState() ?? CHECKING;
		if (status === "connected") this.toggleMenu();
		else if (status === "not-running") this.dialog.showModal();
		else if (status === "not-connected" || status === "declined") this.flow?.connect();
	}

	private menuOpen(): boolean {
		try {
			return this.menu.matches(":popover-open");
		} catch {
			return false; // A browser without popovers.
		}
	}

	private toggleMenu(): void {
		if (this.menuOpen()) {
			this.menu.hidePopover?.();
			return;
		}
		const rect = this.button.getBoundingClientRect();
		this.menu.style.top = `${rect.bottom + 8}px`;
		this.menu.style.right = `${Math.max(16, window.innerWidth - rect.right)}px`;
		this.menu.showPopover();
	}

	protected update(): void {
		const { status, model } = this.flow?.getState() ?? CHECKING;
		const size = this.getAttribute("size") === "3" ? 3 : this.getAttribute("size") === "1" ? 1 : 2;
		const set = (state: string, html: string) => {
			this.button.className = `connect ${state} s${size}`;
			this.button.innerHTML = html;
		};
		const markSize = size === 3 ? 26 : size === 1 ? 18 : 22;
		const label = (text: string) => `<span class="label">${esc(text)}</span>`;
		const by = (text: string) => `<span class="by">${esc(text)}</span>`;

		this.button.toggleAttribute("aria-busy", status === "checking" || status === "connecting");
		if (status === "connected") {
			this.button.setAttribute("aria-haspopup", "menu");
			this.button.setAttribute("aria-expanded", String(this.menuOpen()));
		} else {
			this.button.removeAttribute("aria-haspopup");
			this.button.removeAttribute("aria-expanded");
			if (this.menuOpen()) this.menu.hidePopover?.();
		}

		if (status === "connected") {
			set(
				"connected",
				`${statusMark(markSize, "live")}${label("Connected")}${by(model ?? "Your AI")}<span class="chevron">${icon("chevron-down", 16)}</span>`,
			);
			this.menu.querySelector(".menu-title")!.textContent = model ? `Connected to ${model}` : "Connected to your AI";
			this.menu.querySelector<HTMLElement>("[data-action=manage]")!.hidden = !this.flow?.canManage;
		} else if (status === "checking" || status === "connecting") {
			const waiting = status === "connecting";
			set(waiting ? "pending" : "checking", `<span class="spinner" aria-hidden="true"></span>${label(waiting ? "Waiting for your approval…" : "Looking for your AI…")}`);
		} else if (status === "declined") {
			set("declined", `${statusMark(markSize, "blocked")}${label("Not connected")}${by("Try again")}`);
		} else {
			set("idle", `${mark(markSize)}${label("Connect your AI")}${this.hasAttribute("hide-byline") ? "" : by("by leuria")}`);
		}

		// Secondary, small: what could answer instead, for this page, if the visitor prefers.
		const alternatives = this.flow?.getState().alternatives ?? [];
		this.instead.hidden = alternatives.length === 0;
		this.instead.innerHTML = alternatives.length
			? `<span>Or, for now:</span> ${alternatives
					.map((p) => `<button class="link" type="button" data-action="instead" data-provider="${esc(p.id)}">${esc(insteadLabel(p))}</button>`)
					.join(`<span aria-hidden="true">·</span>`)}`
			: "";
		// A connect that got no answer from Leuria: explain how to get it.
		if (this.last === "connecting" && status === "not-running" && !this.dialog.open) this.dialog.showModal?.();
		if ((status === "connected" || status === "connecting") && this.dialog.open) this.dialog.close();
		this.last = status;
	}
}
