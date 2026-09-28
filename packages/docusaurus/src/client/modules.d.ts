// Modules the plugin generates for each site (see configureWebpack), and
// the one Docusaurus module the client uses.
declare module "@leuria-docusaurus/config" {
	const config: unknown;
	export default config;
}
declare module "@leuria-docusaurus/corpus" {
	import type { DocsCorpus } from "@leuria/docs";
	const corpus: DocsCorpus;
	export default corpus;
}
declare module "@leuria-docusaurus/embedder" {
	import type { Provider } from "@leuria/client";
	const load: (() => Promise<Provider>) | null;
	export default load;
}
declare module "@docusaurus/ExecutionEnvironment" {
	const ExecutionEnvironment: { canUseDOM: boolean };
	export default ExecutionEnvironment;
}
