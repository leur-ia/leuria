import type { Leuria, ProviderSnapshot } from "@leuria/client";

import { LeuriaElement } from "./element.js";
import { limitedHere } from "./connect-button.js";
import { statusMark } from "./icons.js";

const NAMES: Record<string, string> = { bridge: "Your AI", browser: "This browser's AI", server: "This site's AI" };

/**
 * `<leuria-ai-status>`: which AI answers on this page right now, as a dot
 * and words ("Your AI · Codex", "This browser's AI", "No AI yet").
 *
 * Attribute: `appearance`. Property: `labels`, names by provider id that
 * replace the defaults.
 */
export class LeuriaAIStatus extends LeuriaElement {
	static observedAttributes = ["appearance"];

	private names: Record<string, string> = {};
	private readonly pill: HTMLSpanElement;

	constructor() {
		super();
		this.shadow.innerHTML += `<div class="root" part="root"><span class="status tone-idle" part="status" role="status" aria-live="polite"></span></div>`;
		this.pill = this.shadow.querySelector(".status")!;
	}

	get labels(): Record<string, string> {
		return this.names;
	}

	set labels(value: Record<string, string> | undefined) {
		this.names = value ?? {};
		if (this.isConnected) this.update();
	}

	protected watch(client: Leuria): () => void {
		return client.subscribe(() => this.update());
	}

	private nameOf(provider: ProviderSnapshot): string {
		const name = this.names[provider.id] ?? NAMES[provider.id] ?? provider.label;
		return provider.id === "bridge" && provider.model ? `${name} · ${provider.model}` : name;
	}

	protected update(): void {
		const state = this.client?.getState();
		// Embedders don't answer: only the providers that chat.
		const providers = (state?.providers ?? []).filter((p) => p.offers.includes("chat"));
		const answering = state?.active && providers.find((p) => p.id === state.active?.id);
		const downloading = providers.find((p) => p.status === "downloading");
		const looking = providers.every((p) => p.status === "unknown" || p.status === "detecting");

		let tone = "idle";
		let text = "No AI yet";
		let hint = "";
		if (answering) {
			tone = "live";
			text = this.nameOf(answering);
			// It can't look things up on the page itself: say so, and what gives full answers.
			if (limitedHere(answering, state?.needs)) {
				text += " · simpler answers";
				hint = "This AI can't look things up on this page by itself, so its answers are simpler. Connect your AI for full answers.";
			}
		} else if (downloading) {
			tone = "pending";
			const percent = downloading.progress === undefined ? "" : ` · ${Math.round(downloading.progress * 100)}%`;
			text = `Getting ${this.nameOf(downloading).replace(/^This/, "this")} ready${percent}`;
		} else if (looking) {
			text = "Looking for your AI…";
		}
		this.pill.className = `status tone-${tone}`;
		if (hint) this.pill.title = hint;
		else this.pill.removeAttribute("title");
		// Through Leuria: the mark wears the dot. Another AI (the browser's, the site's) keeps the plain dot.
		this.pill.innerHTML = answering && answering.id === "bridge" ? statusMark(16, "live") : `<span class="dot" aria-hidden="true"></span>`;
		this.pill.append(text);
	}
}
