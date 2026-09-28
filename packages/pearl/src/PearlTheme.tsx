import { Theme } from "@radix-ui/themes";
import { type ReactNode, useEffect, useState } from "react";

function systemAppearance(): "light" | "dark" {
	return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Radix Themes root, set up as design_system/radix.md says, following the
 * system's light (Pearl) or dark (Night) appearance. Also sets
 * `data-theme` so Pearl tokens outside Radix follow.
 */
export function PearlTheme({ children }: { children: ReactNode }) {
	const [appearance, setAppearance] = useState(systemAppearance);
	useEffect(() => {
		const query = window.matchMedia("(prefers-color-scheme: dark)");
		const update = () => setAppearance(query.matches ? "dark" : "light");
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
	useEffect(() => {
		document.documentElement.dataset.theme = appearance;
	}, [appearance]);
	return (
		<Theme
			appearance={appearance}
			accentColor="violet"
			grayColor="mauve"
			radius="full"
			scaling="100%"
			panelBackground="translucent"
		>
			{children}
		</Theme>
	);
}
