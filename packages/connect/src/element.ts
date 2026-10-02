import type { Leuria } from "@leuria/client";

import { defaultClient, onDefaultClient } from "./client.js";
import { loadFonts } from "./fonts.js";
import { styles } from "./styles.js";
import { tokens } from "./tokens.js";

// Importing on a server (SSR) must not fail: elements are only defined in browsers.
const Base = (typeof HTMLElement === "undefined" ? class {} : HTMLElement) as typeof HTMLElement;

/** Every element on the page, to follow `setDefaultAppearance`. */
const live = new Set<LeuriaElement>();
let appearance: "light" | "dark" | undefined;

/**
 * The appearance of every element that has no `appearance` attribute of
 * its own: `light`, `dark`, or `undefined` to follow the system. For pages
 * with their own light/dark switch (a docs site's theme toggle).
 */
export function setDefaultAppearance(value: "light" | "dark" | undefined): void {
	appearance = value;
	for (const element of live) element.applyAppearance();
}

/** One sheet per set of extra styles, shared by every element that uses it. */
const sheets = new Map<string, CSSStyleSheet>();

function adoptStyles(root: ShadowRoot, extra: string): void {
	let sheet = sheets.get(extra);
	if (!sheet) {
		sheet = new CSSStyleSheet();
		sheet.replaceSync(`${tokens}\n${styles}\n${extra}`);
		sheets.set(extra, sheet);
	}
	root.adoptedStyleSheets = [sheet];
}

/**
 * A Leuria element: Pearl's tokens and styles in its own shadow root (the
 * host page's CSS neither reaches it nor is changed by it), and the page's
 * Leuria client (`element.client`, or the one given to `setDefaultClient`).
 */
export abstract class LeuriaElement extends Base {
	/** Styles an element adds to Pearl's tokens and the Connect UI's styles. */
	static styles = "";

	protected readonly shadow: ShadowRoot;
	private own?: Leuria;
	private stop?: () => void;

	constructor() {
		super();
		this.shadow = this.attachShadow({ mode: "open" });
		adoptStyles(this.shadow, (this.constructor as typeof LeuriaElement).styles);
	}

	/** The Leuria client this element follows. */
	get client(): Leuria | undefined {
		return this.own ?? defaultClient();
	}

	set client(value: Leuria | undefined) {
		this.own = value;
		if (this.isConnected) this.bind();
	}

	connectedCallback(): void {
		// A value set before the element was defined shadows the accessor: move it.
		if (Object.prototype.hasOwnProperty.call(this, "client")) {
			const value = (this as { client?: Leuria }).client;
			delete (this as { client?: Leuria }).client;
			this.own = value;
		}
		loadFonts();
		live.add(this);
		this.applyAppearance();
		this.bind();
	}

	disconnectedCallback(): void {
		live.delete(this);
		this.stop?.();
		this.stop = undefined;
	}

	/** Reflect the page's default appearance, unless the element has its own. */
	applyAppearance(): void {
		const own = this.hasAttribute("appearance") && this.dataset.leuriaAppearance !== "default";
		if (own) return;
		if (appearance) {
			this.dataset.leuriaAppearance = "default";
			this.setAttribute("appearance", appearance);
		} else if (this.dataset.leuriaAppearance === "default") {
			delete this.dataset.leuriaAppearance;
			this.removeAttribute("appearance");
		}
	}

	attributeChangedCallback(): void {
		if (this.isConnected) this.update();
	}

	/** Follow the current client again (it, or what to follow in it, changed). */
	protected bind(): void {
		this.stop?.();
		const client = this.client;
		const stops = [client ? this.watch(client) : () => undefined];
		if (!this.own) stops.push(onDefaultClient(() => this.bind()));
		this.stop = () => {
			for (const stop of stops) stop();
		};
		this.update();
	}

	/** Follow the client; returns how to stop. */
	protected watch(_client: Leuria): () => void {
		return () => undefined;
	}

	/** Bring the shadow DOM up to date. */
	protected abstract update(): void;
}
