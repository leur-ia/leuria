import { Icon } from "@leuria/pearl";
import { Box, Button } from "@radix-ui/themes";
import type { ReactNode } from "react";

/**
 * An advanced option, folded away: one quiet line that
 * says the current value ("Model · 6 Luna") and opens the control.
 * Tesler's Law: the defaults work; this is for people who want to choose.
 */
export function Disclosure({
	label,
	value,
	children,
	defaultOpen = false,
	onOpen,
}: {
	label: string;
	value?: string;
	children: ReactNode;
	/** Open at first (e.g. a site asked to change its AI). */
	defaultOpen?: boolean;
	/** Called each time it opens, e.g. to load what it shows. */
	onOpen?: () => void;
}) {
	return (
		<details className="disclosure" open={defaultOpen} onToggle={(e) => e.currentTarget.open && onOpen?.()}>
			<Button asChild variant="ghost" color="gray" size="1">
				<summary>
					<span className="disclosure-chevron">
						<Icon name="chevron-down" size={14} />
					</span>
					{label}
					{value ? ` · ${value}` : ""}
				</summary>
			</Button>
			<Box mt="2">{children}</Box>
		</details>
	);
}
