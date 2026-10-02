import type { Leuria } from "@leuria/client";
import { useLeuria } from "@leuria/react";
import { type CSSProperties, createElement, type ReactElement, type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

// Server rendering has no layout effects; the elements only come alive in the browser anyway.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface ElementProps {
	/** `light` or `dark`; the visitor's system by default. */
	appearance?: "light" | "dark";
	/** Position and size only: the elements keep Leuria's colours. */
	className?: string;
	style?: CSSProperties;
}

/**
 * Render a Leuria element with the client from `LeuriaProvider`, plain
 * attributes, the status's `labels` and the button's `leuria-disconnect`
 * listener, through refs: the same in React 18 and 19.
 */
export function useLeuriaElement(
	tag: string,
	attributes: Record<string, string | boolean | number | undefined>,
	{ appearance, className, style, children }: ElementProps & { children?: ReactNode },
	extras: { onDisconnect?: () => void; labels?: Record<string, string> } = {},
): ReactElement {
	const client = useLeuria();
	const ref = useRef<HTMLElement & { client?: Leuria; labels?: Record<string, string> }>(null);

	useIsomorphicLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		element.client = client;
		if ("labels" in extras) element.labels = extras.labels;
	});

	const onDisconnect = useRef(extras.onDisconnect);
	onDisconnect.current = extras.onDisconnect;
	const listens = Boolean(extras.onDisconnect);
	useEffect(() => {
		const element = ref.current;
		if (!element || !listens) return;
		const listener = () => onDisconnect.current?.();
		element.addEventListener("leuria-disconnect", listener);
		return () => element.removeEventListener("leuria-disconnect", listener);
	}, [listens]);

	const attrs: Record<string, string> = {};
	const all: Record<string, string | boolean | number | undefined> = { ...attributes, appearance };
	for (const [name, value] of Object.entries(all)) {
		if (value === true) attrs[name] = "";
		else if (value !== undefined && value !== false) attrs[name] = String(value);
	}
	return createElement(tag, { ref, ...attrs, className, style }, children);
}
