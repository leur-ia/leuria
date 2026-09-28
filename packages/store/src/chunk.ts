/**
 * Split Markdown into chunks for embedding: by heading, then by paragraph
 * when a section is long. Each chunk keeps its section heading, so it
 * still makes sense on its own.
 */
export function chunkMarkdown(markdown: string, { maxChars = 1200 }: { maxChars?: number } = {}): Array<{ heading?: string; text: string }> {
	const chunks: Array<{ heading?: string; text: string }> = [];
	let heading: string | undefined;
	let lines: string[] = [];
	const flush = () => {
		const body = lines.join("\n").trim();
		lines = [];
		if (!body) return;
		let current = "";
		for (const paragraph of body.split(/\n{2,}/)) {
			if (current && current.length + paragraph.length > maxChars) {
				chunks.push({ heading, text: current });
				current = "";
			}
			current = current ? `${current}\n\n${paragraph}` : paragraph;
		}
		if (current) chunks.push({ heading, text: current });
	};
	let fence: string | undefined;
	for (const line of markdown.split("\n")) {
		// A `# comment` inside a code block is not a heading.
		const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) fence = fence ? undefined : marker;
		const match = fence || marker ? null : /^#{1,6}\s+(.*)$/.exec(line);
		if (match) {
			flush();
			heading = match[1]!.trim();
		} else {
			lines.push(line);
		}
	}
	flush();
	return chunks.map((c) => ({ ...c, text: c.heading ? `${c.heading}\n\n${c.text}` : c.text }));
}
