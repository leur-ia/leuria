import { FONT_FAMILY } from "./fonts.js";

/*
 * The Connect UI on Pearl's tokens (./tokens.ts), inside each element's
 * shadow root. `.root` starts from `all: initial` so nothing inherited from
 * the host page (font, colour, letter-spacing, text-transform…) changes it.
 * Host pages may position and size the elements, not recolour them
 * (design system, ConnectButton).
 */
export const styles = /* css */ `
:host { display: inline-flex; vertical-align: middle; }
:host([hidden]) { display: none; }
* , *::before, *::after { box-sizing: border-box; }

.root {
	all: initial;
	display: inline-flex;
	font-family: "${FONT_FAMILY}", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
	font-size: 14px;
	line-height: 20px;
	color: var(--text);
	-webkit-font-smoothing: antialiased;
}
button, a { font: inherit; }

/* ---------- Dot, spinner ---------- */
.dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	flex-shrink: 0;
	background: var(--t-solid, var(--pearl-9));
	box-shadow: 0 0 0 3px color-mix(in srgb, var(--t-solid, var(--pearl-9)) 22%, transparent);
}
.tone-live { --t-solid: var(--live); --t-soft: var(--live-soft); --t-text: var(--live-text); }
.tone-pending { --t-solid: var(--pending); --t-soft: var(--pending-soft); --t-text: var(--pending-text); }
.tone-blocked { --t-solid: var(--blocked); --t-soft: var(--blocked-soft); --t-text: var(--blocked-text); }
.tone-idle { --t-solid: var(--pearl-9); --t-soft: var(--pearl-3); --t-text: var(--text-muted); }

.spinner {
	width: 16px;
	height: 16px;
	flex-shrink: 0;
	border-radius: 50%;
	border: 2px solid currentColor;
	border-right-color: transparent;
	animation: spin 700ms linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.mark { display: block; flex-shrink: 0; color: var(--ink); }
/* The mark with its status dot at the bottom right, cut out of whatever is behind. */
.status-mark { position: relative; display: block; flex-shrink: 0; }
.status-mark .dot {
	position: absolute;
	right: -2px;
	bottom: -1px;
	width: 9px;
	height: 9px;
	box-shadow: 0 0 0 2px var(--status-ring, var(--surface));
}

/* ---------- Connect button: one translucent pill per page ---------- */
.connect {
	all: unset;
	box-sizing: border-box;
	display: inline-flex;
	align-items: center;
	gap: 10px;
	height: var(--target-primary);
	padding: 0 var(--space-5) 0 var(--space-3);
	border-radius: var(--radius-full);
	background: var(--surface-translucent);
	color: var(--ink);
	box-shadow: inset 0 0 0 1px var(--border), var(--shadow-3);
	-webkit-backdrop-filter: blur(12px) saturate(1.2);
	backdrop-filter: blur(12px) saturate(1.2);
	font-size: 15px;
	font-weight: 700;
	line-height: 1;
	letter-spacing: -0.01em;
	white-space: nowrap;
	cursor: pointer;
	transition: box-shadow var(--timing-fast) var(--easing-standard), transform var(--timing-instant) var(--easing-standard);
}
.connect:hover { box-shadow: inset 0 0 0 1px var(--border-strong), var(--shadow-4); }
.connect:active { transform: translateY(1px); }
.connect[aria-busy="true"] { cursor: progress; }
.connect.s3 { height: 56px; font-size: 17px; padding: 0 28px 0 14px; }
/* Compact, for navigation bars. */
.connect.s1 { height: 36px; gap: 8px; font-size: 14px; padding: 0 var(--space-4) 0 var(--space-2); box-shadow: inset 0 0 0 1px var(--border), var(--shadow-1); }
.connect.s1:hover { box-shadow: inset 0 0 0 1px var(--border-strong), var(--shadow-2); }
.connect.s1 .by { font-size: 12px; }
/* Start aligned with the mark when there is one, with the dot or spinner otherwise. */
.connect:not(:has(.mark)) { padding-left: var(--space-4); }
.by { font-weight: 500; font-size: 13px; color: var(--text-muted); }
.by::before { content: "·"; margin-right: 10px; }
.connect.pending { color: var(--pending-text); }
.connect.checking { color: var(--text-muted); }
.connect.declined .label { color: var(--blocked-text); }
.chevron { display: flex; margin-left: -2px; color: var(--text-muted); }

/* ---------- Buttons (dialog actions) ---------- */
.btn {
	all: unset;
	box-sizing: border-box;
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: var(--space-2);
	height: var(--target-primary);
	padding: 0 var(--space-5);
	border-radius: var(--radius-full);
	font-size: 15px;
	font-weight: 600;
	line-height: 1;
	white-space: nowrap;
	cursor: pointer;
	transition: background-color var(--timing-instant) var(--easing-standard);
}
.btn:active { transform: translateY(1px); }
.btn-ink { background: var(--ink); color: var(--on-ink); }
.btn-ink:hover { background: var(--ink-hover); }
.btn-ghost { background: transparent; color: var(--pearl-12); }
.btn-ghost:hover { background: var(--pearl-3); }

.connect:focus-visible, .btn:focus-visible, .badge:focus-visible, .close:focus-visible, .item:focus-visible {
	outline: 2px solid var(--focus);
	outline-offset: 2px;
}

/* ---------- Status: dot and words, never colour alone ---------- */
.status {
	--status-ring: var(--t-soft);
	display: inline-flex;
	align-items: center;
	gap: var(--space-2);
	height: 28px;
	padding: 0 var(--space-3);
	border-radius: var(--radius-full);
	background: var(--t-soft);
	color: var(--t-text);
	font-size: 13px;
	font-weight: 600;
	line-height: 1;
	white-space: nowrap;
}

/* ---------- Menu (connected): a popover, placed under the button ---------- */
.menu {
	position: fixed;
	inset: auto;
	margin: 0;
	border: 0;
	min-width: 260px;
	max-width: min(320px, calc(100vw - 32px));
	padding: var(--space-2);
	border-radius: var(--radius-4);
	background: var(--surface);
	color: var(--text);
	box-shadow: var(--shadow-4);
	font: inherit;
}
.menu:popover-open { animation: pop var(--timing-fast) var(--easing-standard); }
.menu-head { display: flex; gap: var(--space-3); padding: var(--space-2) var(--space-3) var(--space-3); }
.menu-head .status-mark { align-self: flex-start; margin-top: 1px; }
.menu-foot {
	display: flex;
	align-items: baseline;
	justify-content: flex-end;
	gap: 5px;
	margin: var(--space-1) var(--space-3) 0;
	padding-top: var(--space-2);
	border-top: 1px solid var(--border);
	font-size: 12px;
	color: var(--text-muted);
}
.menu-foot .wordmark { font-size: 13px; }
.menu-title { font-size: 14px; font-weight: 700; }
.menu-desc { margin-top: 2px; font-size: 13px; line-height: 18px; color: var(--text-muted); }
.sep { height: 1px; margin: 0 var(--space-2) var(--space-2); background: var(--border); }
.item {
	all: unset;
	box-sizing: border-box;
	display: flex;
	align-items: center;
	width: 100%;
	min-height: 40px;
	padding: 0 var(--space-3);
	border-radius: var(--radius-3);
	font-size: 14px;
	font-weight: 600;
	cursor: pointer;
}
.item[hidden] { display: none; }
.item:hover, .item:focus-visible { background: var(--pearl-3); }
.item-danger { color: var(--blocked-text); }
.item-danger:hover, .item-danger:focus-visible { background: var(--blocked-soft); }
@keyframes pop { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

/* ---------- Dialog: getting Leuria ---------- */
.dialog {
	width: 440px;
	max-width: calc(100vw - 32px);
	padding: 0;
	border: 0;
	border-radius: var(--radius-5);
	background: var(--surface);
	color: var(--text);
	box-shadow: var(--shadow-5);
	font: inherit;
	overflow: visible;
}
.dialog[open] { animation: rise var(--timing-base) var(--easing-standard); }
.dialog::backdrop { background: rgba(20, 23, 43, 0.36); animation: fade var(--timing-base) var(--easing-standard); }
.dialog-body { position: relative; display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-6); }
.dialog-title { margin: var(--space-2) 0 0; font-size: 24px; line-height: 30px; font-weight: 700; letter-spacing: -0.02em; text-wrap: balance; }
.dialog-desc { margin: 0; font-size: 15px; line-height: 22px; color: var(--text-muted); }
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-3); padding-top: var(--space-4); }
.close {
	all: unset;
	position: absolute;
	top: var(--space-4);
	right: var(--space-4);
	display: grid;
	place-items: center;
	width: 36px;
	height: 36px;
	border-radius: var(--radius-full);
	color: var(--text-muted);
	cursor: pointer;
}
.close:hover { background: var(--pearl-3); color: var(--text); }
.steps { display: flex; flex-direction: column; gap: var(--space-3); margin: var(--space-2) 0 0; padding: 0; list-style: none; counter-reset: step; }
.steps li { display: flex; align-items: flex-start; gap: var(--space-3); font-size: 15px; line-height: 22px; counter-increment: step; }
.steps li::before {
	content: counter(step);
	display: grid;
	place-items: center;
	flex-shrink: 0;
	width: 24px;
	height: 24px;
	border-radius: 50%;
	background: var(--pearl-3);
	color: var(--pearl-12);
	font-size: 13px;
	font-weight: 700;
	line-height: 1;
}
.dialog-note { margin: var(--space-2) 0 0; font-size: 14px; line-height: 20px; color: var(--text-muted); }
/* The alternatives: secondary, small, below the actions. */
.instead { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: var(--space-2); font-size: 13px; line-height: 18px; color: var(--text-muted); }
.instead[hidden] { display: none; }
.link { all: unset; color: var(--accent-text); font-weight: 600; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.link:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes rise { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }

/* ---------- Badge: the footer link back to Leuria ---------- */
.badge {
	all: unset;
	box-sizing: border-box;
	display: inline-flex;
	align-items: center;
	gap: var(--space-2);
	min-height: 32px;
	padding: 0 var(--space-3);
	border-radius: var(--radius-full);
	background: var(--surface-translucent);
	box-shadow: inset 0 0 0 1px var(--border);
	font-size: 12px;
	font-weight: 600;
	line-height: 1;
	color: var(--text-muted);
	cursor: pointer;
}
.badge:hover { color: var(--text); box-shadow: inset 0 0 0 1px var(--border-strong); }
.wordmark { font-weight: 800; font-size: 14px; letter-spacing: -0.04em; color: var(--ink); }

@media (prefers-reduced-motion: reduce) {
	.spinner { animation-duration: 2s; }
	.connect, .btn { transition: none; }
	.dialog[open], .dialog::backdrop, .menu:popover-open { animation: none; }
}
`;
