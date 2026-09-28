/** The Leuria mark, a manta beneath a star (design_system/assets/Logos). */
const MARK =
	"M181 61 C184 74 191 82 206 86 C191 90 184 98 181 111 C178 98 171 90 156 86 C171 82 178 74 181 61 Z M59 92 C60 109 67 128 79 143 C91 158 105 168 124 174 C149 182 164 193 171 207 C177 219 177 239 177 255 C182 255 182 240 184 226 C188 199 201 187 223 179 C247 171 270 158 284 142 C298 127 303 109 303 92 C298 91 292 101 284 108 C265 125 245 130 226 126 C217 124 211 114 205 112 C199 110 199 116 199 121 C198 127 191 130 181 130 C171 130 165 127 163 121 C162 116 165 110 159 111 C151 112 148 122 137 126 C118 131 98 125 78 109 C69 102 65 91 59 92 Z";

export function mark(size: number): string {
	return `<svg class="mark" width="${size}" height="${size}" viewBox="53 30 256 256" aria-hidden="true"><path d="${MARK}" fill="currentColor"/></svg>`;
}

/** The mark wearing the status as a small dot, like a presence badge: Leuria's, and in what state. */
export function statusMark(size: number, tone: "live" | "blocked"): string {
	return `<span class="status-mark" aria-hidden="true">${mark(size)}<span class="dot tone-${tone}"></span></span>`;
}

/* Heroicons outline 24 (MIT, tailwindlabs/heroicons), drawn at Pearl's 1.75 stroke. */
const ICONS = {
	x: "M6 18 18 6M6 6l12 12",
	"chevron-down": "m19.5 8.25-7.5 7.5-7.5-7.5",
};

export function icon(name: keyof typeof ICONS, size: number): string {
	return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
}

/** Text for innerHTML. */
export function esc(text: string): string {
	return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
