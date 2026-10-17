import figtree from './assets/fonts/figtree-latin.woff2'
import figtreeItalic from './assets/fonts/figtree-latin-italic.woff2'

/** Width of one rainbow behind a commented text, before its colours start over. */
export const RAINBOW_PERIOD = 720

/** How long the panel takes to come in, or to widen and narrow. */
export const PANEL_IN_MS = 200
/** How long the panel takes to leave: shorter, it is on its way out. */
export const PANEL_OUT_MS = 150
/** How long the element picker's outline takes to glide to the next element. */
const HOVER_MORPH_MS = 120

/** Styles of the widget, scoped by its shadow root. */
export const WIDGET_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483000;
  /* Blues of the mascot's body: accent and accent-strong are pixels of it, the
     tints its median hue. Accent text keeps 4.5:1 on white and on accent-weak. */
  --cb-accent: #216ec0;
  --cb-accent-strong: #1759ad;
  --cb-accent-weak: #e9f3fc;
  --cb-accent-rgb: 33, 110, 192;
  --cb-text: #13294b;
  --cb-muted: #6b7a90;
  --cb-border: #d6e4f0;
  --cb-surface: #ffffff;
  --cb-surface-2: #f5f9fc;
  --cb-green: #177a4c;
  --cb-green-bg: #e6f6ee;
  --cb-red: #d23f3f;
  --cb-red-bg: #fdecec;
  --cb-yellow: #f0ad2e;
  --cb-amber-bg: #fdf3e1;
  --cb-amber-fg: #7a4e0e;
  --cb-amber-ink: #4a2f06;
  --cb-amber-border: #f2d9a8;
  --cb-bubble: #eff3f8;
  /* The in-progress rainbow, dark enough for white text. */
  --cb-unicorn: linear-gradient(135deg, #d6336c, #7048e8 50%, #1c7ed6);
  --cb-radius: 8px;
  --cb-shadow: 0 8px 32px rgba(16, 36, 74, 0.18);
  --cb-font: 'Code Buddy Figtree', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --cb-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
* { box-sizing: border-box; }
.cb { font: 14px/1.45 var(--cb-font); color: var(--cb-text); }
.cb-live { pointer-events: auto; }
button, textarea, input { font: inherit; color: inherit; }
p { margin: 0; white-space: pre-wrap; }
code { font-family: var(--cb-mono); }

.cb-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 14px; border-radius: var(--cb-radius);
  border: 1px solid transparent; cursor: pointer; font-weight: 600;
  background: var(--cb-accent); color: #fff; white-space: nowrap;
  transition: background .15s, border-color .15s, color .15s;
}
.cb-btn:hover { background: var(--cb-accent-strong); }
.cb-btn:disabled { cursor: default; background: var(--cb-accent-weak); color: #9cbfde; }
.cb-btn--secondary { background: var(--cb-surface); color: var(--cb-accent); border-color: var(--cb-border); }
.cb-btn--secondary:hover { background: var(--cb-surface-2); border-color: var(--cb-accent); }
.cb-btn--tertiary { background: transparent; color: var(--cb-accent); }
.cb-btn--tertiary:hover { background: var(--cb-surface-2); }
.cb-btn--sm { height: 28px; padding: 0 10px; font-size: 13px; }
.cb-btn svg { width: 16px; height: 16px; }

.cb-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: var(--cb-text); cursor: pointer;
}
.cb-icon-btn:hover { background: var(--cb-surface-2); }
.cb-icon-btn:disabled { cursor: default; opacity: .35; background: transparent; }
.cb-icon-btn svg { width: 18px; height: 18px; }
.cb-icon-btn--danger { color: var(--cb-red); width: 22px; height: 22px; }
.cb-icon-btn--danger svg { width: 14px; height: 14px; }

