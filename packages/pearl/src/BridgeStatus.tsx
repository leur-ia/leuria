import type { ReactNode } from "react";

export type BridgeState = "connected" | "pending" | "blocked" | "idle";

const DEFAULTS: Record<BridgeState, { tone: string; label: string }> = {
	connected: { tone: "live", label: "Connected" },
	pending: { tone: "pending", label: "Waiting for your approval" },
	blocked: { tone: "blocked", label: "Not connected" },
	idle: { tone: "idle", label: "Off" },
};

/** The bridge's live state: a dot and a plain label, the only place status colour is spent. */
export function BridgeStatus({ state, size = 2, children }: { state: BridgeState; size?: 1 | 2; children?: ReactNode }) {
	const { tone, label } = DEFAULTS[state];
	return (
		<span className={`pearl-status pearl-tone-${tone}${size === 1 ? " pearl-status-s1" : ""}`} role="status" aria-live="polite">
			<span className="pearl-dot" aria-hidden />
			<span>{children ?? label}</span>
		</span>
	);
}
