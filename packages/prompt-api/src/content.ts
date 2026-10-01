/**
 * Prompt API input (`LanguageModelPrompt`, `initialPrompts`) to Leuria
 * messages. The spec's rules on roles and `prefix` are enforced here, with
 * the exceptions Chrome throws.
 */

import { type Message, type MessagePart, messageFiles, messageText, newId } from "@leuria/client";
import { domError } from "./errors.js";

export type LanguageModelMessageRole = "system" | "user" | "assistant";
export type LanguageModelMessageType = "text" | "image" | "audio" | "tool-call" | "tool-response";

export interface LanguageModelMessageContent {
	type: LanguageModelMessageType;
	value: unknown;
}

export interface LanguageModelMessage {
	role: LanguageModelMessageRole;
	content: string | LanguageModelMessageContent[];
	prefix?: boolean;
}

export type LanguageModelPrompt = string | LanguageModelMessage[];

export interface Converted {
	/** Text of the system messages (initial prompts only). */
	system: string;
	messages: Message[];
	/** Text the answer must start with (a last assistant message with `prefix: true`). */
	prefix?: string;
}

/**
 * Convert a prompt. In `initial` mode (`initialPrompts`), a system message
 * may come first; elsewhere it is refused, as the spec says.
 */
export async function convert(input: LanguageModelPrompt, initial = false): Promise<Converted> {
	if (typeof input === "string") return { system: "", messages: [userText(input)] };
	if (!Array.isArray(input)) throw new TypeError("The prompt must be a string or an array of messages.");
	const system: string[] = [];
	const messages: Message[] = [];
	let prefix: string | undefined;
	for (const [index, message] of input.entries()) {
		if (message.role === "system") {
			if (!initial) throw domError("NotSupportedError", "System messages can only be given in initialPrompts.");
			if (index !== 0) throw new TypeError("A system message must come first in initialPrompts.");
		} else if (message.role !== "user" && message.role !== "assistant") {
			throw new TypeError(`Unknown role: ${String(message.role)}`);
		}
		if (message.prefix) {
			if (message.role !== "assistant" || index !== input.length - 1 || initial) {
				throw domError("SyntaxError", "Only the last message, from the assistant, can be a prefix.");
			}
		}
		const parts = await toParts(message.content);
		if (message.role === "system") {
			system.push(textOf(parts));
		} else if (message.prefix) {
			prefix = textOf(parts);
		} else {
			messages.push({ id: newId(), role: message.role, parts });
		}
	}
	return { system: system.join("\n\n"), messages, prefix };
}

function userText(text: string): Message {
	return { id: newId(), role: "user", parts: [{ type: "text", text }] };
}

function textOf(parts: MessagePart[]): string {
	return messageText({ id: "", role: "user", parts });
}

async function toParts(content: LanguageModelMessage["content"]): Promise<MessagePart[]> {
	if (typeof content === "string") return [{ type: "text", text: content }];
	if (!Array.isArray(content)) throw new TypeError("A message's content must be a string or an array.");
	const parts: MessagePart[] = [];
	for (const item of content) {
		switch (item.type) {
			case "text":
				if (typeof item.value !== "string") throw new TypeError("A text content's value must be a string.");
				parts.push({ type: "text", text: item.value });
				break;
			case "image":
				parts.push({ type: "file", ...(await imageData(item.value)) });
				break;
			case "audio":
				throw domError("NotSupportedError", "Audio input is not supported.");
			case "tool-call":
			case "tool-response":
				parts.push({ type: "text", text: `[${item.type}] ${typeof item.value === "string" ? item.value : JSON.stringify(item.value)}` });
				break;
			default:
				throw new TypeError(`Unknown content type: ${String((item as { type: unknown }).type)}`);
		}
	}
	return parts;
}

/**
 * Several messages sent as one turn (a prompt given as a message list, or
 * messages appended before it): one user message, earlier ones written as
 * a transcript, all files kept.
 */
export function asOneTurn(messages: Message[]): Message {
	if (messages.length === 1 && messages[0]!.role === "user") return messages[0]!;
	const text = messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${messageText(m)}`).join("\n\n");
	return { id: newId(), role: "user", parts: [{ type: "text", text }, ...messages.flatMap(messageFiles)] };
}

// ── Images ─────────────────────────────────────────────────────────────

async function imageData(value: unknown): Promise<{ mediaType: string; url: string }> {
	if (typeof Blob !== "undefined" && value instanceof Blob) {
		const bytes = new Uint8Array(await value.arrayBuffer());
		return encode(bytes, value.type || sniff(bytes));
	}
	if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
		const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		return encode(bytes, sniff(bytes));
	}
	if (value && typeof value === "object") return encode(await drawToPng(value), "image/png");
	throw new TypeError("An image's value must be an image, a canvas, a Blob or bytes.");
}

function encode(bytes: Uint8Array, mediaType: string): { mediaType: string; url: string } {
	if (!mediaType.startsWith("image/")) throw domError("NotSupportedError", "This image format is not supported.");
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return { mediaType, url: `data:${mediaType};base64,${btoa(binary)}` };
}

function sniff(bytes: Uint8Array): string {
	const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
	if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
	if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
	if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
	if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
	return "application/octet-stream";
}

/** An image element, canvas, bitmap, video frame or ImageData, as PNG bytes. */
async function drawToPng(source: object): Promise<Uint8Array> {
	if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement && !source.complete) await source.decode();
	const isData = typeof ImageData !== "undefined" && source instanceof ImageData;
	const size = source as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; displayWidth?: number; displayHeight?: number };
	const width = size.naturalWidth || size.videoWidth || size.displayWidth || size.width || 0;
	const height = size.naturalHeight || size.videoHeight || size.displayHeight || size.height || 0;
	if (!width || !height) throw domError("InvalidStateError", "The image has no size (not loaded yet?).");
	let blob: Blob;
	if (typeof OffscreenCanvas !== "undefined") {
		const canvas = new OffscreenCanvas(width, height);
		const ctx = canvas.getContext("2d")!;
		if (isData) ctx.putImageData(source as ImageData, 0, 0);
		else ctx.drawImage(source as CanvasImageSource, 0, 0);
		blob = await canvas.convertToBlob({ type: "image/png" });
	} else if (typeof document !== "undefined") {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d")!;
		if (isData) ctx.putImageData(source as ImageData, 0, 0);
		else ctx.drawImage(source as CanvasImageSource, 0, 0);
		blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(domError("InvalidStateError", "The image could not be read."))), "image/png"));
	} else {
		throw domError("NotSupportedError", "Images need a browser.");
	}
	return new Uint8Array(await blob.arrayBuffer());
}
