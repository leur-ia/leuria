#!/usr/bin/env node
// A minimal ACP agent for tests. On each prompt it calls the first page
// tool through the engine's MCP endpoint, then replies with the result.
// A prompt containing "bash" makes it ask permission for a built-in tool.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// FAKE_NO_HTTP=1: advertise no HTTP MCP, so the client must give a stdio server.
const httpMcp = !process.env.FAKE_NO_HTTP;
let stdioMcp = null;

let mcp = null;
let slowTurn = null;
// Models offered as an ACP v1 config option; "MODEL?" asks which one answers.
let model = "fast";
const modelOption = () => ({
	id: "model",
	name: "Model",
	category: "model",
	type: "select",
	currentValue: model,
	options: [
		{ value: "fast", name: "Fast" },
		{ value: "smart", name: "Smart", description: "Slower, better" },
	],
});
let nextId = 1000;
const pending = new Map();

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
const request = (method, params) =>
	new Promise((resolve) => {
		const id = nextId++;
		pending.set(id, resolve);
		send({ id, method, params });
	});

async function callMcp(method, params) {
	if (stdioMcp) return stdioMcp(method, params);
	const res = await fetch(mcp.url, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json", ...mcp.headers },
		body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
	});
	return JSON.parse((await res.text()).trim()).result;
}

async function handle(msg) {
	if (msg.id !== undefined && !msg.method) {
		pending.get(msg.id)?.(msg.result);
		pending.delete(msg.id);
		return;
	}
	switch (msg.method) {
		case "initialize":
			return send({
				id: msg.id,
				result: {
					protocolVersion: msg.params.protocolVersion,
					agentCapabilities: { promptCapabilities: { image: true }, mcpCapabilities: { http: httpMcp } },
				},
			});
		case "session/new": {
			// FAKE_HANG=1: never answer, like an agent waiting to be set up elsewhere.
			if (process.env.FAKE_HANG) return;
			// FAKE_SIGNED_OUT=1: ACP auth_required.
			if (process.env.FAKE_SIGNED_OUT) return send({ id: msg.id, error: { code: -32000, message: "Authentication required" } });
			const server = msg.params.mcpServers[0];
			if (server.command) {
				// stdio MCP server: one JSON-RPC message per line.
				const child = spawn(server.command, server.args, {
					env: { ...process.env, ...Object.fromEntries(server.env.map((e) => [e.name, e.value])) },
					stdio: ["pipe", "pipe", "inherit"],
				});
				const waiting = new Map();
				createInterface({ input: child.stdout }).on("line", (line) => {
					const reply = JSON.parse(line);
					waiting.get(reply.id)?.(reply.result);
				});
				stdioMcp = (method, params) =>
					new Promise((resolve) => {
						const id = nextId++;
						waiting.set(id, resolve);
						child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
					});
			} else {
				mcp = {
					url: server.url,
					headers: Object.fromEntries(server.headers.map((h) => [h.name, h.value])),
				};
			}
			return send({ id: msg.id, result: { sessionId: "fake-session", configOptions: [modelOption()] } });
		}
		case "session/prompt": {
			const blocks = msg.params.prompt;
			const text = blocks.filter((p) => p.type === "text").map((p) => p.text).join(" ");
			const update = (u) => send({ method: "session/update", params: { sessionId: "fake-session", update: u } });
			const reply = (t) => {
				update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } });
				return send({ id: msg.id, result: { stopReason: "end_turn" } });
			};
			// "BLOCKS" describes the prompt's content blocks.
			if (text.includes("MODEL?")) return reply(`model: ${model}`);
			if (text.includes("BLOCKS")) return reply(blocks.map((b) => (b.type === "image" ? `image:${b.mimeType}` : `text:${b.text.length}`)).join(","));
			if (text.includes("THINK")) {
				update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "pondering" } });
				return reply("thought done");
			}
			// "SLOW" waits for session/cancel.
			if (text.includes("SLOW")) {
				update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "working" } });
				slowTurn = msg.id;
				return;
			}
			if (text.includes("bash")) {
				const answer = await request("session/request_permission", {
					sessionId: "fake-session",
					toolCall: { toolCallId: "t-bash", title: "Bash", _meta: { claudeCode: { toolName: "Bash" } } },
					options: [
						{ optionId: "yes", kind: "allow_once", name: "Allow" },
						{ optionId: "no", kind: "reject_once", name: "Reject" },
					],
				});
				update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `bash: ${answer.outcome.optionId ?? "cancelled"}` } });
				return send({ id: msg.id, result: { stopReason: "end_turn" } });
			}
			const { tools } = await callMcp("tools/list", {});
			// "SUBMIT {json}" answers through the structured-output tool.
			const submit = /SUBMIT (\{.*\})/.exec(text);
			if (submit) {
				const result = await callMcp("tools/call", { name: "submit_result", arguments: JSON.parse(submit[1]) });
				update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `submitted: ${result.content[0].text}` } });
				return send({ id: msg.id, result: { stopReason: "end_turn" } });
			}
			if (tools.length === 0) {
				update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `echo: ${text}` } });
				return send({ id: msg.id, result: { stopReason: "end_turn" } });
			}
			const tool = tools[0];
			update({ sessionUpdate: "tool_call", toolCallId: "t1", title: tool.name, kind: "other", status: "pending" });
			const result = await callMcp("tools/call", { name: tool.name, arguments: { text } });
			update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" });
			update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `tool said: ${result.content[0].text}` } });
			return send({ id: msg.id, result: { stopReason: "end_turn" } });
		}
		case "session/set_config_option":
			model = msg.params.value;
			return send({ id: msg.id, result: { configOptions: [modelOption()] } });
		case "session/cancel":
			if (slowTurn !== null) {
				send({ id: slowTurn, result: { stopReason: "cancelled" } });
				slowTurn = null;
			}
			return;
		default:
			if (msg.id !== undefined) send({ id: msg.id, error: { code: -32601, message: "Method not found" } });
	}
}

createInterface({ input: process.stdin }).on("line", (line) => {
	if (line.trim()) void handle(JSON.parse(line));
});
