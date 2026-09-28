/*
 * The Ask panel and button, on Pearl's tokens, added to the Connect UI's
 * styles in each element's shadow root. The panel is a popover: it sits
 * above the page (top layer) whatever the page's own stacking.
 */
export const askStyles = /* css */ `
.ask-root { display: contents; }

/* ---------- Button ---------- */
.ask-button {
	all: unset;
	box-sizing: border-box;
	display: inline-flex;
	align-items: center;
	gap: var(--space-2);
	height: 36px;
	padding: 0 var(--space-4) 0 var(--space-3);
	border-radius: var(--radius-full);
	background: var(--surface-translucent);
	color: var(--ink);
	box-shadow: inset 0 0 0 1px var(--border), var(--shadow-1);
	font-size: 14px;
	font-weight: 700;
	line-height: 1;
	white-space: nowrap;
	cursor: pointer;
	transition: box-shadow var(--timing-fast) var(--easing-standard);
}
.ask-button:hover { box-shadow: inset 0 0 0 1px var(--border-strong), var(--shadow-2); }
.ask-button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.ask-button svg { color: var(--accent-text); }
.ask-button.floating {
	position: fixed;
	right: max(var(--space-5), env(safe-area-inset-right));
	bottom: max(var(--space-5), env(safe-area-inset-bottom));
	z-index: 200;
	height: var(--target-primary);
	padding: 0 var(--space-5) 0 var(--space-4);
	font-size: 15px;
	box-shadow: inset 0 0 0 1px var(--border), var(--shadow-3);
	-webkit-backdrop-filter: blur(12px) saturate(1.2);
	backdrop-filter: blur(12px) saturate(1.2);
}

/* ---------- Panel ---------- */
/* Sites move it below their own header with --leuria-ask-top. */
.ask {
	position: fixed;
	inset: var(--leuria-ask-top, var(--space-3)) var(--space-3) var(--space-3) auto;
	width: min(440px, calc(100vw - 2 * var(--space-3)));
	height: auto;
	margin: 0;
	padding: 0;
	border: 0;
	border-radius: var(--radius-5);
	background: var(--surface);
	color: var(--text);
	box-shadow: inset 0 0 0 1px var(--border), var(--shadow-5);
	font: inherit;
	overflow: hidden;
	flex-direction: column;
}
.ask { display: none; }
.ask.open { display: flex; animation: slide var(--timing-base) var(--easing-standard); }
@keyframes slide { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: none; } }
@media (max-width: 640px) {
	.ask { inset: 0; width: 100vw; border-radius: 0; }
}

.ask-head { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4) var(--space-4) var(--space-3) var(--space-5); border-bottom: 1px solid var(--border); }
.ask-title-row { display: flex; align-items: center; gap: var(--space-2); }
.ask-title { flex: 1; margin: 0 0 0 var(--space-1); font-size: 17px; line-height: 24px; font-weight: 700; letter-spacing: -0.01em; color: var(--ink); }
.icon-btn {
	all: unset;
	display: grid;
	place-items: center;
	width: 36px;
	height: 36px;
	border-radius: var(--radius-full);
	color: var(--text-muted);
	cursor: pointer;
}
.icon-btn:hover { background: var(--pearl-3); color: var(--text); }
.icon-btn:focus-visible, .suggestion:focus-visible, .send:focus-visible, .chip-x:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

.ask-thread { flex: 1; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5); }
.ask-empty p { margin: 0; font-size: 15px; line-height: 22px; color: var(--text-muted); }
.ask-suggestions { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); margin-top: var(--space-4); }
.suggestion {
	all: unset;
	box-sizing: border-box;
	max-width: 100%;
	padding: var(--space-2) var(--space-3);
	border-radius: var(--radius-3);
	background: var(--accent-soft);
	color: var(--accent-text);
	font-size: 14px;
	font-weight: 600;
	line-height: 20px;
	cursor: pointer;
}
.suggestion:hover { filter: brightness(0.97); }

.bubble { font-size: 15px; line-height: 23px; overflow-wrap: anywhere; }
.bubble.me { align-self: flex-end; max-width: 85%; padding: var(--space-2) var(--space-4); border-radius: var(--radius-4); background: var(--pearl-3); color: var(--text); white-space: pre-wrap; }
.bubble.ai > :first-child { margin-top: 0; }
.bubble.ai > :last-child { margin-bottom: 0; }
.bubble.ai p, .bubble.ai ul, .bubble.ai ol, .bubble.ai pre, .bubble.ai blockquote, .bubble.ai table { margin: 0 0 var(--space-3); }
.bubble.ai ul, .bubble.ai ol { padding-left: var(--space-5); }
.bubble.ai li + li { margin-top: var(--space-1); }
.bubble.ai h1, .bubble.ai h2, .bubble.ai h3, .bubble.ai h4 { margin: var(--space-4) 0 var(--space-2); font-size: 15px; line-height: 22px; font-weight: 700; }
.bubble.ai a, .tool-line a { color: var(--accent-text); font-weight: 600; text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; }
.bubble.ai code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; padding: 1px 5px; border-radius: var(--radius-1); background: var(--pearl-3); }
.bubble.ai pre { overflow-x: auto; padding: var(--space-3) var(--space-4); border-radius: var(--radius-3); background: var(--surface-sunken); box-shadow: inset 0 0 0 1px var(--border); }
.bubble.ai pre code { padding: 0; background: none; font-size: 13px; line-height: 20px; }
.bubble.ai blockquote { padding-left: var(--space-3); border-left: 3px solid var(--border-strong); color: var(--text-muted); }
.bubble.ai table { border-collapse: collapse; font-size: 14px; }
.bubble.ai th, .bubble.ai td { padding: var(--space-1) var(--space-2); border: 1px solid var(--border); text-align: left; }
.tool-line { font-size: 13px; line-height: 18px; color: var(--text-muted); }
.ask-wait { display: flex; align-items: center; gap: var(--space-2); font-size: 14px; color: var(--text-muted); }
.ask-wait .spinner { width: 14px; height: 14px; }
.ask-error { padding: var(--space-3) var(--space-4); border-radius: var(--radius-3); background: var(--blocked-soft); color: var(--blocked-text); font-size: 14px; font-weight: 600; }

.ask-connect { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-3); margin: 0 var(--space-4) var(--space-3); padding: var(--space-4); border-radius: var(--radius-4); background: var(--surface-sunken); box-shadow: inset 0 0 0 1px var(--border); }
.ask-connect[hidden] { display: none; }
.ask-connect p { margin: 0; font-size: 14px; line-height: 20px; color: var(--text-muted); }
.ask-connect .instead { justify-content: flex-start; }
/* An AI answers already: a line, not a box. */
.ask-connect.compact { flex-direction: row; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4); }
.ask-connect.compact p { font-size: 13px; line-height: 18px; }

.ask-composer { display: flex; flex-direction: column; gap: var(--space-2); margin: 0 var(--space-4); padding: var(--space-2); border-radius: var(--radius-4); background: var(--surface); box-shadow: inset 0 0 0 1px var(--border-control); }
.ask-composer:focus-within { box-shadow: inset 0 0 0 1px var(--focus), 0 0 0 3px color-mix(in srgb, var(--focus) 22%, transparent); }
.ask-selection { display: flex; align-items: center; gap: var(--space-1); align-self: flex-start; max-width: 100%; padding: 2px var(--space-1) 2px var(--space-3); border-radius: var(--radius-full); background: var(--accent-soft); color: var(--accent-text); font-size: 13px; font-weight: 600; }
.ask-selection[hidden] { display: none; }
.ask-selection-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip-x { all: unset; display: grid; place-items: center; width: 22px; height: 22px; border-radius: var(--radius-full); cursor: pointer; }
.chip-x:hover { background: color-mix(in srgb, var(--accent-text) 12%, transparent); }
.ask-input-row { display: flex; align-items: flex-end; gap: var(--space-2); }
.ask-composer textarea {
	all: unset;
	flex: 1;
	min-height: 24px;
	max-height: 160px;
	padding: var(--space-2) var(--space-2);
	font-size: 15px;
	line-height: 22px;
	color: var(--text);
	white-space: pre-wrap;
	overflow-y: auto;
}
.ask-composer textarea::placeholder { color: var(--text-muted); }
.send {
	all: unset;
	display: grid;
	place-items: center;
	flex-shrink: 0;
	width: 36px;
	height: 36px;
	border-radius: var(--radius-full);
	background: var(--ink);
	color: var(--on-ink);
	cursor: pointer;
}
.send:hover { background: var(--ink-hover); }
.ask-foot { margin: 0; padding: var(--space-2) var(--space-5) var(--space-3); font-size: 12px; line-height: 16px; color: var(--text-muted); text-align: center; }

@media (prefers-reduced-motion: reduce) {
	.ask:popover-open { animation: none; }
}
`;

