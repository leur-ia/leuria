/**
 * `leuria doctor` and `leuria setup`: everything a visitor needs, checked
 * with a fix for each problem, so nobody has to ask the author.
 */

import { agentName, ensureAgent, installedAgent } from "./agents.js";
import { isLlmId } from "./llm/providers.js";
import { checkSignIn } from "./auth.js";
import type { EngineConfig } from "./home.js";

export interface Check {
	name: string;
	ok: boolean;
	detail: string;
	fix?: string;
}

const MIN_NODE_MAJOR = 22;

export async function runChecks(
	config: EngineConfig,
	options: { install?: boolean; update?: boolean; onProgress?: (message: string) => void } = {},
): Promise<Check[]> {
	const checks: Check[] = [];

	if (process.versions.bun) {
		checks.push({ name: "Runtime", ok: true, detail: `Bun ${process.versions.bun}` });
	} else {
		const major = Number(process.versions.node.split(".")[0]);
		checks.push({
			name: "Runtime",
			ok: major >= MIN_NODE_MAJOR,
			detail: `Node.js v${process.versions.node}`,
			fix: major >= MIN_NODE_MAJOR ? undefined : `Install Node.js ${MIN_NODE_MAJOR} or later from https://nodejs.org`,
		});
	}

	if (isLlmId(config.agent)) {
		const status = await checkSignIn(config.agent);
		checks.push({ name: "AI", ok: status.ok, detail: status.ok ? agentName(config.agent) : status.detail });
		return checks;
	}

	let installed = installedAgent(config.agent);
	if (options.install || options.update) {
		try {
			installed = await ensureAgent(config.agent, { update: options.update, onProgress: options.onProgress });
		} catch (err) {
			checks.push({
				name: "Agent",
				ok: false,
				detail: err instanceof Error ? err.message.split("\n")[0]! : String(err),
				fix: "Check your network, then run `npx @leuria/cli setup` again.",
			});
			return checks;
		}
	}
	if (!installed) {
		checks.push({ name: "Agent", ok: false, detail: `${config.agent} not installed`, fix: "Run `npx @leuria/cli setup`." });
		return checks;
	}
	checks.push({ name: "Agent", ok: true, detail: `${installed.name} ${installed.version} (ACP registry: ${installed.id})` });

	const signIn = await checkSignIn(config.agent, options.onProgress);
	checks.push({
		name: "Sign-in",
		ok: signIn.ok,
		detail: signIn.detail,
		fix: signIn.ok
			? undefined
			: signIn.methods.length
				? `Run \`npx @leuria/cli login\` (${signIn.methods.map((m) => m.name).join(" or ")}).`
				: `Sign in with ${installed.name}'s own tool, then run \`npx @leuria/cli doctor\` again.`,
	});
	return checks;
}

export function formatChecks(checks: Check[]): string {
	return checks
		.map((c) => {
			const line = `  ${c.ok ? "✓" : "✗"} ${c.name.padEnd(12)} ${c.detail}`;
			return c.ok || !c.fix ? line : `${line}\n      → ${c.fix}`;
		})
		.join("\n");
}
