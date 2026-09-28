import { DOWNLOAD_URL } from "./connect-button.js";
import { LeuriaElement } from "./element.js";
import { mark } from "./icons.js";

/**
 * `<leuria-badge>`: a small footer link that tells visitors where the
 * site's AI comes from, and where to get Leuria. Its text ("Runs on your
 * AI" by default) can be replaced with the element's content.
 *
 * Attributes: `href`, `appearance`.
 */
export class LeuriaBadge extends LeuriaElement {
	static observedAttributes = ["href", "appearance"];

	private readonly link: HTMLAnchorElement;

	constructor() {
		super();
		this.shadow.innerHTML += `<div class="root" part="root"><a class="badge" part="badge" target="_blank" rel="noopener"><slot>Runs on your AI</slot>${mark(14)}<span class="wordmark">leuria</span></a></div>`;
		this.link = this.shadow.querySelector(".badge")!;
	}

	protected update(): void {
		this.link.href = this.getAttribute("href") ?? DOWNLOAD_URL;
	}
}
