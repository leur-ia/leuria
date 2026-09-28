import { Button } from "@radix-ui/themes";
import type { ComponentProps } from "react";

/**
 * The ONE primary action of a view: a solid Deep Ink pill, 48px tall
 * (size 3, `target-primary`). Everything else uses Radix `Button` with
 * `soft`, `surface` or `ghost`.
 */
export function InkButton({ className, size = "3", ...props }: ComponentProps<typeof Button>) {
	return <Button {...props} size={size} variant="solid" className={["pearl-ink", className].filter(Boolean).join(" ")} />;
}
