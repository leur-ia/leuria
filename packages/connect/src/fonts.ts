/**
 * Plus Jakarta Sans for the elements. `@font-face` does not work inside a
 * shadow root, so it is declared once on the page, under a family name of
 * its own: it never replaces a font the host page uses.
 */
export const FONT_FAMILY = "Leuria Sans";

const FACES = [
	{
		file: new URL("../fonts/plus-jakarta-sans-latin-ext-wght-normal.woff2", import.meta.url),
		range:
			"U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
	},
	{
		file: new URL("../fonts/plus-jakarta-sans-latin-wght-normal.woff2", import.meta.url),
		range:
			"U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
	},
];

let loaded = false;

export function loadFonts(): void {
	if (loaded || typeof document === "undefined") return;
	loaded = true;
	const style = document.createElement("style");
	style.dataset.leuria = "fonts";
	style.textContent = FACES.map(
		(face) =>
			`@font-face{font-family:"${FONT_FAMILY}";font-style:normal;font-display:swap;font-weight:200 800;src:url(${face.file.href}) format("woff2-variations");unicode-range:${face.range};}`,
	).join("\n");
	document.head.append(style);
}
