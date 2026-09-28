import { Marked, type Tokens } from "marked";

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Only web links and links inside the site. */
function safeHref(href: string): string | undefined {
	const trimmed = href.trim();
	if (/^(https?:|mailto:)/i.test(trimmed) || /^[/#?.]/.test(trimmed)) return trimmed;
	if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
	return undefined;
}

/**
 * An answer's Markdown as HTML. The text comes from a model, so it is
 * never trusted as HTML: raw HTML is shown as text, links keep to the web
 * and the site, and images become links.
 */
const marked = new Marked({
	gfm: true,
	breaks: false,
	renderer: {
		html({ text }: Tokens.HTML | Tokens.Tag) {
			return escape(text);
		},
		link({ href, tokens }: Tokens.Link) {
			const label = this.parser.parseInline(tokens);
			const safe = safeHref(href);
			if (!safe) return label;
			const external = /^https?:/i.test(safe) && (typeof location === "undefined" || new URL(safe).origin !== location.origin);
			return `<a href="${escape(safe)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ' data-internal=""'}>${label}</a>`;
		},
		image({ href, text }: Tokens.Image) {
			const safe = safeHref(href);
			return safe ? `<a href="${escape(safe)}" target="_blank" rel="noopener noreferrer">${escape(text || href)}</a>` : escape(text);
		},
	},
});

export function renderMarkdown(markdown: string): string {
	return marked.parse(markdown, { async: false }) as string;
}
