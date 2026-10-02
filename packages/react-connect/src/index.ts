/**
 * @leuria/react-connect: Leuria's Connect UI for React. The components are
 * the `@leuria/connect` web components, given the client of the nearest
 * `LeuriaProvider` from `@leuria/react`.
 *
 *   import { ConnectButton, AIStatus, LeuriaBadge } from "@leuria/react-connect"
 */

import "@leuria/connect";

import type { ReactElement, ReactNode } from "react";

import { type ElementProps, useLeuriaElement } from "./element.js";

export type { ElementProps } from "./element.js";
/** The appearance of every Leuria element without its own, for pages with a light/dark switch. */
export { setDefaultAppearance } from "@leuria/connect";

export interface ConnectButtonProps extends ElementProps {
	/** 1: 36px (navigation bars), 2: 48px (default), 3: 56px. */
	size?: 1 | 2 | 3;
	/** Show "by leuria" beside "Connect your AI". Default true. */
	byline?: boolean;
	/** Called after the visitor disconnects this site, e.g. to clear a conversation. */
	onDisconnect?: () => void;
}

/** "Connect your AI", one per page (`<leuria-connect-button>`). */
export function ConnectButton({ size, byline = true, onDisconnect, ...props }: ConnectButtonProps): ReactElement {
	return useLeuriaElement("leuria-connect-button", { size, "hide-byline": !byline }, props, { onDisconnect });
}

export interface AIStatusProps extends ElementProps {
	/** Names by provider id, replacing "Your AI", "This browser's AI", "This site's AI". */
	labels?: Record<string, string>;
}

/** Which AI answers right now, as a dot and words (`<leuria-ai-status>`). */
export function AIStatus({ labels, ...props }: AIStatusProps): ReactElement {
	return useLeuriaElement("leuria-ai-status", {}, props, { labels });
}

export interface LeuriaBadgeProps extends ElementProps {
	/** Default "Runs on your AI". */
	children?: ReactNode;
	href?: string;
}

/** The footer link back to Leuria (`<leuria-badge>`). */
export function LeuriaBadge({ href, ...props }: LeuriaBadgeProps): ReactElement {
	return useLeuriaElement("leuria-badge", { href }, props);
}
