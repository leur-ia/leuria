#!/usr/bin/env node
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

import { agentName, listAgents, pruneAgentVersions, resolveAgentCommand, resolveSiteAgent, updateAgents } from "./agents.js";
import { createAdminHandler } from "./admin.js";
import { convertServiceAis } from "./ais.js";
import { aiLabel, checkSignIn, rememberAgentState, signIn } from "./auth.js";
import { detectInstalledClis } from "./detect.js";
import { detectLlms, listModels, llmId, removeProvider, saveProvider } from "./llm/providers.js";
import { runMcpStdio } from "./mcp-stdio.js";
import { formatChecks, runChecks } from "./doctor.js";
import { GrantStore } from "./grants.js";
import { type EngineConfig, homePath, leuriaHome, loadConfig, saveConfig } from "./home.js";
import { createLogger } from "./logger.js";
import { runSelfTest } from "./self-test.js";
import { startEngine } from "./server.js";
import { VERSION } from "./version.js";

const HELP = `leuria ${VERSION}: let websites you approve use the AI on this computer

Usage:
  leuria [start]               Run the engine (sets itself up on first run)
  leuria setup [--update]      Install your agent from the ACP registry and check your sign-in
  leuria login [--method <id>] Sign in to your agent (ACP authenticate)
  leuria doctor                Check that everything is ready
  leuria test                  Run a real round trip with your agent
  leuria sites                 List connected sites
  leuria sites revoke <origin> Disconnect a site
  leuria sites use <origin> <agent|default>  Use another AI for one site
  leuria agents                List AIs: models in LM Studio, Ollama and your APIs, and ACP registry agents
  leuria providers             List LLM providers (LM Studio, Ollama, your APIs)
  leuria providers add <name> <url> [--key <api key>]   Add an OpenAI-compatible API
  leuria providers remove <id>

Options:
  -p, --port <n>       Port (default from ~/.leuria/config.json, else 19570; env LEURIA_PORT)
  -a, --agent <id>     AI to use and remember: an ACP registry id (codex-acp, claude-acp…)
                       or a model, llm:<provider>/<model> (e.g. llm:ollama/qwen3:8b)
  -v, --verbose        Log every request and session event
  -h, --help           Show this help
  --version            Show the version

State lives in ${leuriaHome()} (override with LEURIA_HOME).
`;

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			port: { type: "string", short: "p" },
			agent: { type: "string", short: "a" },
			verbose: { type: "boolean", short: "v" },
			method: { type: "string" },
			app: { type: "boolean" },
			"dev-pairing": { type: "boolean" },
			update: { type: "boolean" },
			key: { type: "string" },
			help: { type: "boolean", short: "h" },
			version: { type: "boolean" },
		},
	});
	if (values.help) return out(HELP);
	if (values.version) return out(`${VERSION}\n`);

	const config = loadConfig();
	if (values.agent && values.agent !== config.agent) {
		config.agent = values.agent;
		saveConfig(config);
	}
	const envPort = process.env.LEURIA_PORT;
	const port = Number(values.port ?? envPort ?? config.port);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error(`Invalid port: ${values.port ?? envPort}`);
	}
	config.port = port;

	const [command = "start", ...rest] = positionals;
	switch (command) {
		case "start":
			return values.app ? startForApp(config, values.verbose ?? false, values["dev-pairing"] ?? false) : start(config, values.verbose ?? false);
		case "setup":
			await setup(config, values.update ?? false);
			return;
		case "doctor":
			return doctor(config);
		case "login":
			return login(config, values.method);
		case "mcp-stdio":
			return runMcpStdio(rest[0] ?? "");
		case "test":
			return selfTest(config, values.verbose ?? false);
		case "sites":
			return sites(rest);
		case "providers":
			return providers(rest, values.key);
		case "agents":
			const found = new Set(detectInstalledClis());
			for (const { provider, running, models, error } of await detectLlms()) {
				if (!running) {
					out(`${provider.name.padEnd(24)} ${error ?? "not reachable"}\n`);
					continue;
				}
				for (const model of models) {
					const id = llmId(provider.id, model.id);
					out(`${id.padEnd(48)} ${id === config.agent ? "← current" : model.loaded ? "loaded" : ""}\n`);
				}
			}
			for (const agent of await listAgents()) {
				const mark = [
					agent.id === config.agent ? "← current" : "",
					agent.installed ? `installed in Leuria (${agent.installed})` : "",
					found.has(agent.id) ? "found on this computer" : "",
				]
					.filter(Boolean)
					.join(", ");
				out(`${agent.id.padEnd(24)} ${agent.name.padEnd(24)} ${agent.version.padEnd(12)} ${mark}\n`);
			}
			return;
		default:
			process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
			process.exitCode = 1;
	}
}

