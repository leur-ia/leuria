import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

type SidebarItems = Extract<SidebarsConfig[string], unknown[]>;

// Written by docusaurus-plugin-typedoc when the site starts or builds. Its
// ids are relative to the main docs folder; this docs instance is api/.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const typedoc = require("./api/typedoc-sidebar.cjs");

type Item = { type: string; id?: string; link?: { type: string; id?: string }; items?: Item[] };
const localId = (id: string) => id.replace(/^(\.\.\/)*api\//, "");
const local = (items: Item[]): Item[] =>
	items.map((item) => ({
		...item,
		...(item.id ? { id: localId(item.id) } : {}),
		...(item.link?.id ? { link: { ...item.link, id: localId(item.link.id) } } : {}),
		...(item.items ? { items: local(item.items) } : {}),
	}));

const sidebars: SidebarsConfig = {
	api: [{ type: "doc", id: "index", label: "Overview" }, ...(local(typedoc.items ?? typedoc) as SidebarItems)],
};

export default sidebars;
