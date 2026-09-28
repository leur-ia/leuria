import Link from "@docusaurus/Link";
import CodeBlock from "@theme/CodeBlock";
import Layout from "@theme/Layout";
import type { ReactNode } from "react";

import styles from "./index.module.css";

const SNIPPET = `import { createLeuria, bridge, browserAI, defineTool } from "@leuria/client"

// The visitor's own AI first, then the browser's model.
const ai = createLeuria({ providers: [bridge({ app: "My shop" }), browserAI()] })

const searchProducts = defineTool({
  name: "search_products",
  description: "Search products. Returns name, price and stock.",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
  execute: ({ query }) => catalog.search(query), // runs in the page
})

const convo = ai.conversation({ tools: [searchProducts] })
for await (const event of convo.send("Which mug is cheapest?")) {
  if (event.type === "text-delta") answer.textContent += event.text
}`;

const DOCUSAURUS = `npm install @leuria/docusaurus

// docusaurus.config.js
plugins: [["@leuria/docusaurus", { suggestions: ["How do I get started?"] }]]`;

const POINTS = [
	{
		title: "Your visitors' AI, not your bill",
		text: "ChatGPT through Codex, Claude Code, a model in LM Studio or Ollama: Leuria answers with the AI the visitor already has. You hold no keys and pay for no tokens.",
	},
	{
		title: "Your code stays in the page",
		text: "The AI can only call the tools your page gives it. It can't read the visitor's files or run commands, and the visitor approves each site once.",
	},
	{
		title: "Something always answers",
		text: "No Leuria? The browser's own model, a small model in the page, or your server take over. One API for all of them, one Connect button to bring the visitor's AI back.",
	},
];

const DEMOS_URL = "https://demo.leuria.dev";

const DEMOS = [
	{
		path: "shop/",
		title: "Kiln & Co.",
		text: "A mug shop whose assistant looks up prices and stock with the page's own tools, and fills in an order form from a free-text message.",
	},
	{
		path: "notes/",
		title: "Maren's notebook",
		text: "A digital garden to search by meaning, with related notes and answers drawn from the notes, linked to them.",
	},
	{
		path: "dex/",
		title: "Hollowmark",
		text: "A guide to 48 original creatures: describe one in your own words to find it, and have the AI build a team.",
	},
];

function askAbout(question: string): void {
	void import("@leuria/docs").then(({ openAsk }) => openAsk(question));
}

export default function Home(): ReactNode {
	return (
		<Layout title="Bring your own AI to the web" description="Leuria lets a website offer AI features that run on the visitor's own AI, instead of the site's API keys.">
			<main className={styles.page}>
				<section className={styles.hero}>
					<p className={styles.eyebrow}>Developer portal</p>
					<h1 className={styles.title}>AI features that run on your visitors' own AI</h1>
					<p className={styles.lead}>
						Write an AI feature once. Leuria runs it on the AI each visitor already has, keeps your tools in the page, and falls back when they have none.
					</p>
					<div className={styles.actions}>
						<Link className={styles.ink} to="/docs/developers/quickstart">
							Get started
						</Link>
						<button type="button" className={styles.soft} onClick={() => askAbout("What is Leuria, and how do I add it to my site?")}>
							Ask these docs with your AI
						</button>
					</div>
				</section>

				<section className={styles.points}>
					{POINTS.map((point) => (
						<div key={point.title} className={styles.point}>
							<h2>{point.title}</h2>
							<p>{point.text}</p>
						</div>
					))}
				</section>

				<section className={styles.demos}>
					<div className={styles.demosHead}>
						<h2>See it on real websites</h2>
						<a href={DEMOS_URL}>All the demos →</a>
					</div>
					<div className={styles.demoGrid}>
						{DEMOS.map((demo) => (
							<a key={demo.path} className={styles.demo} href={`${DEMOS_URL}/${demo.path}`}>
								<h3>{demo.title}</h3>
								<p>{demo.text}</p>
							</a>
						))}
					</div>
				</section>

				<section className={styles.split}>
					<div>
						<h2>A few lines in the page</h2>
						<p>
							A provider cascade, tools that run in the page, conversations that move to a better AI when the visitor connects one. Structured output and search by meaning come
							with it.
						</p>
						<Link to="/docs/developers/examples">Run the examples with your AI →</Link>
					</div>
					<CodeBlock language="ts">{SNIPPET}</CodeBlock>
				</section>

				<section className={styles.split}>
					<div>
						<h2>Ask AI for your Docusaurus site</h2>
						<p>
							One plugin gives your docs an assistant that answers from your pages, with links, on each reader's own AI. It sits next to your search, and offers the same tools to the
							browser's own agents. This site runs it: try <strong>Ask AI</strong> at the top.
						</p>
						<Link to="/docs/developers/docusaurus">Add it to your site →</Link>
					</div>
					<CodeBlock language="js">{DOCUSAURUS}</CodeBlock>
				</section>
			</main>
		</Layout>
	);
}
