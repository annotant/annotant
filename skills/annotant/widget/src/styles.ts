import figtree from './assets/fonts/figtree-latin.woff2'
import figtreeItalic from './assets/fonts/figtree-latin-italic.woff2'

/** Width of one rainbow behind a commented text, before its colours start over. */
export const RAINBOW_PERIOD = 720
/** The rainbow of a comment in progress, around it or on a drawing's lines, its first colour last again. */
export const RAINBOW = [
  '#ff5f9e',
  '#ffb340',
  '#ffe14d',
  '#3ddc97',
  '#3fa7ff',
  '#a66bff',
  '#ff5f9e',
]
export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
/** How the widget scrolls the page: smoothly, unless motion is reduced. */
export const scrollBehavior = (): ScrollBehavior =>
  matchMedia(REDUCED_MOTION).matches ? 'auto' : 'smooth'

/**
 * How far the count of the threads that need the reader sticks out of the strip's
 * top right corner: 8px past Comments' corner (`.an-needs-you`), 4px of which
 * fall within the strip's padding and border (`.an-dock`). Change them together.
 */
export const NEEDS_YOU_REACH = 4

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
     tints its median hue. Accent text keeps 4.5:1 on white and on accent-weak;
     muted and red text keep it on every surface and tint below. */
  --cb-accent: #216ec0;
  --cb-accent-strong: #1759ad;
  --cb-accent-weak: #e9f3fc;
  --cb-accent-rgb: 33, 110, 192;
  /* Text and icons on an accent fill; a claimed comment's chip; a disabled button's text. */
  --cb-on-accent: #ffffff;
  --cb-accent-tint: #dcebf8;
  --cb-disabled: #9cbfde;
  --cb-text: #13294b;
  --cb-muted: #5d6b80;
  --cb-border: #d6e4f0;
  --cb-surface: #ffffff;
  --cb-surface-2: #f5f9fc;
  --cb-green: #177a4c;
  --cb-green-bg: #e6f6ee;
  --cb-red: #b83232;
  /* The lines the reader draws over the page, as drawing.ts paints them for Claude. */
  --cb-ink: #e5306b;
  --cb-red-bg: #fdecec;
  --cb-yellow: #f0ad2e;
  /* Dark amber on yellow, the same in either theme: the count of what waits on the reader. */
  --cb-on-yellow: #4a2f06;
  /* What waits on the reader on the page: the pins' ?, bright, with dark text on it. */
  --cb-orange: #fd7e14;
  --cb-on-orange: #13294b;
  --cb-amber-bg: #fdf3e1;
  --cb-amber-fg: #7a4e0e;
  --cb-amber-ink: #4a2f06;
  --cb-amber-border: #f2d9a8;
  --cb-bubble: #eff3f8;
  /* The in-progress rainbow, dark enough for white text. */
  --cb-unicorn: linear-gradient(135deg, #d6336c, #7048e8 50%, #1c7ed6);
  --cb-radius: 8px;
  --cb-shadow: 0 8px 32px rgba(16, 36, 74, 0.18);
  --cb-font: 'Annotant Figtree', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --cb-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
* { box-sizing: border-box; }
.an { font: 14px/1.45 var(--cb-font); color: var(--cb-text); color-scheme: light; }
/* The dark palette (theme.ts says when): every colour below goes through these. */
.an[data-theme='dark'] {
  color-scheme: dark;
  --cb-accent: #6cb0f5;
  --cb-accent-strong: #93c6fa;
  --cb-accent-weak: #172c44;
  --cb-accent-rgb: 108, 176, 245;
  --cb-on-accent: #0b1828;
  --cb-accent-tint: #1d3858;
  --cb-disabled: #4b6787;
  --cb-text: #e3eaf4;
  --cb-muted: #9aa9bd;
  --cb-border: #2e3a4c;
  --cb-surface: #161c27;
  --cb-surface-2: #1f2735;
  --cb-green: #5fd39b;
  --cb-green-bg: #12301f;
  --cb-red: #ff8f8f;
  --cb-red-bg: #3a1b1e;
  --cb-orange: #fb923c;
  --cb-on-orange: #0b1828;
  --cb-amber-bg: #33280f;
  --cb-amber-fg: #f2c46b;
  --cb-amber-ink: #f7e5bd;
  --cb-amber-border: #5e4919;
  --cb-bubble: #232c3a;
  --cb-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}
.an-live { pointer-events: auto; }
button, textarea, input { font: inherit; color: inherit; }
p { margin: 0; white-space: pre-wrap; }
code { font-family: var(--cb-mono); }

.an-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 14px; border-radius: var(--cb-radius);
  border: 1px solid transparent; cursor: pointer; font-weight: 600;
  background: var(--cb-accent); color: var(--cb-on-accent); white-space: nowrap;
  transition: background .15s, border-color .15s, color .15s;
}
.an-btn:hover { background: var(--cb-accent-strong); }
.an-btn:disabled { cursor: default; background: var(--cb-accent-weak); color: var(--cb-disabled); }
.an-btn--secondary { background: var(--cb-surface); color: var(--cb-accent); border-color: var(--cb-border); }
.an-btn--secondary:hover { background: var(--cb-surface-2); border-color: var(--cb-accent); }
.an-btn--tertiary { background: transparent; color: var(--cb-accent); }
.an-btn--tertiary:hover { background: var(--cb-surface-2); }
.an-btn--sm { height: 28px; padding: 0 10px; font-size: 13px; }
.an-btn svg { width: 16px; height: 16px; }

