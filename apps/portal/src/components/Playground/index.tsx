import type { ChatEvent } from "@leuria/client";
import CodeBlock from "@theme-original/CodeBlock";
import { type ReactNode, useRef, useState } from "react";

import { run } from "../../playground/run";
import { useSite } from "../../site.store";
import styles from "./styles.module.css";

interface Line {
	kind: "print" | "call" | "result" | "info" | "error";
	text: string;
}

const short = (value: unknown, max = 240) => {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return text && text.length > max ? `${text.slice(0, max)}…` : (text ?? "");
};

/** Words for what went wrong, without the engine's own. */
function problem(error: unknown): string {
	const name = error instanceof Error ? error.name : "";
	if (name === "NoProviderError") return "No AI here can run this yet. Connect your own with the button below, or open this page in a browser with a built-in AI.";
	if (name === "AbortError") return "Stopped.";
	if (name === "TimeoutError") return "Your AI took too long. Try again.";
	return error instanceof Error ? error.message : String(error);
}

/** A recipe you can edit and run on your own AI, with what happened along the way. */
export default function Playground({ code: initial }: { code: string }): ReactNode {
	const ai = useSite((s) => s.ai);
	// UI-only state: this block's draft and output.
	const [code, setCode] = useState(initial.trimEnd());
	const [editing, setEditing] = useState(false);
	const [lines, setLines] = useState<Line[]>([]);
	const [running, setRunning] = useState(false);
	const [needsAI, setNeedsAI] = useState(false);
	const abort = useRef<AbortController | null>(null);

	const add = (line: Line) => setLines((all) => [...all, line]);

	const onEvent = (event: ChatEvent) => {
		if (event.type === "start") add({ kind: "info", text: `Answering with ${event.provider.label}` });
		else if (event.type === "tool-call") add({ kind: "call", text: `${event.name}(${short(event.args, 160)})` });
		else if (event.type === "tool-input") add({ kind: "info", text: `${event.name} waits for you` });
		else if (event.type === "tool-result") add({ kind: event.error ? "error" : "result", text: event.error ?? short(event.result) });
	};

	const start = async () => {
		if (!ai || running) return;
		const controller = new AbortController();
		abort.current = controller;
		setLines([]);
		setNeedsAI(false);
		setRunning(true);
		const began = performance.now();
		try {
			const [client, store] = await Promise.all([import("@leuria/client"), import("@leuria/store")]);
			await run(code, {
				ai,
				modules: { "@leuria/client": client, "@leuria/store": store },
				print: (value) => add({ kind: "print", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }),
				onEvent,
				signal: controller.signal,
			});
			add({ kind: "info", text: `Done in ${((performance.now() - began) / 1000).toFixed(1)} s` });
		} catch (error) {
			setNeedsAI(error instanceof Error && error.name === "NoProviderError");
			add({ kind: "error", text: problem(error) });
		} finally {
			setRunning(false);
			abort.current = null;
		}
	};

	return (
		<div className={styles.playground}>
			{editing ? (
				<textarea
					className={styles.editor}
					value={code}
					spellCheck={false}
					aria-label="Recipe code"
					rows={Math.min(30, code.split("\n").length + 1)}
					onChange={(event) => setCode(event.target.value)}
				/>
			) : (
				<CodeBlock language="js">{code}</CodeBlock>
			)}
			<div className={styles.bar}>
				{running ? (
					<button type="button" className={styles.run} onClick={() => abort.current?.abort()}>
						Stop
					</button>
				) : (
					<button type="button" className={styles.run} onClick={start} disabled={!ai}>
						Run with your AI
					</button>
				)}
				<button type="button" className={styles.quiet} onClick={() => setEditing(!editing)}>
					{editing ? "Done" : "Edit"}
				</button>
				{code !== initial.trimEnd() && (
					<button type="button" className={styles.quiet} onClick={() => setCode(initial.trimEnd())}>
						Reset
					</button>
				)}
				<span className={styles.status}>
					<leuria-ai-status />
				</span>
			</div>
			{lines.length > 0 && (
				<div className={styles.output} aria-live="polite">
					{lines.map((line, i) => (
						<div key={i} className={styles[line.kind]}>
							{line.text}
						</div>
					))}
					{needsAI && <leuria-connect-button size="1" />}
				</div>
			)}
		</div>
	);
}
