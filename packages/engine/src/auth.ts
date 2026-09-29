/**
 * Sign-in, the ACP v1 way. The agent advertises `authMethods` in
 * `initialize`; whether the visitor is signed in is known from
 * `session/new`, which fails with `auth_required` otherwise.
 *
 * ACP v1 (and the registry's AUTHENTICATION.md) has two method kinds:
 *   - agent methods (no `type`): the client calls `authenticate` and the
 *     agent runs its own flow, usually OAuth in the browser;
 *   - `type: "terminal"`: the client re-runs the agent with the method's
 *     `args`/`env` (replacing the registry's) in an interactive terminal.
 *     It MUST NOT be passed to `authenticate`. Agents only offer it when
 *     the client sets `auth.terminal`, which `leuria login` does in a TTY
 *     and the desktop app never does.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type AgentInfo, type AgentModels, AcpLiveSession } from "./acp/acp-client.js";
import { homePath, loadConfig, readJson, rememberReady, writeJson } from "./home.js";
import { agentName, ensureAgent } from "./agents.js";
import { catchBrowserLinks } from "./browser-link.js";
import { defaultModel, getProvider, isLlmId, listModels, parseLlmId } from "./llm/providers.js";
import { profileFor } from "./profiles.js";

export interface SignInStatus {
	ok: boolean;
	detail: string;
	methods: AgentInfo["authMethods"];
	/** Models the agent offers once signed in (from `session/new`), with the visitor's choice as `current`. */
	models?: AgentModels;
}

/**
 * Models each agent offered in its last session, kept in `models.json`:
 * starting an agent just to list them is avoided, even across restarts.
 */
function knownModels(): Record<string, AgentModels> {
	return readJson<Record<string, AgentModels>>(homePath("models.json")) ?? {};
}

function rememberModels(id: string, models: AgentModels): void {
	const all = knownModels();
	if (JSON.stringify(all[id]) === JSON.stringify(models)) return;
	writeJson(homePath("models.json"), { ...all, [id]: models });
}

/**
 * The models `id` offers, with the saved choice as current. Probes the
 * agent (a sign-in check, no prompt) only when none were ever seen; none
 * for LLMs or when signed out.
 */
export async function agentModels(id: string): Promise<AgentModels | null> {
	if (isLlmId(id)) {
		// A service AI lists its models live (cheap: one local or HTTP request); a fixed one has no choice.
		const parsed = parseLlmId(id);
		const provider = parsed && !parsed.model ? getProvider(parsed.providerId) : undefined;
		if (!provider) return null;
		const models = await listModels(provider).catch(() => null);
		return models?.length ? (withChoice(id, llmModels(models, id)).models ?? null) : null;
	}
	if (!knownModels()[id]) await checkSignIn(id);
	return withChoice(id, knownModels()[id] ?? null).models ?? null;
}

/** The models an agent was last seen offering, with the saved choice as current; never starts it. */
export function seenAgentModels(id: string): AgentModels | null {
	return withChoice(id, knownModels()[id] ?? null).models ?? null;
}

/** How a site's status line names an AI: "Claude · Sonnet 5" (the model when one was chosen and is known). */
export function aiLabel(id: string, model?: string): string {
	const name = agentName(id);
	// A service AI with its model fixed already says it ("qwen3 · Ollama").
	if (isLlmId(id) && parseLlmId(id)?.model) return name;
	if (isLlmId(id)) return model ? `${name} · ${model.split("/").pop()}` : name;
	if (!model) return name;
	const known = knownModels()[id]?.options.find((m) => m.id === model);
	return known ? `${name} · ${known.name}` : name;
}

/**
 * What a real session learned about an agent: it works (and offers these
 * models), or it is signed out. Startup trusts this instead of checking.
 */
export function rememberAgentState(id: string, state: { ok: boolean; models?: AgentModels | null }): void {
	if (isLlmId(id)) return;
	rememberReady(id, state.ok);
	if (state.models?.options.length) rememberModels(id, state.models);
}

/** A service's models as a model choice; the current one is what the AI answers with by default. */
function llmModels(models: Array<{ id: string; loaded?: boolean; remote?: boolean }>, id: string): AgentModels {
	return {
		current: loadConfig().models?.[id] ?? defaultModel(models),
		options: models.map((m) => ({
			id: m.id,
			name: m.id.split("/").pop() ?? m.id,
			...(m.loaded ? { description: "Loaded: answers at once" } : m.remote ? { description: "Runs online" } : {}),
		})),
	};
}

/** The agent's models, with the saved choice as current when the agent offers it. */
function withChoice(id: string, models: AgentModels | null): { models?: AgentModels } {
	if (models?.options.length) rememberModels(id, models);
	if (!models || models.options.length === 0) return {};
	const chosen = loadConfig().models?.[id];
	const current = chosen && models.options.some((m) => m.id === chosen) ? chosen : models.current;
	return { models: { ...models, current } };
}

type Method = AgentInfo["authMethods"][number];
type TerminalMethod = Extract<Method, { type: "terminal" }>;

