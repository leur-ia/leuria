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
 * attributes and event listeners, through refs: the same in React 18 and 19.
 */
export function useLeuriaElement<E extends HTMLElement & { client?: Leuria }>(
	tag: string,
	attributes: Record<string, string | boolean | number | undefined>,
	{ appearance, className, style, children }: ElementProps & { children?: ReactNode },
	events: Record<string, (() => void) | undefined> = {},
	properties: Record<string, unknown> = {},
): ReactElement {
	const client = useLeuria();
	const ref = useRef<E>(null);

	useIsomorphicLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		element.client = client;
		for (const [name, value] of Object.entries(properties)) (element as unknown as Record<string, unknown>)[name] = value;
	});

	const handlers = useRef(events);
	handlers.current = events;
	const names = Object.keys(events).join(" ");
	useEffect(() => {
		const element = ref.current;
		if (!element || !names) return;
		const listeners = names.split(" ").map((name) => [name, () => handlers.current[name]?.()] as const);
		for (const [name, listener] of listeners) element.addEventListener(name, listener);
		return () => {
			for (const [name, listener] of listeners) element.removeEventListener(name, listener);
		};
	}, [names]);

	const attrs: Record<string, string> = {};
	const all: Record<string, string | boolean | number | undefined> = { ...attributes, appearance };
	for (const [name, value] of Object.entries(all)) {
		if (value === true) attrs[name] = "";
		else if (value !== undefined && value !== false) attrs[name] = String(value);
	}
	return createElement(tag, { ref, ...attrs, className, style }, children);
}