/* The search dialog and its button, on the same tokens. */
export const searchStyles = /* css */ `
.search-root { display: contents; }

.search-button {
	all: unset;
	box-sizing: border-box;
	display: inline-flex;
	align-items: center;
	gap: var(--space-2);
	height: 36px;
	min-width: 180px;
	padding: 0 var(--space-2) 0 var(--space-3);
	border-radius: var(--radius-full);
	background: var(--surface-sunken);
	color: var(--text-muted);
	box-shadow: inset 0 0 0 1px var(--border);
	font-size: 14px;
	font-weight: 500;
	line-height: 1;
	cursor: pointer;
}
.search-button:hover { box-shadow: inset 0 0 0 1px var(--border-strong); color: var(--text); }
.search-button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.search-label { flex: 1; }
kbd {
	display: inline-flex;
	align-items: center;
	height: 22px;
	padding: 0 var(--space-2);
	border-radius: var(--radius-2);
	background: var(--surface);
	box-shadow: inset 0 0 0 1px var(--border);
	color: var(--text-muted);
	font: 600 12px/1 inherit;
	font-family: inherit;
}
@media (max-width: 996px) {
	.search-button { min-width: 0; padding: 0 var(--space-2); }
	.search-button .search-label, .search-button kbd { display: none; }
}

.search {
	width: min(680px, calc(100vw - 2 * var(--space-4)));
	max-height: min(640px, calc(100vh - 20vh));
	margin: 10vh auto auto;
	padding: 0;
	border: 0;
	border-radius: var(--radius-5);
	background: var(--surface);
	color: var(--text);
	box-shadow: inset 0 0 0 1px var(--border), var(--shadow-5);
	font: inherit;
	overflow: hidden;
	flex-direction: column;
}
.search[open] { display: flex; animation: rise var(--timing-base) var(--easing-standard); }
.search::backdrop { background: rgba(20, 23, 43, 0.36); animation: fade var(--timing-base) var(--easing-standard); }
@media (max-width: 640px) {
	.search { width: 100vw; max-width: 100vw; height: 100vh; max-height: 100vh; margin: 0; border-radius: 0; }
}

.search-field { display: flex; align-items: center; gap: var(--space-3); padding: 0 var(--space-4) 0 var(--space-5); border-bottom: 1px solid var(--border); color: var(--text-muted); }
.search-field input {
	all: unset;
	flex: 1;
	height: 60px;
	font-size: 17px;
	color: var(--text);
}
.search-field input::placeholder { color: var(--text-muted); }
.search-field input::-webkit-search-cancel-button { display: none; }

.search-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: var(--space-2); }
.search-empty { margin: 0; padding: var(--space-5) var(--space-4); font-size: 14px; line-height: 20px; color: var(--text-muted); }
.hit {
	all: unset;
	box-sizing: border-box;
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 2px;
	width: 100%;
	padding: var(--space-3) var(--space-4);
	border-radius: var(--radius-3);
	cursor: pointer;
}
.hit[aria-selected="true"], .hit:hover { background: var(--accent-soft); }
.hit-title { font-size: 15px; line-height: 22px; font-weight: 700; color: var(--ink); padding-right: 96px; }
.hit-sep { margin: 0 var(--space-2); color: var(--text-muted); font-weight: 500; }
.hit-snippet { font-size: 13px; line-height: 19px; color: var(--text-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.hit-snippet mark { background: none; color: var(--accent-text); font-weight: 700; }
.hit-via { position: absolute; top: var(--space-3); right: var(--space-4); padding: 2px var(--space-2); border-radius: var(--radius-full); background: var(--pearl-3); color: var(--text-muted); font-size: 11px; font-weight: 700; }
.ask-row { flex-direction: row; align-items: center; gap: var(--space-2); font-size: 15px; line-height: 22px; color: var(--accent-text); }
.ask-row strong { color: var(--ink); }

.search-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-4); min-height: 44px; padding: var(--space-2) var(--space-2) var(--space-2) var(--space-5); border-top: 1px solid var(--border); background: var(--surface-sunken); font-size: 12px; line-height: 16px; color: var(--text-muted); }
.search-foot .dot { width: 6px; height: 6px; }
.search-foot .spinner { width: 12px; height: 12px; }
.search-status { display: flex; align-items: center; gap: var(--space-2); min-height: 28px; }
.search-connect { display: flex; align-items: center; gap: var(--space-3); margin-left: auto; }
.search-connect[hidden] { display: none; }
.search-connect p { margin: 0; font-size: 13px; line-height: 18px; color: var(--text-muted); }
.link { all: unset; color: var(--accent-text); font-weight: 700; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.link:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
	.search[open] { animation: none; }
}
`;
