/**
 * Runs a recipe (a ```js leuria-run block from the docs) against a Leuria
 * client. The same runner serves the portal's playground and the CI test
 * that keeps every recipe working.
 *
 * A recipe is plain JavaScript with top-level await. In scope: `ai`,
 * `print(value)` and `signal`. Imports are named imports from the
 * packages below, one statement per line.
 */

import type { ChatEvent, Leuria } from "@leuria/client";

export type Modules = Record<string, Record<string, unknown>>;

export interface RunOptions {
	ai: Leuria;
	/** The packages recipes may import from. */
	modules: Modules;
	print: (value: unknown) => void;
	/** Every event of the recipe's requests, for the trace. */
	onEvent?: (event: ChatEvent) => void;
	signal?: AbortSignal;
}

const IMPORT = /^\s*import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?\s*$/gm;

/** The recipe as a function body: imports become lookups in `__modules`. */
export function compile(code: string, modules: Modules): string {
	return code.replace(IMPORT, (_line, names: string, from: string) => {
		if (!modules[from]) throw new Error(`Recipes can import from ${Object.keys(modules).join(" and ")}, not ${from}.`);
		const bindings = names
			.split(",")
			.map((name) => name.trim())
			.filter(Boolean)
			.map((name) => name.replace(/\s+as\s+/, ": "));
		return `const { ${bindings.join(", ")} } = __modules[${JSON.stringify(from)}];`;
	});
}

type AsyncFn = new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as AsyncFn;

export async function run(code: string, { ai, modules, print, onEvent, signal }: RunOptions): Promise<void> {
	const body = compile(code, modules);
	const stop = onEvent ? ai.on(onEvent) : undefined;
	try {
		await new AsyncFunction("ai", "print", "signal", "__modules", body)(ai, print, signal ?? new AbortController().signal, modules);
	} finally {
		stop?.();
	}
}

/** Every runnable block in a Markdown page. */
export function recipes(markdown: string): string[] {
	const found: string[] = [];
	const fence = /^```js[^\n]*\bleuria-run\b[^\n]*\n([\s\S]*?)^```\s*$/gm;
	for (const match of markdown.matchAll(fence)) found.push(match[1]!);
	return found;
}
