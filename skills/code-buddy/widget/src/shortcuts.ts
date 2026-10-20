/**
 * The widget's keyboard shortcuts: ⌘⇧ on macOS, Ctrl+Shift elsewhere, then a
 * key matched on `event.code`, where it is on the keyboard, so they work
 * whatever the layout. Letters with ⌘⇧ or Ctrl+Shift are nearly all taken by
 * the browsers (⌘⇧C, Ctrl+Shift+K, Ctrl+Shift+E…): these keys are not.
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
} as const

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

/** How `shortcut` reads: `⌘⇧,` on macOS, `Ctrl+Shift+,` elsewhere. */
export function shortcutLabel(shortcut: Shortcut, mac = MAC) {
  const keys: { label: string; mac?: string } = SHORTCUTS[shortcut]
  return mac ? `⌘⇧${keys.mac ?? keys.label}` : `Ctrl+Shift+${keys.label}`
}

/** `shortcut` for `aria-keyshortcuts`. */
export function ariaShortcut(shortcut: Shortcut, mac = MAC) {
  return `${mac ? 'Meta' : 'Control'}+Shift+${SHORTCUTS[shortcut].key}`
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