function isTerminal(method: Method): method is TerminalMethod {
	return "type" in method && method.type === "terminal";
}

/** ACP v1 agent methods: everything but `type: "terminal"`. */
export function agentMethods(methods: AgentInfo["authMethods"]): AgentInfo["authMethods"] {
	return methods.filter((m) => !isTerminal(m));
}

/** Pick the method to offer: an account sign-in before API keys; terminal methods only when allowed. */
export function preferredMethod(
	methods: AgentInfo["authMethods"],
	options: { terminal?: boolean } = {},
): Method | undefined {
	const usable = options.terminal ? methods : agentMethods(methods);
	// Codex marks its API-key method with `_meta["api-key"]`; names are the fallback hint.
	const isKey = (m: Method) =>
		/api.?key/i.test(`${m.id} ${m.name}`) || Boolean((m._meta as Record<string, unknown> | undefined)?.["api-key"]);
	return usable.find((m) => !isKey(m)) ?? usable[0];
}

/** Start the agent the way sessions do, without page tools. */
async function open(id: string, onProgress?: (message: string) => void, terminalAuth = false, extraEnv: Record<string, string> = {}) {
	const agent = await ensureAgent(id, { onProgress });
	const sandbox = mkdtempSync(join(tmpdir(), "leuria-auth-"));
	const custom = profileFor(id)?.configure?.({ sandbox, mcpUrl: "http://127.0.0.1:9/unused", mcpToken: "unused" });
	const env = { ...agent.env, ...custom?.env, ...extraEnv };
	const session = new AcpLiveSession({
		command: agent.command,
		args: [...agent.launchArgs, ...agent.args],
		cwd: sandbox,
		envVars: env,
		mcpServers: [],
		sessionMeta: custom?.meta,
		terminalAuth,
	});
	const close = () => {
		session.close();
		rmSync(sandbox, { recursive: true, force: true });
	};
	return { agent, session, close, env, sandbox };
}

/** An LLM needs no sign-in: it is ready when its provider answers and has the model. */
async function checkLlm(id: string): Promise<SignInStatus> {
	const parsed = parseLlmId(id);
	const provider = parsed && getProvider(parsed.providerId);
	if (!parsed || !provider) return { ok: false, detail: "This AI is not set up anymore. Choose it again.", methods: [] };
	try {
		const models = await listModels(provider);
		if (parsed.model && !models.some((m) => m.id === parsed.model)) {
			return { ok: false, detail: `${provider.name} doesn't have "${parsed.model}" anymore.`, methods: [] };
		}
		if (models.length === 0) return { ok: false, detail: `${provider.name} has no model to answer with. Open it and load one.`, methods: [] };
		// A service AI offers its models like an agent does.
		return { ok: true, detail: "ready", methods: [], ...(parsed.model ? {} : withChoice(id, llmModels(models, id))) };
	} catch (error) {
		return { ok: false, detail: error instanceof Error ? error.message : String(error), methods: [] };
	}
}

/**
 * How long an agent gets to start and open a session before the check gives
 * up (Codex and Claude take 1–2 s; some agents never answer until set up in
 * their own app). `LEURIA_CHECK_TIMEOUT_MS` overrides it.
 */
function checkTimeoutMs(): number {
	const value = Number(process.env.LEURIA_CHECK_TIMEOUT_MS);
	return Number.isFinite(value) && value > 0 ? value : 15_000;
}

/**
 * How long a sign-in may go without opening a page before the agent is
 * started again (Codex opens it within 2–3 s). `LEURIA_SIGNIN_STALL_MS` overrides it.
 */
function signInStallMs(): number {
	const value = Number(process.env.LEURIA_SIGNIN_STALL_MS);
	return Number.isFinite(value) && value > 0 ? value : 10_000;
}

/**
 * Is the visitor signed in to this agent? Opens (and closes) a real ACP session, within a time limit.
 * `quiet`: a background look for its models; the answer is not remembered as the agent's state.
 */
export async function checkSignIn(id: string, onProgress?: (message: string) => void, options: { quiet?: boolean } = {}): Promise<SignInStatus> {
	if (isLlmId(id)) return checkLlm(id);
	const { session, close } = await open(id, onProgress);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timedOut = new Promise<SignInStatus>((resolve) => {
		timer = setTimeout(() => {
			// Plain words: the app shows this sentence as is.
			resolve({ ok: false, detail: `${agentName(id)} didn't answer. It may need to be set up in its own app first.`, methods: [] });
		}, checkTimeoutMs());
	});
	try {
		const status = await Promise.race([timedOut, check()]);
		if (!options.quiet) rememberReady(id, status.ok);
		return status;
	} finally {
		clearTimeout(timer);
		// Also stops an agent that never answered.
		close();
	}

	async function check(): Promise<SignInStatus> {
		const connected = await session.connect();
		if (connected.error) return { ok: false, detail: `the agent did not start: ${connected.error}`, methods: [] };
		const methods = agentMethods(session.info?.authMethods ?? []);
		const created = await session.newSession();
		if (!created.error) return { ok: true, detail: "ready", methods, ...withChoice(id, session.models) };
		return { ok: false, detail: created.authRequired ? "not signed in" : created.error, methods };
	}
}

