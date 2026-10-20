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
    /** The key on a US keyboard, as `aria-keyshortcuts` names it: what it types on the reader's, when known. */
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
export interface KeyboardLayout {
  get(code: string): string | undefined
}

/** The Keyboard Map API, in Chromium only. */
interface WithKeyboard {
  keyboard?: { getLayoutMap?: () => Promise<KeyboardLayout> }
}

/**
 * What the keys type on the reader's keyboard, for the labels. The browser may
 * not tell (Firefox, Safari), or not to a frame: none, a US keyboard's labels.
 */
export async function readKeyboard(
  navigator: Partial<Navigator> & WithKeyboard = globalThis.navigator,
) {
  try {
    return await navigator.keyboard?.getLayoutMap?.()
  } catch (error) {
    // Refused here (a frame): as without the API. Anything else is a bug, to see.
    if (error instanceof DOMException) return undefined
    throw error
  }
}

/** How the labels read: on macOS or not, and on which keyboard (a US one, unknown). */
interface Reading {
  mac?: boolean
  keyboard?: KeyboardLayout | undefined
}

/** The key of `shortcut`, as it types on `keyboard`, if known. */
const typedKey = (shortcut: Shortcut, keyboard?: KeyboardLayout) =>
  keyboard?.get(SHORTCUTS[shortcut].code)

/** How `shortcut` reads: `⌘⇧,` on macOS, `Ctrl+Shift+,` elsewhere. */
export function shortcutLabel(shortcut: Shortcut, { mac = MAC, keyboard }: Reading = {}) {
  const keys: { label: string; mac?: string } = SHORTCUTS[shortcut]
  const label = typedKey(shortcut, keyboard)?.toUpperCase() ?? keys.label
  return mac ? `⌘⇧${keys.mac ?? label}` : `Ctrl+Shift+${label}`
}

/** `shortcut` for `aria-keyshortcuts`. */
export function ariaShortcut(shortcut: Shortcut, { mac = MAC, keyboard }: Reading = {}) {
  const key = typedKey(shortcut, keyboard) ?? SHORTCUTS[shortcut].key
  return `${mac ? 'Meta' : 'Control'}+Shift+${key}`
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