async function setup(config: EngineConfig, update = false): Promise<boolean> {
	out(`Leuria ${VERSION} setup\n`);
	const checks = await runChecks(config, { install: true, update, onProgress: (m) => out(`  ${m}\n`) });
	out(`${formatChecks(checks)}\n`);
	const ok = checks.every((c) => c.ok);
	out(ok ? "\nReady. Run `leuria` to start.\n" : "\nFix the items marked ✗, then run `leuria setup` again.\n");
	if (!ok) process.exitCode = 1;
	return ok;
}

async function providers(args: string[], key?: string): Promise<void> {
	const [sub, name, url] = args;
	if (sub === "add") {
		if (!name || !url) throw new Error("Usage: leuria providers add <name> <url> [--key <api key>]");
		const provider = saveProvider({ name, baseUrl: url, apiKey: key });
		const models = await listModels(provider).catch((error: unknown) => {
			out(`Saved, but: ${error instanceof Error ? error.message : String(error)}\n`);
			return [];
		});
		out(`Added ${provider.name} (${provider.baseUrl}). Models:\n`);
		for (const model of models) out(`  ${llmId(provider.id, model.id)}\n`);
		return;
	}
	if (sub === "remove") {
		if (!name) throw new Error("Usage: leuria providers remove <id>");
		out(removeProvider(name) ? `Removed ${name}\n` : `${name} is not one of your providers\n`);
		return;
	}
	if (sub) throw new Error(`Unknown providers command: ${sub}`);
	for (const { provider, running, models, error } of await detectLlms()) {
		out(`${provider.id.padEnd(20)} ${provider.name.padEnd(20)} ${provider.baseUrl.padEnd(36)} ${running ? `${models.length} model(s)` : (error ?? "not reachable")}\n`);
	}
}

async function login(config: EngineConfig, methodId?: string): Promise<void> {
	const result = await signIn(config.agent, {
		methodId,
		// Terminal sign-in methods need an interactive terminal.
		terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
		onProgress: (m) => out(`${m}\n`),
	});
	if (result.ok) {
		out(`Signed in (${result.detail}).\n`);
		return;
	}
	process.stderr.write(`Sign-in failed: ${result.detail}\n`);
	if (result.methods.length > 1) {
		process.stderr.write(`Methods: ${result.methods.map((m) => `${m.id} (${m.name})`).join(", ")}. Choose one with --method.\n`);
	}
	process.exitCode = 1;
}

async function doctor(config: EngineConfig): Promise<void> {
	const checks = await runChecks(config);
	const running = await fetch(`http://127.0.0.1:${config.port}/health`, { signal: AbortSignal.timeout(1000) })
		.then((r) => r.json() as Promise<{ leuria?: string }>)
		.catch(() => null);
	checks.push({
		name: "Engine",
		ok: true,
		detail: running?.leuria ? `running on port ${config.port} (${running.leuria})` : `not running (port ${config.port})`,
	});
	out(`${formatChecks(checks)}\n`);
	if (!checks.every((c) => c.ok)) process.exitCode = 1;
}

async function selfTest(config: EngineConfig, verbose: boolean): Promise<void> {
	if (!(await setup(config))) return;
	out("\n");
	const result = await runSelfTest({
		agentName: agentName(config.agent),
		resolveAgent: () => resolveAgentCommand(config.agent),
		logger: createLogger(verbose),
		onStep: (m) => out(`  ${m}\n`),
	});
	for (const step of result.steps) out(`  ${step.ok ? "✓" : "✗"} ${step.name}: ${step.detail}\n`);
	out(result.ok ? "\nLeuria works end to end.\n" : "\nThe round trip failed. Run `leuria test -v` for details.\n");
	if (!result.ok) process.exitCode = 1;
}

