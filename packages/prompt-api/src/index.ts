/**
 * @leuria/prompt-api: the Prompt API (`LanguageModel`) where the browser
 * can't run it, served by the visitor's own AI through Leuria.
 *
 *   import { installPromptAPI } from "@leuria/prompt-api"
 *
 *   await installPromptAPI({ app: "My notes" })
 *   if ((await LanguageModel.availability()) !== "unavailable") {
 *     const session = await LanguageModel.create()   // from a click, the first time
 *     console.log(await session.prompt("Summarize this note: …"))
 *   }
 */

import { createLanguageModel, LEURIA_MARK, type PromptAPIOptions } from "./language-model.js";

export { createLanguageModel, LEURIA_MARK } from "./language-model.js";
export type {
	Availability,
	LanguageModel,
	LanguageModelAppendOptions,
	LanguageModelCloneOptions,
	LanguageModelConstructor,
	LanguageModelCreateCoreOptions,
	LanguageModelCreateOptions,
	LanguageModelExpected,
	LanguageModelPromptOptions,
	LanguageModelSamplingMode,
	LanguageModelTool,
	PromptAPIOptions,
} from "./language-model.js";
export type {
	LanguageModelMessage,
	LanguageModelMessageContent,
	LanguageModelMessageRole,
	LanguageModelMessageType,
	LanguageModelPrompt,
} from "./content.js";
export type { ResponseConstraint } from "./constraint.js";

export interface InstallOptions extends PromptAPIOptions {
	/**
	 * When Leuria provides `LanguageModel`:
	 * - `"unavailable"` (default): where the browser has none, or has one
	 *   that can't run on this device. The browser's own model is used
	 *   wherever it can run, even if it must download first.
	 * - `"missing"`: only where the browser has none.
	 * - `"always"`: always, in place of the browser's.
	 */
	when?: "unavailable" | "missing" | "always";
}

/**
 * Define `globalThis.LanguageModel` with Leuria, unless the browser's own
 * model serves (see `when`). Resolves with who answers: `"browser"` or
 * `"leuria"`.
 */
export async function installPromptAPI(options: InstallOptions = {}): Promise<"browser" | "leuria"> {
	const { when = "unavailable", ...rest } = options;
	const scope = globalThis as { LanguageModel?: { availability?: () => Promise<string>; [LEURIA_MARK]?: boolean } };
	const native = scope.LanguageModel;
	if (native && !native[LEURIA_MARK] && when !== "always") {
		if (when === "missing") return "browser";
		const availability = await Promise.resolve(native.availability?.()).catch(() => "unavailable");
		if (availability !== "unavailable") return "browser";
	}
	Object.defineProperty(globalThis, "LanguageModel", {
		value: createLanguageModel(rest),
		writable: true,
		configurable: true,
		enumerable: false,
	});
	return "leuria";
}