.an-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: var(--cb-text); cursor: pointer;
}
.an-icon-btn:hover { background: var(--cb-surface-2); }
.an-icon-btn:disabled { cursor: default; opacity: .35; background: transparent; }
.an-icon-btn svg { width: 18px; height: 18px; }
.an-icon-btn--danger { color: var(--cb-red); width: 22px; height: 22px; }
.an-icon-btn--danger svg { width: 14px; height: 14px; }

.an-chip { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 11px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.an-chip--open { background: var(--cb-accent-weak); color: var(--cb-accent); }
.an-chip--claimed { background: var(--cb-accent-tint); color: var(--cb-accent-strong); }
.an-chip--asking, .an-chip--answered { background: var(--cb-amber-bg); color: var(--cb-amber-fg); }
.an-chip--resolved { background: var(--cb-green-bg); color: var(--cb-green); }
.an-chip--stopped { background: var(--cb-red-bg); color: var(--cb-red); }
.an-chip--small { height: 18px; padding: 0 7px; border-radius: 9px; font-size: 11px; vertical-align: 1px; }

.an-textarea {
  width: 100%; min-height: 96px; resize: vertical; padding: 10px 12px;
  border: 1px solid var(--cb-border); border-radius: var(--cb-radius);
  background: var(--cb-surface-2); outline: none;
}
.an-textarea:focus { border-color: var(--cb-accent); }
.an-textarea::placeholder { color: var(--cb-muted); font-style: italic; }

.an-checkbox { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: var(--cb-accent); }
.an-checkbox input { width: 16px; height: 16px; margin: 0; accent-color: var(--cb-accent); }

.an-toggle { align-self: flex-start; display: inline-flex; padding: 2px; border: 1px solid var(--cb-border); border-radius: 6px; }
.an-toggle button { border: 0; background: transparent; padding: 2px 10px; border-radius: 4px; cursor: pointer; font-size: 13px; }
.an-toggle button[aria-checked='true'] { background: var(--cb-accent-weak); color: var(--cb-accent); }

.an-spinner { animation: an-spin .8s linear infinite; flex-shrink: 0; }
@keyframes an-spin { to { transform: rotate(360deg); } }

.an-dock {
  position: fixed; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 2px;
  padding: 3px; border: 1px solid var(--cb-border); border-radius: 10px;
  background: var(--cb-surface); box-shadow: 0 4px 16px rgba(0,0,0,.15);
}
/* Its grip moves it: the tools keep their clicks. */
.an-grip {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 30px; padding: 0; border: 0; border-radius: 5px;
  background: transparent; color: var(--cb-muted); cursor: grab; touch-action: none;
}
.an-grip:hover { color: var(--cb-text); background: var(--cb-surface-2); }
.an-grip svg { width: 18px; height: 18px; stroke-width: 3; }
.an-dock[data-moving] .an-grip { cursor: grabbing; }
.an-tool { border-radius: 7px; }
.an-tool:not(.an-tool--idle) { background: var(--cb-accent-weak); border-color: transparent; }
.an-tool:not(.an-tool--idle):hover { background: var(--cb-accent-tint); }
/* Its grip moves the whole strip: hovered, it rings all of it. */
.an-dock:has(.an-grip:hover), .an-dock[data-moving] {
  box-shadow: 0 0 0 2px rgba(var(--cb-accent-rgb), .35), 0 4px 16px rgba(0,0,0,.15);
}
/* Between the page's tools and Comments: 4px on each side, with the strip's gap. */
.an-dock-rule { flex-shrink: 0; width: 1px; height: 20px; margin: 0 2px; background: var(--cb-border); }
.an-comments {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; padding: 0; border: 0; border-radius: 7px;
  background: var(--cb-accent); color: var(--cb-on-accent); cursor: pointer; transition: background .15s;
}
.an-comments:hover { background: var(--cb-accent-strong); }
.an-comments > svg { width: 18px; height: 18px; }
/* Threads wait on the reader: how many, on Comments' top right corner. */
.an-needs-you {
  position: absolute; top: -8px; right: -8px; min-width: 20px; height: 20px; padding: 0 5px;
  display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
  border: 2px solid var(--cb-surface); border-radius: 10px; background: var(--cb-yellow);
  color: var(--cb-on-yellow); font-size: 11px; font-weight: 700; line-height: 1;
}
.an-tool--idle { width: 30px; height: 30px; padding: 0; justify-content: center; border-color: transparent; }
.an-tool--idle svg { width: 18px; height: 18px; }
.an-selection { position: fixed; box-shadow: 0 4px 16px rgba(0,0,0,.15); }

.an-panel {
  position: fixed; top: 16px; right: 16px; bottom: 16px;
  display: flex; flex-direction: column; background: var(--cb-surface);
  border-radius: 12px; box-shadow: var(--cb-shadow);
  animation: an-panel-in ${PANEL_IN_MS}ms ease-out;
  transition-property: width, top, right, bottom, border-radius;
  transition-duration: ${PANEL_IN_MS}ms; transition-timing-function: ease-out;
}
.an-panel--docked { top: 0; right: 0; bottom: 0; border-radius: 0; box-shadow: none; border-left: 1px solid var(--cb-border); }
/* Open again as the tab kept it: already in place, it does not slide in. */
.an-panel[data-restored] { animation: none; }
/* Kept on screen until it has left: the page underneath gets the pointer back at once. */
.an-panel[data-closing] { animation: an-panel-out ${PANEL_OUT_MS}ms ease-in forwards; pointer-events: none; }
/* Dragged, the edge follows the pointer. */
.an-panel:has(.an-resize[data-dragging]) { transition: none; }
@keyframes an-panel-in { from { transform: translateX(100%); opacity: 0; } }
@keyframes an-panel-out { to { transform: translateX(100%); opacity: 0; } }
@keyframes an-fade-in { from { opacity: 0; } }
@keyframes an-fade-out { to { opacity: 0; } }
.an-resize { position: absolute; top: 0; bottom: 0; left: -3px; width: 7px; cursor: col-resize; z-index: 1; }
.an-resize:hover, .an-resize[data-dragging] { background: var(--cb-accent); opacity: .6; }
.an-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 20px; border-bottom: 1px solid var(--cb-border); }
.an-title { display: flex; align-items: center; gap: 4px; min-width: 0; }
.an-title h2 { margin: 0; font-size: 17px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.an-header-actions { display: flex; align-items: center; gap: 2px; }
.an-body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding: 20px 20px 0; }
/* Closes the body: the message box right after the content, stuck to the bottom once the content
   overflows. It carries the body's bottom padding, so nothing scrolls visibly beneath it. */
