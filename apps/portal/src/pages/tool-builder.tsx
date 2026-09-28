import Link from "@docusaurus/Link";
import type { JsonSchema } from "@leuria/client";
import { useChat } from "@leuria/react";
import CodeBlock from "@theme/CodeBlock";
import Layout from "@theme/Layout";
import { type ReactNode, useState } from "react";

import { useSite } from "../site.store";
import styles from "./tool-builder.module.css";

/** What the model fills in: a tool, described. */
const TOOL: JsonSchema = {
	type: "object",
	properties: {
		name: { type: "string", description: "snake_case, a verb first, e.g. search_orders" },
		description: { type: "string", description: "One or two sentences for the model: what it does and what it returns." },
		parameters: {
			type: "array",
			items: {
				type: "object",
				properties: {
					name: { type: "string", description: "camelCase" },
					type: { type: "string", enum: ["string", "number", "integer", "boolean"] },
					description: { type: "string" },
					required: { type: "boolean" },
				},
				required: ["name", "type", "description", "required"],
			},
		},
		readOnly: { type: "boolean", description: "True when the tool only reads (searching, looking up); false when it changes something." },
		returns: { type: "string", description: "What the tool returns, in a few words." },
	},
	required: ["name", "description", "parameters", "readOnly", "returns"],
};

interface Tool {
	name: string;
	description: string;
	parameters: Array<{ name: string; type: "string" | "number" | "integer" | "boolean"; description: string; required: boolean }>;
	readOnly: boolean;
	returns: string;
}

const SYSTEM = [
	"You design tools that a website gives to an AI assistant, with Leuria.",
	"From the developer's description, name the tool, describe it for the model, and list its parameters.",
	"Keep parameters few and simple. Values the page already knows (the signed-in user, the current account) are not parameters: they come from the turn's context.",
].join("\n");

const EXAMPLES = [
	"Search the shop's products by words or colour, and return name, price and stock",
	"Add a product to the visitor's cart, with a quantity",
	"Find the visitor's past orders between two dates",
];

const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const tsType = (type: string) => (type === "integer" ? "number" : type);

/** The tool as `defineTool` code. */
function code(tool: Tool): string {
	const params = tool.parameters;
	const argsType = params.length ? `{ ${params.map((p) => `${p.name}${p.required ? "" : "?"}: ${tsType(p.type)}`).join("; ")} }` : "Record<string, never>";
	const properties = params.map((p) => `      ${p.name}: { type: "${p.type}", description: ${JSON.stringify(p.description)} },`).join("\n");
	const required = params.filter((p) => p.required).map((p) => `"${p.name}"`);
	const destructured = params.length ? `{ ${params.map((p) => p.name).join(", ")} }` : "_args";
	return `import { defineTool } from "@leuria/client"

export const ${camel(tool.name)} = defineTool<${argsType}>({
  name: "${tool.name}",
  description: ${JSON.stringify(tool.description)},
  inputSchema: {
    type: "object",
    properties: {
${properties}
    },${required.length ? `\n    required: [${required.join(", ")}],` : ""}
  },
  annotations: { ${tool.readOnly ? "readOnlyHint: true" : "consequentialHint: true"} },
  // Runs in the page. Returns ${tool.returns.charAt(0).toLowerCase()}${tool.returns.slice(1).replace(/\.$/, "")}.
  execute: async (${destructured}, { signal, context }) => {
    throw new Error("Not written yet")
  },
})`;
}

function Builder(): ReactNode {
	const { start, status, provider, error } = useChat();
	const [draft, setDraft] = useState("");
	const [tool, setTool] = useState<Tool | null>(null);

	const build = (text: string) => {
		const description = text.trim();
		if (!description) return;
		setTool(null);
		start<Tool>({ system: SYSTEM, prompt: description, schema: TOOL })
			.object()
			.then(setTool)
			.catch(() => undefined);
	};

	const onSubmit = (event: { preventDefault(): void }) => {
		event.preventDefault();
		build(draft);
	};

	return (
		<>
			<form className={styles.form} onSubmit={onSubmit}>
				<label htmlFor="describe" className={styles.label}>
					What should your page let the AI do?
				</label>
				<textarea id="describe" className={styles.input} rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={EXAMPLES[0]} />
				<div className={styles.row}>
					<button type="submit" className={styles.ink} disabled={status === "running" || !draft.trim()}>
						{status === "running" ? "Designing…" : "Design the tool"}
					</button>
					<span className={styles.muted}>
						<leuria-ai-status />
					</span>
				</div>
				<div className={styles.examples}>
					{EXAMPLES.map((example) => (
						<button
							key={example}
							type="button"
							className={styles.example}
							onClick={() => {
								setDraft(example);
								build(example);
							}}
						>
							{example}
						</button>
					))}
				</div>
			</form>
			{status === "error" && (
				<p className={styles.error}>
					{error?.name === "NoProviderError" ? "No AI here can do this yet. Connect your own with the button at the top of the page." : "Your AI couldn't design this one. Try again, or say it differently."}
				</p>
			)}
			{tool && (
				<section className={styles.result}>
					<p className={styles.muted}>Designed by {provider?.label ?? "your AI"}. Write the body of `execute`, then give the tool to a conversation.</p>
					<CodeBlock language="ts">{code(tool)}</CodeBlock>
				</section>
			)}
		</>
	);
}

export default function ToolBuilder(): ReactNode {
	const ai = useSite((s) => s.ai);
	return (
		<Layout title="Tool builder" description="Describe what your page should let an AI do, and get the Leuria tool for it, designed by your own AI.">
			<main className={styles.page}>
				<p className={styles.eyebrow}>Tool builder</p>
				<h1 className={styles.title}>Describe it, get the tool</h1>
				<p className={styles.lead}>
					Say what your page should let an AI do. Your own AI designs the tool: its name, what the model is told, its parameters. You write what it does. This page uses{" "}
					<Link to="/docs/developers/guides/structured-output">structured output</Link>, on your AI, not ours.
				</p>
				{ai ? <Builder /> : <p className={styles.muted}>Starting…</p>}
			</main>
		</Layout>
	);
}
