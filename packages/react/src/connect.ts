import { type Connection, type ConnectionState, connection } from "@leuria/client";

import { useLeuria } from "./context.js";
import { useSelector } from "./store.js";

export type UseConnect = ConnectionState & Omit<Connection, "getState" | "subscribe">;

const whole = (state: ConnectionState) => state;

/**
 * The connect flow of one provider, by default the visitor's own AI
 * through Leuria (`connection()` from `@leuria/client`): shared with every
 * other component and with Leuria's Connect UI on the page.
 */
export function useConnect(providerId = "bridge"): UseConnect {
	const flow = connection(useLeuria(), providerId);
	const state = useSelector(flow.subscribe, flow.getState, whole);
	return { ...state, connect: flow.connect, disconnect: flow.disconnect, retry: flow.retry, chooseInstead: flow.chooseInstead, manage: flow.manage, canManage: flow.canManage };
}