.cb-chip { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 11px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.cb-chip--open { background: var(--cb-accent-weak); color: var(--cb-accent); }
.cb-chip--claimed { background: #dcebf8; color: var(--cb-accent-strong); }
.cb-chip--asking, .cb-chip--answered { background: #fdf3e1; color: #7a4e0e; }
.cb-chip--resolved { background: var(--cb-green-bg); color: var(--cb-green); }
.cb-chip--stopped { background: var(--cb-red-bg); color: var(--cb-red); }
.cb-chip--small { height: 18px; padding: 0 7px; border-radius: 9px; font-size: 11px; vertical-align: 1px; }

.cb-textarea {
  width: 100%; min-height: 96px; resize: vertical; padding: 10px 12px;
  border: 1px solid var(--cb-border); border-radius: var(--cb-radius);
  background: var(--cb-surface-2); outline: none;
}
.cb-textarea:focus { border-color: var(--cb-accent); }
.cb-textarea::placeholder { color: #6498c4; font-style: italic; }

.cb-checkbox { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: var(--cb-accent); }
.cb-checkbox input { width: 16px; height: 16px; margin: 0; accent-color: var(--cb-accent); }

.cb-toggle { align-self: flex-start; display: inline-flex; padding: 2px; border: 1px solid var(--cb-border); border-radius: 6px; }
.cb-toggle button { border: 0; background: transparent; padding: 2px 10px; border-radius: 4px; cursor: pointer; font-size: 13px; }
.cb-toggle button[aria-checked='true'] { background: var(--cb-accent-weak); color: var(--cb-accent); }

.cb-spinner { animation: cb-spin .8s linear infinite; flex-shrink: 0; }
@keyframes cb-spin { to { transform: rotate(360deg); } }

.cb-dock { position: fixed; right: 24px; bottom: 24px; display: flex; gap: 8px; }
.cb-dock .cb-btn { box-shadow: 0 4px 16px rgba(0,0,0,.15); }
.cb-selection { position: fixed; box-shadow: 0 4px 16px rgba(0,0,0,.15); }

.cb-panel {
  position: fixed; top: 16px; right: 16px; bottom: 16px;
  display: flex; flex-direction: column; background: var(--cb-surface);
  border-radius: 12px; box-shadow: var(--cb-shadow);
  animation: cb-panel-in ${PANEL_IN_MS}ms ease-out;
  transition-property: width, top, right, bottom, border-radius;
  transition-duration: ${PANEL_IN_MS}ms; transition-timing-function: ease-out;
}
.cb-panel--docked { top: 0; right: 0; bottom: 0; border-radius: 0; box-shadow: none; border-left: 1px solid var(--cb-border); }
/* Kept on screen until it has left: the page underneath gets the pointer back at once. */
.cb-panel[data-closing] { animation: cb-panel-out ${PANEL_OUT_MS}ms ease-in forwards; pointer-events: none; }
/* Dragged, the edge follows the pointer. */
.cb-panel:has(.cb-resize[data-dragging]) { transition: none; }
@keyframes cb-panel-in { from { transform: translateX(100%); opacity: 0; } }
@keyframes cb-panel-out { to { transform: translateX(100%); opacity: 0; } }
@keyframes cb-fade-in { from { opacity: 0; } }
@keyframes cb-fade-out { to { opacity: 0; } }
.cb-resize { position: absolute; top: 0; bottom: 0; left: -3px; width: 7px; cursor: col-resize; z-index: 1; }
.cb-resize:hover, .cb-resize[data-dragging] { background: var(--cb-accent); opacity: .6; }
.cb-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 20px; border-bottom: 1px solid var(--cb-border); }
.cb-title { display: flex; align-items: center; gap: 4px; min-width: 0; }
.cb-title h2 { margin: 0; font-size: 17px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cb-header-actions { display: flex; align-items: center; gap: 2px; }
.cb-body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding: 20px 20px 0; }
/* Closes the body: the message box right after the content, stuck to the bottom once the content
   overflows. It carries the body's bottom padding, so nothing scrolls visibly beneath it. */
.cb-body-end { position: sticky; bottom: 0; z-index: 3; display: flex; flex-direction: column; gap: 10px; margin-top: -6px; padding: 6px 0 20px; background: var(--cb-surface); }
/* The mascot, version and project link, pinned at the panel's foot. */
.cb-panel-foot { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 20px 12px; border-top: 1px solid var(--cb-border); font-size: 13px; color: var(--cb-muted); }
.cb-composer-box { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; padding: 8px 8px 8px 12px; border: 1px solid var(--cb-border); border-radius: 12px; background: var(--cb-surface); transition: border-color .15s; }
.cb-composer-box:focus-within { border-color: var(--cb-accent); }
/* The images pasted or dropped, on a row of their own above the text. */
.cb-attachments { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 8px; padding-top: 4px; }
.cb-attachment { position: relative; }
.cb-attachment img { display: block; width: 56px; height: 56px; object-fit: cover; border: 1px solid var(--cb-border); border-radius: 6px; }
.cb-attachment-remove { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 999px; background: var(--cb-text); color: #fff; }
.cb-attachment-remove:hover { background: var(--cb-red); }
.cb-attachment-remove svg { width: 12px; height: 12px; }
.cb-picked { flex-basis: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding-top: 4px; min-width: 0; }
.cb-pick { flex-shrink: 0; width: 36px; height: 36px; }
.cb-pick[aria-pressed="true"] { background: var(--cb-accent-weak); color: var(--cb-accent); }
.cb-composer-box textarea { flex: 1; min-width: 0; min-height: 36px; max-height: 160px; padding: 7px 0; border: 0; outline: none; resize: none; overflow-y: auto; background: transparent; font-size: 15px; line-height: 1.45; }
.cb-composer-box textarea::placeholder { color: #7d8ba0; }
.cb-send { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 8px; background: var(--cb-accent); color: #fff; cursor: pointer; transition: background .15s; }
.cb-send:hover { background: var(--cb-accent-strong); }
.cb-send:disabled { cursor: default; background: var(--cb-accent-weak); color: #9cbfde; }
.cb-send svg { width: 18px; height: 18px; }
.cb-composer-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--cb-muted); }
.cb-composer-cancel { margin-left: -10px; }
/* The hint row, moved into the foot while the content overflows. */
.cb-panel-foot-hint { display: inline-flex; align-items: center; gap: 12px; }
.cb-panel-foot-hint .cb-composer-cancel { margin-left: 0; }
/* Away from its box, the hint would only be noise: shown while the box has the focus. */
.cb-panel:not(:has(.cb-composer-box:focus-within)) .cb-panel-foot-hint .cb-send-hint { visibility: hidden; }
.cb-composer-brand { display: inline-flex; align-items: center; gap: 8px; }
/* The mascot's head: the image is cropped to its top. */
.cb-composer-brand img { width: 18px; height: 22px; object-fit: cover; object-position: 50% 0; }
.cb-composer-brand a { color: inherit; text-decoration: none; }
.cb-composer-brand a:hover { color: var(--cb-accent); }
/* Shown until the reader reaches the end of the body, just above the message box. */
.cb-scroll-down { position: absolute; bottom: calc(100% + 8px); left: 50%; margin-left: -14px; width: 28px; height: 28px; padding: 0; border-radius: 999px; border: 1px solid var(--cb-border); background: var(--cb-surface); color: var(--cb-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: .75; transition: opacity .15s, color .15s, border-color .15s, box-shadow .15s; }
.cb-scroll-down:hover { opacity: 1; color: var(--cb-text); border-color: var(--cb-accent); box-shadow: 0 4px 16px rgba(0,0,0,.15); }
.cb-scroll-down svg { width: 16px; height: 16px; }
.cb-form { display: flex; flex-direction: column; gap: 8px; }
.cb-actions { display: flex; gap: 8px; justify-content: flex-end; }
.cb-empty { display: flex; justify-content: center; padding: 32px 0; }
.cb-idle { font-size: 13px; color: var(--cb-muted); }

.cb-section, .cb-author, .cb-label, .cb-model { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--cb-muted); }
.cb-author { display: block; }
.cb-quote { margin: 0; padding-left: 8px; border-left: 3px solid var(--cb-yellow); font-size: 13px; color: var(--cb-muted); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }

.cb-item { display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: var(--cb-radius); border: 1px solid var(--cb-border); background: var(--cb-surface); cursor: pointer; }
.cb-item--active { border-color: var(--cb-accent); }
.cb-item--faded { opacity: .7; }
.cb-item .cb-delete { opacity: 0; transition: opacity .15s; }
.cb-item:hover .cb-delete, .cb-item .cb-delete:focus-visible { opacity: 1; }
.cb-item-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.cb-item-top > div { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.cb-summary { position: relative; isolation: isolate; gap: 6px; transition: border-color .15s, background .15s; }
/* The card's open action for the keyboard, stretched behind its content: its ring is the card's,
   drawn inside it, where the scrolling list does not clip it. */
.cb-summary-open { position: absolute; inset: 0; z-index: -1; padding: 0; border: 0; border-radius: inherit; background: transparent; cursor: pointer; }
.cb-summary-open:focus-visible { outline: 2px solid var(--cb-accent); outline-offset: -2px; }
.cb-summary:hover, .cb-summary:has(> .cb-summary-open:focus-visible) { border-color: var(--cb-accent); background: var(--cb-surface-2); }
.cb-summary p { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.cb-summary-head { display: flex; align-items: center; gap: 8px; }
.cb-summary-head > * { flex-shrink: 0; }
.cb-summary-head time { margin-left: auto; font-size: 12px; color: var(--cb-muted); white-space: nowrap; }
.cb-summary-head .cb-label, .cb-summary-head .cb-page { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cb-page { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--cb-accent); }
.cb-page span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cb-page svg { width: 14px; height: 14px; flex-shrink: 0; }

/* The open discussion fills the body: no card around it. */
.cb-discussion { padding: 0; border: none; cursor: default; }
/* The thread as a chat: the reader's messages right, in the accent; Claude's left, in a tint. */
.cb-chat { display: flex; flex-direction: column; gap: 16px; }
.cb-msg { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cb-msg--reader { align-items: flex-end; padding-left: 40px; }
.cb-msg--claude { align-items: flex-start; }
.cb-msg-elements { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; max-width: 100%; }
/* Sized to its text: the chip's negative margins would cut it short. */
.cb-msg-elements .cb-element { margin: 0; }
.cb-images { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.cb-images a { display: block; }
.cb-images img { display: block; max-width: 160px; max-height: 120px; border: 1px solid var(--cb-border); border-radius: 10px; object-fit: cover; }
/* Long words, URLs and code break inside the bubble rather than spilling out of it. */
.cb-bubble { max-width: 100%; padding: 8px 14px; border-radius: 14px; font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
.cb-bubble--reader { background: var(--cb-accent); color: #fff; border-bottom-right-radius: 4px; }
.cb-bubble--claude { width: 100%; background: var(--cb-bubble); color: var(--cb-text); }
.cb-ask { width: 100%; display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid var(--cb-amber-border); border-radius: 14px; background: var(--cb-amber-bg); color: var(--cb-amber-ink); font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
.cb-ask-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--cb-amber-fg); }
/* The answers Claude offers: one button each, ticked once chosen. */
.cb-options { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; white-space: normal; }
.cb-option { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 8px 12px; border: 1px solid var(--cb-amber-border); border-radius: var(--cb-radius); background: var(--cb-surface); color: var(--cb-amber-ink); text-align: left; cursor: pointer; transition: border-color .15s, background .15s; }
.cb-option:hover:not(:disabled) { border-color: var(--cb-accent); }
.cb-option:disabled { cursor: default; }
.cb-option--on { border-color: var(--cb-accent); background: var(--cb-accent-weak); color: var(--cb-text); }
.cb-option:disabled:not(.cb-option--on) { opacity: .6; }
.cb-option-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cb-option-text span { font-size: 13px; color: var(--cb-muted); }
.cb-option > svg { flex-shrink: 0; width: 16px; height: 16px; margin-top: 2px; color: var(--cb-accent); }
.cb-option-box { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; margin-top: 2px; border: 1.5px solid var(--cb-muted); border-radius: 4px; background: var(--cb-surface); }
.cb-option--on .cb-option-box { border-color: var(--cb-accent); background: var(--cb-accent); color: #fff; }
.cb-option-box svg { width: 12px; height: 12px; }
.cb-message-time { font-size: 11px; color: var(--cb-muted); font-variant-numeric: tabular-nums; }
.cb-working { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--cb-accent); }
.cb-working span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* One line, the latest step: the previous one leaves right, the new one enters left. */
.cb-current { position: relative; overflow: hidden; padding: 8px 10px; border-radius: var(--cb-radius); background: var(--cb-accent-weak); color: var(--cb-accent-strong); font-size: 13px; font-weight: 600; }
.cb-current:has(.cb-current-line--failed) { background: var(--cb-red-bg); }
.cb-current-line { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
/* The icon comes first: the text, not it, gives way with an ellipsis. */
.cb-current-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.cb-current-line svg { width: 14px; height: 14px; flex-shrink: 0; }
.cb-current-line--failed { color: var(--cb-red); }
/* The running step's icon: filled, with a pulsing ring. */
.cb-step-icon { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: var(--cb-accent); color: #fff; animation: cb-pulse 1.6s ease-out infinite; }
.cb-current-line--failed .cb-step-icon { background: var(--cb-red); animation: none; }
@keyframes cb-pulse { 0% { box-shadow: 0 0 0 0 rgba(var(--cb-accent-rgb), .45); } 70%, 100% { box-shadow: 0 0 0 7px rgba(var(--cb-accent-rgb), 0); } }
.cb-current-line--out { position: absolute; inset: 8px 10px; animation: cb-slide-out .25s ease-in forwards; }
.cb-current-line--in { animation: cb-slide-in .25s ease-out; }
@keyframes cb-slide-out { to { transform: translateX(100%); opacity: 0; } }
@keyframes cb-slide-in { from { transform: translateX(-100%); opacity: 0; } }
/* One dot, then two, then three. */
.cb-dots i { font-style: normal; }
.cb-dots i:nth-child(2) { animation: cb-dot-2 1.2s steps(1) infinite; }
.cb-dots i:nth-child(3) { animation: cb-dot-3 1.2s steps(1) infinite; }
@keyframes cb-dot-2 { 0% { opacity: 0; } 33.3% { opacity: 1; } }
@keyframes cb-dot-3 { 0% { opacity: 0; } 66.6% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .cb-current-line--out { display: none; }
  .cb-current-line--in, .cb-dots i, .cb-step-icon { animation: none; }
  /* The panel fades, and changes width at once. */
  .cb-panel { animation-name: cb-fade-in; transition: none; }
  .cb-panel[data-closing] { animation-name: cb-fade-out; }
}
.cb-stopped { padding: 8px; border-radius: var(--cb-radius); background: var(--cb-red-bg); color: var(--cb-red); font-size: 13px; }
.cb-stopped code { overflow-wrap: anywhere; }

.cb-element { display: inline-flex; align-items: baseline; gap: 4px; max-width: 100%; margin: 0 -4px; padding: 0 4px; border: 0; border-radius: 6px; background: transparent; font-size: 13px; line-height: inherit; text-align: left; color: var(--cb-muted); cursor: pointer; }
.cb-element:hover, .cb-element:focus-visible { background: var(--cb-surface-2); }
.cb-element code { color: var(--cb-accent); }
.cb-element span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cb-area-chip svg { flex-shrink: 0; align-self: center; width: 14px; height: 14px; color: var(--cb-accent); }
.cb-area-chip code { white-space: nowrap; font-variant-numeric: tabular-nums; }
.cb-area-draft { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.cb-draft-scope { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 8px; }

/* In progress: the comment is open, until Claude resolves its thread. A rainbow
   turns around it (--code-buddy-angle is registered in PAGE_CSS: a shadow root cannot). */
.cb-clip { position: fixed; overflow: hidden; pointer-events: none; }
.cb-mark { position: absolute; background: rgba(166, 107, 255, .06); }
.cb-mark::before {
  content: ''; position: absolute; inset: 0; padding: 2px; border-radius: inherit;
  background: conic-gradient(from var(--code-buddy-angle, 0deg), #ff5f9e, #ffb340, #ffe14d, #3ddc97, #3fa7ff, #a66bff, #ff5f9e);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  animation: cb-unicorn 3s linear infinite;
}
@keyframes cb-unicorn { to { --code-buddy-angle: 360deg; } }
@media (prefers-reduced-motion: reduce) { .cb-mark::before { animation: none; } }
.cb-quote-pin { position: fixed; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; margin-top: -22px; padding: 0; border: 2px solid #fff; border-radius: 11px 11px 11px 3px; background: var(--cb-unicorn); color: #fff; cursor: pointer; box-shadow: var(--cb-shadow); transition: transform .15s; }
.cb-quote-pin svg { width: 12px; height: 12px; }
.cb-quote-pin:hover, .cb-quote-pin:focus-visible { transform: scale(1.15); }
.cb-outline { position: fixed; pointer-events: none; border: 2px solid var(--cb-accent); background: rgba(var(--cb-accent-rgb), .12); box-shadow: 0 0 0 4px rgba(var(--cb-accent-rgb), .18); }
/* It glides to the next element: its size, not a scale, so the border and the label keep theirs. */
.cb-hover { position: fixed; top: 0; left: 0; pointer-events: none; border: 2px dashed var(--cb-accent); background: rgba(var(--cb-accent-rgb), .08); transition-property: transform, width, height, border-radius, opacity; transition-duration: ${HOVER_MORPH_MS}ms; transition-timing-function: ease-out; animation: cb-fade-in ${HOVER_MORPH_MS}ms ease-out; }
.cb-hover[data-instant] { transition: none; }
.cb-hover[data-hidden] { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .cb-hover { transition: none; animation: none; } }
.cb-hover span { position: absolute; top: -22px; left: -2px; padding: 1px 4px; border-radius: 3px; background: var(--cb-accent); color: #fff; font: 12px var(--cb-mono); white-space: nowrap; }
/* A drawn area: square corners; its outline is dashed, where an element's is solid. */
.cb-outline--area, .cb-mark--area { border-radius: 2px; }
.cb-outline--area { border-style: dashed; }
/* Drawing: the page under a veil, but for the area being drawn and what it covers. */
.cb-draw { position: fixed; inset: 0; cursor: crosshair; }
.cb-draw-box { position: fixed; border: 2px solid var(--cb-accent); border-radius: 2px; background: rgba(var(--cb-accent-rgb), .06); box-shadow: 0 0 0 100vmax rgba(16, 36, 74, .28); }
.cb-draw-box span { position: absolute; top: calc(100% + 6px); right: -2px; padding: 1px 6px; border-radius: 3px; background: var(--cb-accent); color: #fff; font: 12px var(--cb-mono); white-space: nowrap; font-variant-numeric: tabular-nums; }
.cb-draw-covered { position: fixed; pointer-events: none; border: 1px dashed rgba(var(--cb-accent-rgb), .7); border-radius: 2px; }
/* While the reader draws, the panel steps back: the page is what they look at, and draw over. */
.cb-panel[data-drawing] { opacity: .35; pointer-events: none; }
.cb-hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); padding: 8px 14px; border-radius: var(--cb-radius); background: var(--cb-text); color: #fff; font-size: 13px; pointer-events: none; }

.cb-toasts { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; }
.cb-toast { padding: 10px 14px; border-radius: var(--cb-radius); background: var(--cb-text); color: #fff; font-size: 13px; box-shadow: var(--cb-shadow); }
.cb-toast--error { background: var(--cb-red); }
`

/**
 * Page-level styles: text highlights live in the page's own document, and so do
 * fonts, which a shadow root ignores. Figtree ships with the widget (latin, the
 * variable weights and the italic), under its own name so a page's Figtree is
 * left alone.
 */
export const PAGE_CSS = `
@font-face { font-family: 'Code Buddy Figtree'; font-style: normal; font-weight: 400 700; font-display: swap; src: url(${figtree}) format('woff2'); }
@font-face { font-family: 'Code Buddy Figtree'; font-style: italic; font-weight: 400; font-display: swap; src: url(${figtreeItalic}) format('woff2'); }
@property --code-buddy-angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
/* Behind a commented text, the rainbow of an element's frame, lighter and flowing.
   Each line holds a slice of one rainbow laid over the viewport, so a quote's lines
   carry on from each other; it slides by one period, and starts over seamlessly. */
.code-buddy-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147482999; mix-blend-mode: multiply; }
.code-buddy-layer[data-dark] { mix-blend-mode: screen; }
.code-buddy-quote-mark { position: fixed; overflow: hidden; border-radius: 3px; opacity: .35; }
.code-buddy-layer[data-dark] .code-buddy-quote-mark { opacity: .3; }
.code-buddy-quote-mark > div {
  position: absolute; width: calc(100vw + ${RAINBOW_PERIOD * 2}px); height: 100vh;
  background: repeating-linear-gradient(90deg, #ff5f9e 0, #ffb340 ${RAINBOW_PERIOD / 6}px, #ffe14d ${RAINBOW_PERIOD / 3}px, #3ddc97 ${RAINBOW_PERIOD / 2}px, #3fa7ff ${(RAINBOW_PERIOD * 2) / 3}px, #a66bff ${(RAINBOW_PERIOD * 5) / 6}px, #ff5f9e ${RAINBOW_PERIOD}px);
  animation: code-buddy-flow 6s linear infinite;
}
@keyframes code-buddy-flow { to { transform: translateX(${RAINBOW_PERIOD}px); } }
@media (prefers-reduced-motion: reduce) { .code-buddy-quote-mark > div { animation: none; } }
::highlight(code-buddy-draft) { background-color: rgba(33, 110, 192, 0.25); }
`
