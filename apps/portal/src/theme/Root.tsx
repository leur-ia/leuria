import { LeuriaProvider } from "@leuria/react";
import type { ReactNode } from "react";

import { useSite } from "../site.store";

/** The site's Leuria client for every component, once it has started. */
export default function Root({ children }: { children: ReactNode }): ReactNode {
	const ai = useSite((s) => s.ai);
	return ai ? <LeuriaProvider client={ai}>{children}</LeuriaProvider> : children;
}
