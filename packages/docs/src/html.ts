/**
 * A docs page's HTML as Markdown, for a light corpus: the page is read
 * from the site, and only its content (the `<article>`, else `<main>`) is
 * kept. Enough Markdown for a model: headings, paragraphs, lists, tables,
 * code blocks and links.
 */

const SKIP = new Set(["SCRIPT", "STYLE", "NAV", "BUTTON", "SVG", "IMG", "FOOTER", "TEMPLATE", "NOSCRIPT"]);

/** The page's content as Markdown, or "" when it has none. */
export function htmlToMarkdown(html: string, base = typeof location === "undefined" ? "http://docs.invalid" : location.href): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const root = doc.querySelector("article .markdown") ?? doc.querySelector("article") ?? doc.querySelector("main");
	if (!root) return "";
	return blocks(root, new URL(base).origin)
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function blocks(node: Element, origin: string, indent = ""): string {
	let out = "";
	for (const child of node.childNodes) {
		if (child.nodeType === 3) {
			const text = clean(child.textContent ?? "");
			if (text.trim()) out += text;
			continue;
		}
		if (child.nodeType !== 1) continue;
		const el = child as Element;
		const tag = el.tagName.toUpperCase();
		if (SKIP.has(tag) || el.classList.contains("hash-link") || el.getAttribute("aria-hidden") === "true") continue;
		if (/^H[1-6]$/.test(tag)) out += `\n\n${"#".repeat(Number(tag[1]))} ${inline(el, origin).trim()}\n\n`;
		else if (tag === "P") out += `\n\n${inline(el, origin).trim()}\n\n`;
		else if (tag === "PRE") out += `\n\n${codeBlock(el)}\n\n`;
		else if (tag === "UL" || tag === "OL") out += `\n\n${list(el, origin, indent)}\n\n`;
		else if (tag === "TABLE") out += `\n\n${table(el, origin)}\n\n`;
		else if (tag === "BR") out += "\n";
		else if (["A", "CODE", "STRONG", "B", "EM", "I", "SPAN"].includes(tag) && !el.querySelector("pre, p, ul, ol, table, div")) out += inlineElement(el, origin);
		else out += blocks(el, origin, indent);
	}
	return out;
}

function inline(node: Element, origin: string): string {
	let out = "";
	for (const child of node.childNodes) {
		if (child.nodeType === 3) {
			out += clean(child.textContent ?? "");
			continue;
		}
		if (child.nodeType === 1) out += inlineElement(child as Element, origin);
	}
	return out;
}

function inlineElement(el: Element, origin: string): string {
	const tag = el.tagName.toUpperCase();
	if (SKIP.has(tag) || el.classList.contains("hash-link")) return "";
	if (tag === "CODE") return `\`${el.textContent ?? ""}\``;
	if (tag === "BR") return "\n";
	const text = inline(el, origin);
	if (tag === "A") {
		const href = el.getAttribute("href");
		return href && !href.startsWith("#") ? `[${text}](${link(href, origin)})` : text;
	}
	if ((tag === "STRONG" || tag === "B") && text.trim()) return `**${text}**`;
	if ((tag === "EM" || tag === "I") && text.trim()) return `*${text}*`;
	return text;
}

/** A code block: Prism's lines end with `<br>`, so they are put back as line breaks. */
function codeBlock(pre: Element): string {
	const copy = pre.cloneNode(true) as Element;
	for (const br of copy.querySelectorAll("br")) br.replaceWith("\n");
	for (const line of copy.querySelectorAll(".token-line")) if (!line.textContent?.endsWith("\n")) line.append("\n");
	const language = /language-([\w-]+)/.exec(`${pre.className} ${pre.querySelector("code")?.className ?? ""}`)?.[1] ?? "";
	return `\`\`\`${language}\n${(copy.textContent ?? "").replace(/\n+$/, "")}\n\`\`\``;
}

function list(el: Element, origin: string, indent: string): string {
	const ordered = el.tagName.toUpperCase() === "OL";
	// A list cut by a code block goes on with `start`.
	const start = Number(el.getAttribute("start") ?? 1) || 1;
	return [...el.children]
		.filter((li) => li.tagName.toUpperCase() === "LI")
		.map((li, i) => {
			const marker = ordered ? `${start + i}.` : "-";
			const body = blocks(li, origin, `${indent}  `).trim().replace(/\n{2,}/g, "\n").replace(/\n/g, `\n${indent}  `);
			return `${indent}${marker} ${body}`;
		})
		.join("\n");
}

function table(el: Element, origin: string): string {
	const rows = [...el.querySelectorAll("tr")].map((tr) => [...tr.children].map((cell) => inline(cell, origin).trim().replace(/\|/g, "\\|").replace(/\n/g, " ")));
	if (rows.length === 0) return "";
	const width = Math.max(...rows.map((r) => r.length));
	const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
	return [line(rows[0]!), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
}

/** Links on the same site as paths, as the corpus has them. */
function link(href: string, origin: string): string {
	try {
		const url = new URL(href, origin);
		return url.origin === origin ? `${url.pathname}${url.hash}` : url.href;
	} catch {
		return href;
	}
}

/** Text as it reads: no zero-width spaces (Docusaurus puts them in heading links), spaces collapsed. */
function clean(text: string): string {
	return text.replace(/​/g, "").replace(/\s+/g, " ");
}

/** The text of a page's Markdown under a heading (or before the first one), without the heading. */
export function markdownSection(markdown: string, heading?: string): string {
	const lines = markdown.split("\n");
	// Lines of code blocks are never headings, even when they start with #.
	let fenced = false;
	const inCode = lines.map((line) => {
		if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) {
			fenced = !fenced;
			return true;
		}
		return fenced;
	});
	const isHeading = (line: string, i: number) =>!inCode[i] && /^#{1,6}\s/.test(line);
	let start = 0;
	if (heading) {
		start = lines.findIndex((line, i) => isHeading(line, i) && line.replace(/^#+\s+/, "").replace(/[`*_]/g, "").trim() === heading.trim());
		if (start < 0) return "";
	} else if (/^#\s/.test(lines[0] ?? "")) {
		start = 1;
	}
	let end = lines.findIndex((line, i) => i > start && isHeading(line, i));
	if (end < 0) end = lines.length;
	return lines.slice(heading ? start + 1 : start, end).join("\n").trim();
}
