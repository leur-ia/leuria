/**
 * `/session/*` HTTP surface.
 *
 *   POST /session/prepare           { prompt?, attachments?, systemPrompt?, maxTurns?, skills? }
 *   POST /session/:id/approve
 *   POST /session/:id/prompt        { prompt, attachments? }
 *   POST /session/:id/cancel-turn
 *   POST /session/:id/cancel
 *   POST /session/:id/close
 *   GET  /session/:id
 *   GET  /session/:id/stream        (SSE)
 *
 * `server.ts` has already authenticated the requester. A session is only
 * visible to the origin that prepared it.
 */

import type * as http from "node:http";

import type { PromptAttachment } from "./acp/acp-client.js";
import { parseBody, sendJson, writeSse } from "./http-utils.js";
import type { SessionManager } from "./session-manager.js";
import { parseSkillRefs } from "./skills.js";

const MAX_ATTACHMENTS = 10;

/** Validate `attachments` from a request body. Throws on bad input. */
export function parseAttachments(value: unknown): PromptAttachment[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error("attachments must be an array");
	if (value.length > MAX_ATTACHMENTS) throw new Error(`At most ${MAX_ATTACHMENTS} attachments`);
	return value.map((item, i) => {
		const a = (item ?? {}) as Record<string, unknown>;
		const name = typeof a.name === "string" ? a.name.slice(0, 200) : undefined;
		if (a.type === "image" && typeof a.mimeType === "string" && /^image\//.test(a.mimeType) && typeof a.data === "string") {
			return { type: "image", mimeType: a.mimeType, data: a.data, name };
		}
		if (a.type === "text" && typeof a.text === "string") {
			return { type: "text", text: a.text, name, mimeType: typeof a.mimeType === "string" ? a.mimeType : undefined };
		}
		throw new Error(`attachments[${i}] must be { type: "image", mimeType, data } or { type: "text", text }`);
	});
}

const TERMINAL_EVENTS = new Set(["completed", "failed", "cancelled"]);
const POST_ACTIONS = new Set([
	"approve",
	"prompt",
	"cancel-turn",
	"cancel",
	"close",
]);

/** Handle a `/session/*` request. Returns false when the path is not ours. */
export async function handleSessionRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	pathname: string,
	sm: SessionManager,
	/** Authenticated origin, or `local` for requests without `Origin`. */
	requester: string,
	/** The site sent its skill refs with a session: update them when they changed. */
	onSkills?: (origin: string, refs: string[] | undefined) => void,
): Promise<boolean> {
	const segments = pathname.split("/").filter(Boolean);
	if (segments[0] !== "session") return false;

	try {
		if (req.method === "POST" && segments.length === 2 && segments[1] === "prepare") {
			await handlePrepare(req, res, sm, requester, onSkills);
			return true;
		}
		const sessionId = segments[1];
		const action = segments[2];
		if (!sessionId) return false;

		const info = sm.get(sessionId);
		// Another origin's session looks exactly like a missing one.
		if (!info || info.origin !== requester) {
			sendJson(res, 404, { error: "Session not found" });
			return true;
		}

		if (req.method === "GET" && segments.length === 2) {
			sendJson(res, 200, info);
			return true;
		}
		if (req.method === "GET" && action === "stream") {
			handleStream(req, res, sm, sessionId);
			return true;
		}
		if (req.method === "POST" && action && POST_ACTIONS.has(action)) {
			const updated = await runAction(req, sm, sessionId, action);
			sendJson(res, 200, { sessionId: updated.id, status: updated.status });
			return true;
		}
	} catch (err) {
		sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
		return true;
	}
	return false;
}

async function runAction(
	req: http.IncomingMessage,
	sm: SessionManager,
	sessionId: string,
	action: string,
) {
	switch (action) {
		case "approve":
			return sm.approve(sessionId);
		case "prompt": {
			const body = (await parseBody(req)) as Record<string, unknown>;
			if (typeof body.prompt !== "string" || !body.prompt.trim()) {
				throw new Error("Missing required field: prompt");
			}
			return sm.promptTurn(sessionId, body.prompt, parseAttachments(body.attachments));
		}
		case "cancel-turn":
			return sm.cancelTurn(sessionId);
		case "cancel":
			return sm.cancel(sessionId);
		default:
			return sm.close(sessionId);
	}
}

async function handlePrepare(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	sm: SessionManager,
	origin: string,
	onSkills?: (origin: string, refs: string[] | undefined) => void,
): Promise<void> {
	const body = (await parseBody(req)) as Record<string, unknown>;
	// Only a page that says which skills it uses changes them: `[]` removes them all.
	if ("skills" in body) onSkills?.(origin, parseSkillRefs(body.skills));
	if (body.prompt !== undefined && (typeof body.prompt !== "string" || !body.prompt.trim())) {
		sendJson(res, 400, { error: "prompt must be a non-empty string when given" });
		return;
	}
	const info = sm.prepare({
		prompt: body.prompt as string | undefined,
		attachments: parseAttachments(body.attachments),
		systemPrompt:
			typeof body.systemPrompt === "string" && body.systemPrompt ? body.systemPrompt : undefined,
		maxTurns: typeof body.maxTurns === "number" ? body.maxTurns : undefined,
		origin,
	});
	sendJson(res, 201, {
		sessionId: info.id,
		status: info.status,
		registrationToken: info.registrationToken,
		webmcpUrl: info.webmcpUrl,
	});
}

function handleStream(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	sm: SessionManager,
	sessionId: string,
): void {
	const info = sm.get(sessionId)!;

	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});
	// Send headers now: clients wait for the stream to open before approving.
	res.flushHeaders();

	if (info.status === "completed" || info.status === "failed" || info.status === "cancelled") {
		writeSse(res, info.status, info.status === "failed" ? (info.error ?? null) : null);
		res.end();
		return;
	}

	// Late subscribers still get the channel credentials and the current turn.
	if (info.status !== "pending_approval") {
		writeSse(res, "webmcp_ready", sm.webmcpReady(sessionId));
	}
	if (info.status === "idle") writeSse(res, "ready", null);
	for (const chunk of sm.turnChunks(sessionId)) writeSse(res, "chunk", chunk);

	const listener = (event: string, data: unknown): void => {
		writeSse(res, event, data);
		if (TERMINAL_EVENTS.has(event)) {
			sm.removeListener(sessionId, listener);
			res.end();
		}
	};
	sm.addListener(sessionId, listener);
	req.on("close", () => sm.removeListener(sessionId, listener));
}