.an-body-end { position: sticky; bottom: 0; z-index: 3; display: flex; flex-direction: column; gap: 10px; margin-top: -6px; padding: 6px 0 20px; background: var(--cb-surface); }
/* The mascot, version and project link, pinned at the panel's foot. */
.an-panel-foot { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 20px 12px; border-top: 1px solid var(--cb-border); font-size: 13px; color: var(--cb-muted); }
.an-composer-box { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; padding: 8px 8px 8px 12px; border: 1px solid var(--cb-border); border-radius: 12px; background: var(--cb-surface); transition: border-color .15s; }
.an-composer-box:focus-within { border-color: var(--cb-accent); }
/* The images pasted or dropped, on a row of their own above the text. */
.an-attachments { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 8px; padding-top: 4px; }
.an-attachment { position: relative; }
.an-attachment img { display: block; width: 56px; height: 56px; object-fit: cover; border: 1px solid var(--cb-border); border-radius: 6px; }
.an-attachment-remove { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 999px; background: var(--cb-text); color: var(--cb-surface); }
.an-attachment-remove:hover { background: var(--cb-red); }
.an-attachment-remove svg { width: 12px; height: 12px; }
/* The target slot, above the images and the text: what to point at, or the one target's card. */
.an-target-slot { flex-basis: 100%; min-width: 0; padding-bottom: 6px; border-bottom: 1px solid var(--cb-border); }
.an-target-empty { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: 13px; color: var(--cb-muted); }
.an-target-tool { padding: 2px 4px; border: 0; border-radius: 6px; background: transparent; font: inherit; color: var(--cb-accent); cursor: pointer; }
.an-target-tool:hover, .an-target-tool:focus-visible { background: var(--cb-surface-2); }
.an-target-tool[aria-pressed="true"] { background: var(--cb-accent-weak); }
.an-target { display: flex; align-items: center; gap: 4px; min-width: 0; padding: 6px 4px 6px 10px; border: 1px solid var(--cb-border); border-radius: 8px; background: var(--cb-surface-2); }
.an-target:hover { border-color: var(--cb-accent); }
.an-target-text { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 13px; }
.an-target-title { display: flex; align-items: center; gap: 6px; min-width: 0; }
.an-target-title span, .an-target-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-target-title code { flex-shrink: 0; color: var(--cb-accent); font-variant-numeric: tabular-nums; }
.an-target-title svg { flex-shrink: 0; width: 14px; height: 14px; color: var(--cb-accent); }
.an-target-detail { font-size: 12px; color: var(--cb-muted); }
.an-target .an-btn[aria-pressed="true"] { background: var(--cb-accent-weak); }
.an-attach { flex-shrink: 0; width: 36px; height: 36px; }
.an-composer-box textarea { flex: 1; min-width: 0; min-height: 36px; max-height: 160px; padding: 7px 0; border: 0; outline: none; resize: none; overflow-y: auto; background: transparent; font-size: 15px; line-height: 1.45; }
.an-composer-box textarea::placeholder { color: var(--cb-muted); }
.an-send { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 8px; background: var(--cb-accent); color: var(--cb-on-accent); cursor: pointer; transition: background .15s; }
.an-send:hover { background: var(--cb-accent-strong); }
.an-send:disabled { cursor: default; background: var(--cb-accent-weak); color: var(--cb-disabled); }
.an-send svg { width: 18px; height: 18px; }
.an-composer-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--cb-muted); }
.an-composer-cancel { margin-left: -10px; }
/* The hint row, moved into the foot while the content overflows. */
.an-panel-foot-hint { display: inline-flex; align-items: center; gap: 12px; }
.an-panel-foot-hint .an-composer-cancel { margin-left: 0; }
/* Away from its box, the hint would only be noise: shown while the box has the focus. */
.an-panel:not(:has(.an-composer-box:focus-within)) .an-panel-foot-hint .an-send-hint { visibility: hidden; }
.an-composer-brand { display: inline-flex; align-items: center; gap: 8px; }
/* The mascot's head: the images are cropped to it. */
.an-composer-brand img { width: 24px; height: 22px; }
.an-composer-brand a { color: inherit; text-decoration: none; }
.an-composer-brand a:hover { color: var(--cb-accent); }
/* Shown until the reader reaches the end of the body, just above the message box. */
.an-scroll-down { position: absolute; bottom: calc(100% + 8px); left: 50%; margin-left: -14px; width: 28px; height: 28px; padding: 0; border-radius: 999px; border: 1px solid var(--cb-border); background: var(--cb-surface); color: var(--cb-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: .75; transition: opacity .15s, color .15s, border-color .15s, box-shadow .15s; }
.an-scroll-down:hover { opacity: 1; color: var(--cb-text); border-color: var(--cb-accent); box-shadow: 0 4px 16px rgba(0,0,0,.15); }
.an-scroll-down svg { width: 16px; height: 16px; }
.an-form { display: flex; flex-direction: column; gap: 8px; }
.an-actions { display: flex; gap: 8px; justify-content: flex-end; }
.an-empty { display: flex; justify-content: center; padding: 32px 0; }
.an-keys { padding: 12px; border: 1px solid var(--cb-border); border-radius: var(--cb-radius); font-size: 13px; }
.an-keys dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 12px; margin: 0; }
.an-keys dt, .an-keys dd { margin: 0; }
.an-keys dd { color: var(--cb-muted); }
.an-keys kbd { font: inherit; font-weight: 600; white-space: nowrap; }
.an-idle { font-size: 13px; color: var(--cb-muted); }

