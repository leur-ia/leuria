import { useEffect } from "react";

import { Icon } from "./Icon";

export interface ToastMessage {
	tone: "live" | "pending" | "blocked" | "info";
	title: string;
	description?: string;
}

/**
 * One toast at a time. Results in past tense ("Connected"); success
 * dismisses itself after 4 s, problems stay until closed.
 */
export function Toast({ message, onClose }: { message: ToastMessage | null; onClose: () => void }) {
	useEffect(() => {
		if (!message || message.tone === "blocked") return;
		const timer = setTimeout(onClose, 4000);
		return () => clearTimeout(timer);
	}, [message, onClose]);
	if (!message) return null;
	const icon = message.tone === "live" ? "check" : message.tone === "blocked" || message.tone === "pending" ? "alert" : "info";
	return (
		<div className={`pearl-toast pearl-tone-${message.tone === "info" ? "idle" : message.tone}`} role={message.tone === "blocked" ? "alert" : "status"}>
			<span style={{ color: "var(--t-solid)", marginTop: 1 }}>
				<Icon name={icon} />
			</span>
			<div style={{ flex: 1, minWidth: 0 }}>
				<div className="pearl-toast-title">{message.title}</div>
				{message.description && <div className="pearl-toast-desc">{message.description}</div>}
			</div>
			<button type="button" onClick={onClose} aria-label="Close" style={{ all: "unset", cursor: "pointer", color: "var(--text-muted)", padding: 4, margin: -4 }}>
				<Icon name="x" size={16} />
			</button>
		</div>
	);
}
