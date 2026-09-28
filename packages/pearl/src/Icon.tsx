import {
	ArrowRightIcon,
	CheckIcon,
	ChevronDownIcon,
	ComputerDesktopIcon,
	EllipsisHorizontalIcon,
	ExclamationTriangleIcon,
	GlobeAltIcon,
	InformationCircleIcon,
	KeyIcon,
	LockClosedIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	XMarkIcon,
} from "@heroicons/react/24/outline";
import type { ComponentType, SVGProps } from "react";

/**
 * Pearl's icons: Heroicons outline (24px grid, round caps and joins,
 * currentColor), drawn at Pearl's 1.75 stroke. Only familiar symbols;
 * never the sparkles. Add an icon here, not in the screens.
 */
const ICONS = {
	check: CheckIcon,
	x: XMarkIcon,
	info: InformationCircleIcon,
	alert: ExclamationTriangleIcon,
	"arrow-right": ArrowRightIcon,
	"chevron-down": ChevronDownIcon,
	lock: LockClosedIcon,
	globe: GlobeAltIcon,
	computer: ComputerDesktopIcon,
	search: MagnifyingGlassIcon,
	key: KeyIcon,
	more: EllipsisHorizontalIcon,
	plus: PlusIcon,
} satisfies Record<string, ComponentType<SVGProps<SVGSVGElement>>>;

export type IconName = keyof typeof ICONS;

/** Icons support words; give meaningful ones a `label`. */
export function Icon({ name, size = 18, label }: { name: IconName; size?: number; label?: string }) {
	const Svg = ICONS[name];
	return (
		<Svg
			width={size}
			height={size}
			strokeWidth={1.75}
			style={{ flexShrink: 0, display: "block" }}
			role={label ? "img" : undefined}
			aria-label={label}
			aria-hidden={label ? undefined : true}
		/>
	);
}