function sites(args: string[]): void {
	const grants = new GrantStore();
	convertServiceAis(grants);
	const [sub, origin] = args;
	if (sub === "use") {
		const agent = args[2];
		if (!origin || !agent) throw new Error("Usage: leuria sites use <origin> <agent|default>");
		const ok = grants.setAgent(origin, agent === "default" ? undefined : agent);
		out(ok ? `${origin} now uses ${agent === "default" ? "the default AI" : agent}\n` : `${origin} is not connected\n`);
		return;
	}
	if (sub === "revoke") {
		if (!origin) throw new Error("Usage: leuria sites revoke <origin>");
		out(grants.revoke(origin) ? `Disconnected ${origin}\n` : `${origin} was not connected\n`);
		return;
	}
	if (sub) throw new Error(`Unknown sites command: ${sub}`);
	const list = grants.list();
	if (list.length === 0) return out("No connected sites.\n");
	for (const g of list) {
		const used = g.lastUsedAt ? `last used ${g.lastUsedAt.slice(0, 16).replace("T", " ")}` : "never used";
		out(`${g.origin.padEnd(40)} ${(g.app ?? "").padEnd(24)} ${(g.agent ?? "default AI").padEnd(16)} ${used}\n`);
	}
}

/** Open a page in the visitor's browser (best effort: the terminal shows the link too). */
function openInBrowser(url: string): void {
	const [command, args] =
		process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
	try {
		const child = spawn(command, args as string[], { stdio: "ignore", detached: true });
		child.on("error", () => undefined);
		child.unref();
	} catch {
		// The link in the terminal is enough.
	}
}