.an-section, .an-author, .an-label, .an-model { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--cb-muted); }
.an-author { display: block; }
.an-quote { margin: 0; padding-left: 8px; border-left: 3px solid var(--cb-yellow); font-size: 13px; color: var(--cb-muted); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }

.an-item { display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: var(--cb-radius); border: 1px solid var(--cb-border); background: var(--cb-surface); cursor: pointer; }
.an-item--active { border-color: var(--cb-accent); }
.an-item--faded { opacity: .7; }
.an-item .an-delete { opacity: 0; transition: opacity .15s; }
.an-item:hover .an-delete, .an-item .an-delete:focus-visible { opacity: 1; }
.an-item-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.an-item-top > div { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.an-summary { position: relative; isolation: isolate; gap: 6px; transition: border-color .15s, background .15s; }
/* The card's open action for the keyboard, stretched behind its content: its ring is the card's,
   drawn inside it, where the scrolling list does not clip it. */
.an-summary-open { position: absolute; inset: 0; z-index: -1; padding: 0; border: 0; border-radius: inherit; background: transparent; cursor: pointer; }
.an-summary-open:focus-visible { outline: 2px solid var(--cb-accent); outline-offset: -2px; }
.an-summary:hover, .an-summary:has(> .an-summary-open:focus-visible) { border-color: var(--cb-accent); background: var(--cb-surface-2); }
.an-summary p { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.an-summary-head { display: flex; align-items: center; gap: 8px; }
.an-summary-head > * { flex-shrink: 0; }
.an-summary-head time { margin-left: auto; font-size: 12px; color: var(--cb-muted); white-space: nowrap; }
.an-summary-head .an-label, .an-summary-head .an-page { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-page { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--cb-accent); }
.an-page span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-page svg { width: 14px; height: 14px; flex-shrink: 0; }

/* The open discussion fills the body: no card around it. */
.an-discussion { padding: 0; border: none; cursor: default; }
/* The thread as a chat: the reader's messages right, in the accent; Claude's left, in a tint. */
.an-chat { display: flex; flex-direction: column; gap: 16px; }
/* A message takes the focus, to show its date on Enter or Space: outlined for the keyboard only. */
.an-msg { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; outline: none; }
.an-msg:focus-visible { outline: 2px solid var(--cb-accent); outline-offset: 2px; border-radius: 14px; }
.an-msg--reader { align-items: flex-end; padding-left: 40px; }
.an-msg--claude { align-items: flex-start; }
.an-msg-elements { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; max-width: 100%; }
/* Sized to its text: the chip's negative margins would cut it short. */
.an-msg-elements .an-element { margin: 0; }
.an-images { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.an-images a { display: block; }
.an-images img { display: block; max-width: 160px; max-height: 120px; border: 1px solid var(--cb-border); border-radius: 10px; object-fit: cover; }
/* Long words, URLs and code break inside the bubble rather than spilling out of it. */
.an-bubble { max-width: 100%; padding: 8px 14px; border-radius: 14px; font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
.an-bubble--reader { background: var(--cb-accent); color: var(--cb-on-accent); border-bottom-right-radius: 4px; }
.an-bubble--claude { width: 100%; background: var(--cb-bubble); color: var(--cb-text); }
.an-ask { width: 100%; display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid var(--cb-amber-border); border-radius: 14px; background: var(--cb-amber-bg); color: var(--cb-amber-ink); font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
.an-ask-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--cb-amber-fg); }
/* The answers Claude offers: one button each, ticked once chosen. */
.an-options { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; white-space: normal; }
.an-option { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 8px 12px; border: 1px solid var(--cb-amber-border); border-radius: var(--cb-radius); background: var(--cb-surface); color: var(--cb-amber-ink); text-align: left; cursor: pointer; transition: border-color .15s, background .15s; }
.an-option:hover:not(:disabled) { border-color: var(--cb-accent); }
.an-option:disabled { cursor: default; }
.an-option--on { border-color: var(--cb-accent); background: var(--cb-accent-weak); color: var(--cb-text); }
.an-option:disabled:not(.an-option--on) { opacity: .6; }
.an-option-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.an-option-text span { font-size: 13px; color: var(--cb-muted); }
.an-option > svg { flex-shrink: 0; width: 16px; height: 16px; margin-top: 2px; color: var(--cb-accent); }
.an-option-box { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; margin-top: 2px; border: 1.5px solid var(--cb-muted); border-radius: 4px; background: var(--cb-surface); }
.an-option--on .an-option-box { border-color: var(--cb-accent); background: var(--cb-accent); color: var(--cb-on-accent); }
.an-option-box svg { width: 12px; height: 12px; }
.an-message-time { font-size: 11px; color: var(--cb-muted); font-variant-numeric: tabular-nums; }
.an-working { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--cb-accent); }
.an-working span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Read by screen readers only. */
.an-visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
/* One line, the latest step: the previous one leaves right, the new one enters left. */
.an-current { position: relative; overflow: hidden; padding: 8px 10px; border-radius: var(--cb-radius); background: var(--cb-accent-weak); color: var(--cb-accent-strong); font-size: 13px; font-weight: 600; }
.an-current:has(.an-current-line--failed) { background: var(--cb-red-bg); }
.an-current-line { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
/* The icon comes first: the text, not it, gives way with an ellipsis. */
.an-current-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.an-current-line svg { width: 14px; height: 14px; flex-shrink: 0; }
.an-current-line--failed { color: var(--cb-red); }
/* The running step's icon: filled, with a pulsing ring. */
.an-step-icon { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: var(--cb-accent); color: var(--cb-on-accent); animation: an-pulse 1.6s ease-out infinite; }
.an-current-line--failed .an-step-icon { background: var(--cb-red); animation: none; }
@keyframes an-pulse { 0% { box-shadow: 0 0 0 0 rgba(var(--cb-accent-rgb), .45); } 70%, 100% { box-shadow: 0 0 0 7px rgba(var(--cb-accent-rgb), 0); } }
.an-current-line--out { position: absolute; inset: 8px 10px; animation: an-slide-out .25s ease-in forwards; }
.an-current-line--in { animation: an-slide-in .25s ease-out; }
@keyframes an-slide-out { to { transform: translateX(100%); opacity: 0; } }
@keyframes an-slide-in { from { transform: translateX(-100%); opacity: 0; } }
/* One dot, then two, then three. */
.an-dots i { font-style: normal; }
.an-dots i:nth-child(2) { animation: an-dot-2 1.2s steps(1) infinite; }
.an-dots i:nth-child(3) { animation: an-dot-3 1.2s steps(1) infinite; }
@keyframes an-dot-2 { 0% { opacity: 0; } 33.3% { opacity: 1; } }
@keyframes an-dot-3 { 0% { opacity: 0; } 66.6% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .an-current-line--out { display: none; }
  .an-current-line--in, .an-dots i, .an-step-icon, .an-spinner { animation: none; }
  /* The panel fades, and changes width at once. */
  .an-panel { animation-name: an-fade-in; transition: none; }
  .an-panel[data-closing] { animation-name: an-fade-out; }
}
.an-stopped { padding: 8px; border-radius: var(--cb-radius); background: var(--cb-red-bg); color: var(--cb-red); font-size: 13px; }
.an-stopped code { overflow-wrap: anywhere; }

.an-element { display: inline-flex; align-items: baseline; gap: 4px; max-width: 100%; margin: 0 -4px; padding: 0 4px; border: 0; border-radius: 6px; background: transparent; font-size: 13px; line-height: inherit; text-align: left; color: var(--cb-muted); cursor: pointer; }
.an-element:hover, .an-element:focus-visible { background: var(--cb-surface-2); }
.an-element code { color: var(--cb-accent); }
.an-element span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-area-chip svg { flex-shrink: 0; align-self: center; width: 14px; height: 14px; color: var(--cb-accent); }
.an-area-chip code { white-space: nowrap; font-variant-numeric: tabular-nums; }
.an-draft-scope { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 8px; }

/* In progress: the comment is open, until Claude resolves its thread. A rainbow
   turns around it (--annotant-angle is registered in PAGE_CSS: a shadow root cannot),
   or on a drawing's lines (.an-mark--drawing). */
.an-clip { position: fixed; overflow: hidden; pointer-events: none; }
.an-mark { position: absolute; background: rgba(166, 107, 255, .06); }
.an-mark::before {
  content: ''; position: absolute; inset: 0; padding: 2px; border-radius: inherit;
  background: conic-gradient(from var(--annotant-angle, 0deg), ${RAINBOW.join(', ')});
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  animation: an-unicorn 3s linear infinite;
}
@keyframes an-unicorn { to { --annotant-angle: 360deg; } }
@media (prefers-reduced-motion: reduce) { .an-mark::before { animation: none; } }
.an-quote-pin { position: fixed; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; margin-top: -22px; padding: 0; border: 2px solid #fff; border-radius: 11px 11px 11px 3px; background: var(--cb-unicorn); color: #fff; cursor: pointer; box-shadow: var(--cb-shadow); transition: transform .15s; }
.an-quote-pin svg { width: 12px; height: 12px; }
.an-quote-pin--asking { background: var(--cb-orange); color: var(--cb-on-orange); font-size: 13px; font-weight: 700; line-height: 1; }
.an-quote-pin:hover, .an-quote-pin:focus-visible { transform: scale(1.15); }
.an-outline { position: fixed; pointer-events: none; border: 2px solid var(--cb-accent); background: rgba(var(--cb-accent-rgb), .12); box-shadow: 0 0 0 4px rgba(var(--cb-accent-rgb), .18); }
/* It glides to the next element: its size, not a scale, so the border and the label keep theirs. */
.an-hover { position: fixed; top: 0; left: 0; pointer-events: none; border: 2px dashed var(--cb-accent); background: rgba(var(--cb-accent-rgb), .08); transition-property: transform, width, height, border-radius, opacity; transition-duration: ${HOVER_MORPH_MS}ms; transition-timing-function: ease-out; animation: an-fade-in ${HOVER_MORPH_MS}ms ease-out; }
.an-hover[data-instant] { transition: none; }
.an-hover[data-hidden] { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .an-hover { transition: none; animation: none; } }
.an-hover span { position: absolute; top: -22px; left: -2px; padding: 1px 4px; border-radius: 3px; background: var(--cb-accent); color: var(--cb-on-accent); font: 12px var(--cb-mono); white-space: nowrap; }
/* A drawn area: square corners; its outline is dashed, where an element's is solid. */
.an-outline--area, .an-mark--area { border-radius: 2px; }
.an-outline--area { border-style: dashed; }
/* A drawing's lines carry the rainbow (overlays.tsx): its box is not framed. */
.an-mark--drawing { background: none; }
.an-mark--drawing::before { content: none; }
/* Its agent has written, or is writing, a file: the area is where the content was, not where it is. */
.an-mark--area[data-outdated] { background: none; opacity: .45; }
.an-mark--area[data-outdated]::before { background: var(--cb-muted); animation: none; }
.an-mark--area[data-outdated] .an-strokes { stroke: var(--cb-muted); }
/* Drawing: the page under a veil, but for the area being drawn and what it covers. */
.an-draw { position: fixed; inset: 0; cursor: crosshair; }
.an-draw-box { position: fixed; border: 2px solid var(--cb-accent); border-radius: 2px; background: rgba(var(--cb-accent-rgb), .06); box-shadow: 0 0 0 100vmax rgba(16, 36, 74, .28); }
.an-draw-box span { position: absolute; top: calc(100% + 6px); right: -2px; padding: 1px 6px; border-radius: 3px; background: var(--cb-accent); color: var(--cb-on-accent); font: 12px var(--cb-mono); white-space: nowrap; font-variant-numeric: tabular-nums; }
.an-draw-covered { position: fixed; pointer-events: none; border: 1px dashed rgba(var(--cb-accent-rgb), .7); border-radius: 2px; }
/* While the reader draws, the panel steps back: the page is what they look at, and draw over. */
.an-panel[data-drawing] { opacity: .35; pointer-events: none; }
/* Drawing freehand: the lines over the page, the tools above them. */
.an-sketch { background: rgba(16, 36, 74, .12); touch-action: none; }
.an-sketch-lines { position: fixed; inset: 0; width: 100%; height: 100%; }
.an-strokes { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
/* The lines inherit their colour: a drawing in progress puts its rainbow in its place. */
.an-sketch-lines, .an-strokes { stroke: var(--cb-ink); }
.an-sketch-lines polyline, .an-strokes polyline { fill: none; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.an-sketch-tools { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; max-width: calc(100vw - 32px); padding: 6px 6px 6px 14px; border-radius: var(--cb-radius); background: var(--cb-text); color: var(--cb-surface); font-size: 13px; cursor: default; }
.an-sketch-tools span { margin-right: 6px; }
.an-sketch-tools button { padding: 4px 10px; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 4px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.an-sketch-tools button:disabled { opacity: .5; cursor: default; }
.an-sketch-tools .an-sketch-done { border-color: var(--cb-accent); background: var(--cb-accent); color: var(--cb-on-accent); }
.an-hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); padding: 8px 14px; border-radius: var(--cb-radius); background: var(--cb-text); color: var(--cb-surface); font-size: 13px; pointer-events: none; }

.an-toasts { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); }
.an-toasts > div { display: flex; flex-direction: column; gap: 8px; }
.an-toasts > :not(:empty) ~ :not(:empty) { margin-top: 8px; }
.an-toast { padding: 10px 14px; border-radius: var(--cb-radius); background: var(--cb-text); color: var(--cb-surface); font-size: 13px; box-shadow: var(--cb-shadow); }
.an-toast--error { background: var(--cb-red); }
`

/**
 * Page-level styles: text highlights live in the page's own document, and so do
 * fonts, which a shadow root ignores. Figtree ships with the widget (latin, the
 * variable weights and the italic), under its own name so a page's Figtree is
 * left alone.
 */
export const PAGE_CSS = `
@font-face { font-family: 'Annotant Figtree'; font-style: normal; font-weight: 400 700; font-display: swap; src: url(${figtree}) format('woff2'); }
@font-face { font-family: 'Annotant Figtree'; font-style: italic; font-weight: 400; font-display: swap; src: url(${figtreeItalic}) format('woff2'); }
@property --annotant-angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
/* Behind a commented text, the rainbow of an element's frame, lighter and flowing.
   Each line holds a slice of one rainbow laid over the viewport, so a quote's lines
   carry on from each other; it slides by one period, and starts over seamlessly. */
.annotant-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147482999; mix-blend-mode: multiply; }
.annotant-layer[data-dark] { mix-blend-mode: screen; }
.annotant-quote-mark { position: fixed; overflow: hidden; border-radius: 3px; opacity: .35; }
.annotant-layer[data-dark] .annotant-quote-mark { opacity: .3; }
.annotant-quote-mark > div {
  position: absolute; width: calc(100vw + ${RAINBOW_PERIOD * 2}px); height: 100vh;
  background: repeating-linear-gradient(90deg, ${RAINBOW.map((color, at) => `${color} ${(RAINBOW_PERIOD * at) / (RAINBOW.length - 1)}px`).join(', ')});
  animation: annotant-flow 6s linear infinite;
}
@keyframes annotant-flow { to { transform: translateX(${RAINBOW_PERIOD}px); } }
@media (prefers-reduced-motion: reduce) { .annotant-quote-mark > div { animation: none; } }
::highlight(annotant-draft) { background-color: rgba(33, 110, 192, 0.25); }
`