/** Sign in with an advertised method, then confirm with `session/new`. */
export async function signIn(
	id: string,
	options: {
		methodId?: string;
		/** The caller can run an interactive terminal method (a TTY). */
		terminal?: boolean;
		onProgress?: (message: string) => void;
		/** Cancel a sign-in in progress: the agent is stopped (which frees its login callback). */
		signal?: AbortSignal;
		/** The sign-in page the agent opened in the browser, for a "didn't see it?" link. */
		onUrl?: (url: string) => void;
	} = {},
): Promise<SignInStatus> {
	if (isLlmId(id)) return checkLlm(id);
	let pageOpened = false;
	const link =
		options.onUrl && !options.terminal
			? catchBrowserLinks((url) => {
					pageOpened = true;
					options.onUrl?.(url);
				})
			: null;
	let opened: Awaited<ReturnType<typeof open>>;
	try {
		opened = await open(id, options.onProgress, options.terminal, link?.env);
	} catch (error) {
		link?.stop();
		throw error;
	}
	const { agent, env, sandbox } = opened;
	const close = () => {
		opened.close();
		link?.stop();
	};
	/**
	 * `authenticate`, or "stalled" when the agent opens no sign-in page in time. Only
	 * where Leuria sees the pages agents open (not Windows, not a terminal sign-in).
	 */
	async function authenticateOrStall(session: AcpLiveSession, methodId: string): Promise<{ error?: string } | "stalled"> {
		const auth = session.authenticate(methodId);
		if (!link) return auth;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const stalled = new Promise<"stalled">((resolve) => {
			timer = setTimeout(() => {
				if (!pageOpened) resolve("stalled");
			}, signInStallMs());
		});
		try {
			return await Promise.race([auth, stalled]);
		} finally {
			clearTimeout(timer);
		}
	}

	const cancelled = new Promise<SignInStatus>((resolve) => {
		const onAbort = () => {
			// Settle as cancelled before stopping the agent, whose pending call then fails.
			resolve({ ok: false, detail: "cancelled", methods: [] });
			close();
		};
		if (options.signal?.aborted) onAbort();
		else options.signal?.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([cancelled, run()]);
	} finally {
		close();
	}

	async function run(): Promise<SignInStatus> {
		let session = opened.session;
		const connected = await session.connect();
		if (connected.error) return { ok: false, detail: `the agent did not start: ${connected.error}`, methods: [] };
		const all = session.info?.authMethods ?? [];
		const methods = options.terminal ? all : agentMethods(all);
		if (methods.length === 0) {
			return { ok: false, detail: `${agent.name} offers no sign-in method Leuria can run; sign in with its own tool.`, methods };
		}
		const method = options.methodId
			? methods.find((m) => m.id === options.methodId)
			: preferredMethod(methods, { terminal: options.terminal });
		if (!method) return { ok: false, detail: `Unknown method. Available: ${methods.map((m) => m.id).join(", ")}`, methods };
		options.onProgress?.(`Signing in to ${agent.name} with ${method.name}${method.description ? ` (${method.description})` : ""}…`);

		if (isTerminal(method)) {
			// Terminal auth: the method's args/env replace the registry's, in this terminal.
			session.close();
			const code = await new Promise<number | null>((resolve, reject) => {
				const child = spawn(agent.command, [...agent.launchArgs, ...(method.args ?? [])], {
					stdio: "inherit",
					cwd: sandbox,
					env: { ...process.env, ...env, ...(method.env ?? {}) },
				});
				child.on("error", reject);
				child.on("exit", resolve);
			});
			if (code !== 0) return { ok: false, detail: `the sign-in ended with code ${code}`, methods };
			return checkSignIn(id, options.onProgress);
		}

		let auth = await authenticateOrStall(session, method.id);
		if (auth === "stalled") {
			// No sign-in page after a while: the agent got stuck before opening one (Codex can,
			// on a first try). A fresh agent gets through, as a second try by hand does.
			opened.close();
			if (options.signal?.aborted) return { ok: false, detail: "cancelled", methods };
			opened = await open(id, options.onProgress, options.terminal, link?.env);
			session = opened.session;
			const again = await session.connect();
			if (again.error) return { ok: false, detail: `the agent did not start: ${again.error}`, methods };
			auth = await session.authenticate(method.id);
		}
		// The agent's own words (codex-acp says "Invalid params" for a login that did not
		// succeed); the app shows only reasons written for people.
		if (auth.error) return { ok: false, detail: auth.error, methods };
		const created = await session.newSession();
		if (created.error) return { ok: false, detail: created.error, methods };
		rememberReady(id, true);
		return { ok: true, detail: `signed in with ${method.name}`, methods, ...withChoice(id, session.models) };
	}
}
