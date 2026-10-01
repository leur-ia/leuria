import type { Leuria } from "@leuria/client";
import { createContext, type ReactNode, useContext } from "react";

const LeuriaContext = createContext<Leuria | null>(null);

/**
 * Makes a Leuria client available to the hooks below it. Create the
 * client once, outside render:
 *
 *   const ai = createAI({ providers: [leuria({ app: "Mug shop" }), promptAPI()] })
 *   <LeuriaProvider client={ai}><App /></LeuriaProvider>
 */
export function LeuriaProvider({ client, children }: { client: Leuria; children?: ReactNode }) {
	return <LeuriaContext.Provider value={client}>{children}</LeuriaContext.Provider>;
}

/** The client given to the nearest `LeuriaProvider`. */
export function useLeuria(): Leuria {
	const client = useContext(LeuriaContext);
	if (!client) throw new Error("useLeuria() needs a <LeuriaProvider client={…}> above it.");
	return client;
}