async function start(config: EngineConfig, verbose: boolean): Promise<void> {
	/** When each request's page was last opened: a site trying again doesn't open a tab each time. */
	const shownAt = new Map<string, number>();
	const logger = createLogger(verbose);
	const checks = await runChecks(config, {
		install: true,
		onProgress: (m) => process.stderr.write(`${m}\n`),
	});
	const failed = checks.filter((c) => !c.ok);
	if (failed.length > 0) {
		process.stderr.write(`Leuria is not ready:\n${formatChecks(failed)}\n`);
		process.exitCode = 1;
		return;
	}
	saveConfig(config);

	const grants = new GrantStore();
	convertServiceAis(grants);
	config.agent = loadConfig().agent;
	const stdioMcpCommand = stdioMcpSelf();
	let engine: Awaited<ReturnType<typeof startEngine>>;
	try {
		engine = await startEngine({
			port: config.port,
			grants,
			logger,
			agentName: agentName(config.agent),
			resolveAgent: (origin) => resolveSiteAgent(grants.get(origin), config.agent),
			onAgentState: rememberAgentState,
			stdioMcpCommand,
			// No app to ask in: the engine's own approval page, in the browser.
			onPairingRequest: ({ requestId, origin, app, approveUrl }) => {
				const now = Date.now();
				if (now - (shownAt.get(requestId) ?? 0) < 15_000) return;
				shownAt.set(requestId, now);
				openInBrowser(approveUrl);
				process.stderr.write(
					`\n${app ? `${app} (${origin})` : origin} asks to use your AI.\n` +
						`  If no window opened, approve it here: ${approveUrl}\n\n`,
				);
			},
		});
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
			process.stderr.write(
				`Port ${config.port} is in use: Leuria may already be running (check with \`leuria doctor\`), or use --port.\n`,
			);
			process.exitCode = 1;
			return;
		}
		throw err;
	}

	const connected = grants.list().length;
	process.stderr.write(
		`Leuria ${VERSION} is running on http://127.0.0.1:${engine.port}\n` +
			`  agent:  ${agentName(config.agent)}\n` +
			`  sites:  ${connected === 0 ? "none connected yet" : `${connected} connected (leuria sites)`}\n` +
			`  state:  ${homePath()}\n` +
			"Keep this window open while you use Leuria sites. Press Ctrl+C to stop.\n",
	);

	const shutdown = async () => {
		await engine.close();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

/** How to run this very CLI as `mcp-stdio`, from source, from npm, or as a compiled binary. */
function stdioMcpSelf(): { command: string; args: string[] } {
	const script = process.argv[1] ?? "";
	// A Bun-compiled binary is the CLI itself; its script path is virtual.
	const compiled = !script || script.startsWith("/$bunfs") || /^[A-Z]:[\\/]~BUN/i.test(script);
	return compiled
		? { command: process.execPath, args: ["mcp-stdio"] }
		: { command: process.execPath, args: [...process.execArgv, script, "mcp-stdio"] };
}

/**
 * `leuria start --app`: the engine inside the desktop app. It starts even
 * before an agent is chosen or signed in (the app runs onboarding through
 * the admin API), and reports events as JSON lines on stdout.
 */
/**
 * The engine for the desktop app. `devPairing` (a debug build of the app,
 * `pnpm desktop`): macOS gives `leuria://` links only to a bundled app, so
 * a site's claim asks the visitor itself, as with the CLI, and the engine
 * answers every site. Never in a release build.
 */
/** When the engine looks for newer versions of the installed AIs. */
const AI_UPDATE_DELAY_MS = 30_000;
const AI_UPDATE_EVERY_MS = 24 * 60 * 60 * 1000;

async function startForApp(config: EngineConfig, verbose: boolean, devPairing: boolean): Promise<void> {
	const token = process.env.LEURIA_ADMIN_TOKEN;
	if (!token || token.length < 32) throw new Error("LEURIA_ADMIN_TOKEN (32+ characters) is required with --app");
	const emit = (event: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(event)}\n`);
	const logger = createLogger(verbose);
	const grants = new GrantStore();
	convertServiceAis(grants);
	config.agent = loadConfig().agent;
	// Versions left by an update: nothing runs them yet.
	try {
		pruneAgentVersions();
	} catch (err) {
		logger.warn("could not remove old AI versions", { err: err instanceof Error ? err.message : String(err) });
	}
	let port = config.port;
	const engine = await startEngine({
		port: config.port,
		grants,
		logger,
		agentName: () => agentName(config.agent),
		resolveAgent: (origin) => resolveSiteAgent(grants.get(origin), config.agent),
		siteAgentName: (origin) => {
			const grant = grants.get(origin);
			const id = grant?.agent ?? config.agent;
			return aiLabel(id, grant?.model?.agent === id ? grant.model.id : loadConfig().models?.[id]);
		},
		// A real session is the check: remember it, and tell the app when an AI is signed out.
		onAgentState: (id, state) => {
			rememberAgentState(id, state);
			emit({ event: "agent_state", id, ok: state.ok });
		},
		stdioMcpCommand: stdioMcpSelf(),
		silent: !devPairing,
		onPairingRequest: (request) => emit({ event: "pairing", ...request }),
		onPairingDecided: (decision) => emit({ event: "pairing_decided", ...decision }),
		admin: {
			token,
			handle: createAdminHandler({ config, grants, logger, port: () => port, emit }),
		},
	}).catch((err: NodeJS.ErrnoException) => {
		emit({ event: "error", code: err.code ?? "start_failed", message: err.message });
		throw err;
	});
	port = engine.port;
	emit({ event: "ready", port, version: VERSION, agent: config.agent });

	// Newer versions of the installed AIs (new models, fixes): soon after start, then daily.
	// Its models are asked again, so a new one shows up without the visitor doing anything.
	const updateAis = () =>
		void updateAgents(async (agent, from) => {
			logger.info("AI updated", { id: agent.id, from, to: agent.version });
			await checkSignIn(agent.id, undefined, { quiet: true }).catch(() => undefined);
			emit({ event: "agent_updated", id: agent.id });
		});
	setTimeout(updateAis, AI_UPDATE_DELAY_MS).unref();
	setInterval(updateAis, AI_UPDATE_EVERY_MS).unref();

	const shutdown = async () => {
		await engine.close();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
	// The app owns us: when it goes away, stdin closes.
	process.stdin.on("end", shutdown);
	process.stdin.resume();
}

function out(text: string): void {
	process.stdout.write(text);
}

main().catch((err) => {
	process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
});
