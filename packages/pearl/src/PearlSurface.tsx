import type { CSSProperties, ReactNode } from "react";

/**
 * The Pearl atmosphere: ground for onboarding, heroes and empty states,
 * one per view, never behind dense UI. Text on it is ink at 16px+, or sits
 * on a translucent card.
 */
export function PearlSurface({
	children,
	grain = true,
	sheen = true,
	radius = 24,
	padding = 32,
	style,
	className,
}: {
	children?: ReactNode;
	grain?: boolean;
	sheen?: boolean;
	radius?: number | string;
	padding?: number | string;
	style?: CSSProperties;
	className?: string;
}) {
	const classes = ["pearl-surface", grain && "pearl-surface-grain", sheen && "pearl-surface-sheen", className].filter(Boolean).join(" ");
	return (
		<div className={classes} style={{ borderRadius: radius, padding, ...style }}>
			<div className="pearl-surface-content">{children}</div>
		</div>
	);
}
