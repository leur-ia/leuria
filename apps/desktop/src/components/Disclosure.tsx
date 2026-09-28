import { Icon } from "@leuria/pearl";
import { Button, Flex } from "@radix-ui/themes";
import { type ReactNode, useId, useState } from "react";

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
	const [open, setOpen] = useState(defaultOpen);
	const id = useId();
	return (
		<Flex direction="column" gap="2">
			<Button
				variant="ghost"
				color="gray"
				size="1"
				aria-expanded={open}
				aria-controls={id}
				style={{ alignSelf: "flex-start" }}
				onClick={() => {
					if (!open) onOpen?.();
					setOpen(!open);
				}}
			>
				<span className={open ? "disclosure-chevron open" : "disclosure-chevron"}>
					<Icon name="chevron-down" size={14} />
				</span>
				{label}
				{value ? ` · ${value}` : ""}
			</Button>
			{open && <div id={id}>{children}</div>}
		</Flex>
	);
}
