/** Events of a server-sent event stream: `event:` name and joined `data:` lines. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event?: string; data: string }> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) return;
			buffer += decoder.decode(value, { stream: true });
			let index: number;
			while ((index = buffer.search(/\r?\n\r?\n/)) >= 0) {
				const lines = buffer.slice(0, index).split(/\r?\n/);
				buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, "");
				const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
				const data = lines
					.filter((line) => line.startsWith("data:"))
					.map((line) => line.slice(5).trimStart())
					.join("\n");
				if (event || data) yield { event, data };
			}
		}
	} finally {
		reader.releaseLock();
	}
}
