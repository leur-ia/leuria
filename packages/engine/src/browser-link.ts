/**
 * Catch the sign-in page an agent opens in the browser, so the app can
 * offer it as a link too ("Didn't see it? Open the sign-in page"): the
 * browser sometimes does not come up, or comes up behind other windows.
 *
 * Agents open pages with the system command (`open` on macOS, `xdg-open`
 * on Linux). During a sign-in, a small command of the same name comes
 * first in the agent's PATH: it notes the link, then runs the real one,
 * so the browser still opens as usual. Windows agents open pages another
 * way: no link there.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export interface BrowserLink {
	/** Environment for the agent: PATH with the catching command first. */
	env: Record<string, string>;
	stop(): void;
}

function realCommand(name: string): string | null {
	if (name === "open" && existsSync("/usr/bin/open")) return "/usr/bin/open";
	try {
		return execFileSync("/bin/sh", ["-c", `command -v ${name}`], { encoding: "utf-8" }).trim() || null;
	} catch {
		return null;
	}
}

/** Start catching; `onUrl` gets each http(s) page the agent opens. Null on Windows. */
export function catchBrowserLinks(
	onUrl: (url: string) => void,
	options: { basePath?: string; /** Tests: stand-ins for the real commands. */ real?: (name: string) => string | null } = {},
): BrowserLink | null {
	if (process.platform === "win32") return null;
	const basePath = options.basePath ?? process.env.PATH ?? "";
	const findReal = options.real ?? realCommand;
	const dir = mkdtempSync(join(tmpdir(), "leuria-open-"));
	const bin = join(dir, "bin");
	const log = join(dir, "opened.txt");
	mkdirSync(bin);
	writeFileSync(log, "");
	for (const name of ["open", "xdg-open"]) {
		const real = findReal(name);
		if (!real) continue;
		const script = `#!/bin/sh\nfor arg in "$@"; do printf '%s\\n' "$arg" >> '${log}'; done\nexec '${real}' "$@"\n`;
		writeFileSync(join(bin, name), script);
		chmodSync(join(bin, name), 0o755);
	}
	const seen = new Set<string>();
	const timer = setInterval(() => {
		let lines: string[];
		try {
			lines = readFileSync(log, "utf-8").split("\n");
		} catch {
			return;
		}
		for (const line of lines) {
			if (/^https?:\/\//.test(line) && !seen.has(line)) {
				seen.add(line);
				onUrl(line);
			}
		}
	}, 300);
	return {
		env: { PATH: `${bin}${delimiter}${basePath}` },
		stop() {
			clearInterval(timer);
			rmSync(dir, { recursive: true, force: true });
		},
	};
}
