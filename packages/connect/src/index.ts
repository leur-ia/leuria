/**
 * @leuria/connect: Leuria's Connect UI as web components, for any page and
 * any framework. Importing it defines the elements.
 *
 *   import { setDefaultClient } from "@leuria/connect"
 *   setDefaultClient(ai)
 *
 *   <leuria-connect-button></leuria-connect-button>
 *   <leuria-ai-status></leuria-ai-status>
 *   <leuria-badge></leuria-badge>
 *
 * Each element keeps Leuria Pearl's styles in its own shadow root: the
 * host page's CSS neither reaches it nor is changed by it.
 */

import { LeuriaAIStatus } from "./ai-status.js";
import { LeuriaBadge } from "./badge.js";
import { LeuriaConnectButton } from "./connect-button.js";

export { setDefaultClient } from "./client.js";
export { setDefaultAppearance } from "./element.js";
export { DOWNLOAD_URL } from "./connect-button.js";
export { LeuriaAIStatus, LeuriaBadge, LeuriaConnectButton };

const ELEMENTS = {
	"leuria-connect-button": LeuriaConnectButton,
	"leuria-ai-status": LeuriaAIStatus,
	"leuria-badge": LeuriaBadge,
};

if (typeof customElements !== "undefined") {
	for (const [name, element] of Object.entries(ELEMENTS)) {
		if (!customElements.get(name)) customElements.define(name, element);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"leuria-connect-button": LeuriaConnectButton;
		"leuria-ai-status": LeuriaAIStatus;
		"leuria-badge": LeuriaBadge;
	}
}
