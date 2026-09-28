import type { WrapperProps } from "@docusaurus/types";
import type CodeBlockType from "@theme/CodeBlock";
import CodeBlock from "@theme-original/CodeBlock";
import type { ReactNode } from "react";

import Playground from "../../components/Playground";

type Props = WrapperProps<typeof CodeBlockType>;

/** ```js leuria-run blocks become playgrounds: run them with your own AI. */
export default function CodeBlockWrapper(props: Props): ReactNode {
	if (!props.metastring?.split(/\s+/).includes("leuria-run") || typeof props.children !== "string") return <CodeBlock {...props} />;
	return <Playground code={props.children} />;
}
