/**
 * The widget's keyboard shortcuts: ⌘⇧ on macOS, Ctrl+Shift elsewhere, then a
 * key matched on `event.code`, where it is on the keyboard, so they work
 * whatever the layout; their labels say what that key types on the reader's
 * keyboard where the browser tells it (`;` for `,` on AZERTY). Letters with ⌘⇧
 * or Ctrl+Shift are nearly all taken by the browsers (⌘⇧C, Ctrl+Shift+K,
 * Ctrl+Shift+E…): these keys are not.
 */
export const SHORTCUTS = {
  comment: {
    code: 'Comma',
    key: ',',
    label: ',',
    does: 'Comment on the selected text, or on the page',
  },
  pick: { code: 'Period', key: '.', label: '.', does: 'Point at an element' },
  panel: {
    code: 'Enter',
    key: 'Enter',
    label: 'Enter',
    mac: '↩',
    does: 'Open or close the panel',
  },
  next: {
    code: 'ArrowDown',
    key: 'ArrowDown',
    label: '↓',
    does: 'Next comment on this page',
  },
  previous: {
    code: 'ArrowUp',
    key: 'ArrowUp',
    label: '↑',
    does: 'Previous comment on this page',
  },
} as const satisfies Record<
  string,
  {
    /** Where the key is on the keyboard. */
    code: string
    /** The key, as `aria-keyshortcuts` names it. */
    key: string
    label: string
    /** Its label on macOS, when it differs. */
    mac?: string
    does: string
  }
>

export type Shortcut = keyof typeof SHORTCUTS

/** In the order the panel lists them. */
export const SHORTCUT_LIST: Shortcut[] = ['comment', 'pick', 'panel', 'next', 'previous']

interface Platform {
  userAgentData?: { platform?: string }
  platform?: string
}

/** Whether `navigator` is on a Mac (or an iPad with a keyboard): ⌘ rather than Ctrl. */
export function onMac(navigator: Platform) {
  return /mac|iphone|ipad/i.test(
    navigator.userAgentData?.platform || navigator.platform || '',
  )
}

/** Detected once: the platform does not change under the page. */
export const MAC = onMac(globalThis.navigator)

/** What each key types on a keyboard, by its `code`. */
interface KeyboardLayout {
  get(code: string): string | undefined
}

/** The Keyboard Map API, in Chromium only. */
interface WithKeyboard {
  keyboard?: { getLayoutMap?: () => Promise<KeyboardLayout> }
}

/** The reader's keyboard, once read: unknown, the labels are a US keyboard's. */
let typed: KeyboardLayout | undefined

/**
 * Reads what the keys type on the reader's keyboard, for the labels; whether it
 * could. The browser may not tell (Firefox, Safari), or not to a frame.
 */
export async function readKeyboard(
  navigator: Partial<Navigator> & WithKeyboard = globalThis.navigator,
) {
  try {
    typed = await navigator.keyboard?.getLayoutMap?.()
  } catch {
    // Not allowed here: a US keyboard's labels, as without the API.
    typed = undefined
  }
  return !!typed
}

/** The key of `shortcut`, as it types on the reader's keyboard, if known. */
const typedKey = (shortcut: Shortcut) => typed?.get(SHORTCUTS[shortcut].code)

/** How `shortcut` reads: `⌘⇧,` on macOS, `Ctrl+Shift+,` elsewhere. */
export function shortcutLabel(shortcut: Shortcut, mac = MAC) {
  const keys: { label: string; mac?: string } = SHORTCUTS[shortcut]
  const label = typedKey(shortcut)?.toUpperCase() ?? keys.label
  return mac ? `⌘⇧${keys.mac ?? label}` : `Ctrl+Shift+${label}`
}

/** `shortcut` for `aria-keyshortcuts`. */
export function ariaShortcut(shortcut: Shortcut, mac = MAC) {
  return `${mac ? 'Meta' : 'Control'}+Shift+${typedKey(shortcut) ?? SHORTCUTS[shortcut].key}`
}

/** The shortcut `event` presses, if any: the platform's modifier and Shift, nothing else. */
export function shortcutOf(event: KeyboardEvent, mac = MAC): Shortcut | undefined {
  if (event.isComposing || event.altKey || !event.shiftKey) return undefined
  if (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) {
    return undefined
  }
  const code = event.code === 'NumpadEnter' ? 'Enter' : event.code
  return SHORTCUT_LIST.find((shortcut) => SHORTCUTS[shortcut].code === code)
}

/**
 * Where the field `event` was typed in is, if it was one: in `widget` (`ours`), or in
 * the page's own.
 */
export function fieldOf(event: Event, widget?: Element | null) {
  const path = event.composedPath()
  const [target] = path
  if (
    !(target instanceof HTMLElement) ||
    !(target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  ) {
    return undefined
  }
  return widget && path.includes(widget) ? 'ours' : 'page'
}
