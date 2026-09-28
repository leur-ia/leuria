/** The Leuria mark, a manta beneath a star (design_system/assets/Logos). */
const MARK =
	"M181 61 C184 74 191 82 206 86 C191 90 184 98 181 111 C178 98 171 90 156 86 C171 82 178 74 181 61 Z M59 92 C60 109 67 128 79 143 C91 158 105 168 124 174 C149 182 164 193 171 207 C177 219 177 239 177 255 C182 255 182 240 184 226 C188 199 201 187 223 179 C247 171 270 158 284 142 C298 127 303 109 303 92 C298 91 292 101 284 108 C265 125 245 130 226 126 C217 124 211 114 205 112 C199 110 199 116 199 121 C198 127 191 130 181 130 C171 130 165 127 163 121 C162 116 165 110 159 111 C151 112 148 122 137 126 C118 131 98 125 78 109 C69 102 65 91 59 92 Z";

export function Mark({ size = 32, decorative = false }: { size?: number; decorative?: boolean }) {
	return (
		<svg
			className="pearl-mark"
			width={size}
			height={size}
			viewBox="53 30 256 256"
			fill="none"
			role={decorative ? undefined : "img"}
			aria-label={decorative ? undefined : "Leuria"}
			aria-hidden={decorative ? true : undefined}
		>
			<path d={MARK} fill="currentColor" />
		</svg>
	);
}

/**
 * `mark` alone for tight spaces; `lockup` (mark + lowercase wordmark) by
 * default. Ink on light and Pearl grounds, `ceramic` on Deep Ink.
 */
export function Logo({
	variant = "lockup",
	size = 24,
	tone = "ink",
}: {
	variant?: "mark" | "lockup";
	size?: number;
	tone?: "ink" | "ceramic";
}) {
	const className = `pearl-logo pearl-logo-${tone}`;
	if (variant === "mark") {
		return (
			<span className={className}>
				<Mark size={size} />
			</span>
		);
	}
	return (
		<span className={className} role="img" aria-label="Leuria" style={{ gap: Math.round(size * 0.32) }}>
			<Mark size={size} decorative />
			<span className="pearl-wordmark" style={{ fontSize: Math.round(size * 0.78) }}>
				leuria
			</span>
		</span>
	);
}
