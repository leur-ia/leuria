import type * as http from "node:http";

/** Largest JSON body accepted: system prompts and image attachments can be large. */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

export function sendJson(
	res: http.ServerResponse,
	status: number,
	data: unknown,
): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

/** Parse a JSON body; an empty body parses to `{}`. */
export function parseBody(req: http.IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(new Error("Body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				const raw = Buffer.concat(chunks).toString("utf-8");
				resolve(raw ? JSON.parse(raw) : {});
			} catch {
				reject(new Error("Invalid JSON body"));
			}
		});
		req.on("error", reject);
	});
}

/** Emit a typed SSE event; the data line is the raw JSON payload. */
export function writeSse(
	res: http.ServerResponse,
	event: string,
	data: unknown,
): void {
	try {
		res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`);
	} catch {
		// connection closed mid-write
	}
}
