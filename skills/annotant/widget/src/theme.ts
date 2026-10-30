import { useEffect, useState } from 'react'

/**
 * How the app switches between light and dark, as `init` found it (`theme` in
 * `.annotant.json`): the OS setting (`media`), one theme only, or a class or
 * an attribute on `html` or `body`. With `light` too, the app follows the OS
 * while the element has neither value.
 */
export type ThemeSetting =
  | 'media'
  | 'light'
  | 'dark'
  | { on: 'html' | 'body'; attribute: string; dark: string; light?: string }

const DARK_MEDIA = '(prefers-color-scheme: dark)'

/** The setting in `value`, or undefined when it is not one. */
export function parseTheme(value: unknown): ThemeSetting | undefined {
  if (value === 'media' || value === 'light' || value === 'dark') return value
  if (!value || typeof value !== 'object') return undefined
  if (!('on' in value && 'attribute' in value && 'dark' in value)) return undefined
  const { on, attribute, dark } = value
  const light = 'light' in value ? value.light : undefined
  if (on !== 'html' && on !== 'body') return undefined
  if (typeof attribute !== 'string' || !/^[\w-]+$/.test(attribute)) return undefined
  if (typeof dark !== 'string' || !dark) return undefined
  if (light === undefined) return { on, attribute, dark }
  return typeof light === 'string' && light ? { on, attribute, dark, light } : undefined
}

/** Under this luminance, the page is dark: so is the widget, and a rainbow lightens the page rather than tints it. */
const DARK = 0.4

/** The page's background, from the first of `body` and `html` that has one. */
export function pageIsDark(): boolean {
  for (const element of [document.body, document.documentElement]) {
    const channels = getComputedStyle(element)
      .backgroundColor.match(/[\d.]+/g)
      ?.map(Number)
    const [r = 0, g = 0, b = 0, alpha = 1] = channels ?? []
    if (!channels || alpha === 0) continue
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < DARK
  }
  return false
}

/**
 * Calls `onChange` with whether the app is dark now, and again each time it
 * switches, until the returned function is called. Without a setting, the
 * page's background tells.
 */
function watchTheme(
  setting: ThemeSetting | undefined,
  onChange: (dark: boolean) => void,
): () => void {
  if (setting === 'light' || setting === 'dark') {
    onChange(setting === 'dark')
    return () => undefined
  }
  // The OS only counts for `media`, or for an element left on neither value.
  const os =
    setting === 'media' || (typeof setting === 'object' && setting.light)
      ? matchMedia(DARK_MEDIA)
      : undefined
  const observer = new MutationObserver(() => changed())
  let isDark = () => !!os?.matches
  if (!setting) {
    isDark = pageIsDark
    // What could change the page's background, the way the highlights watch it.
    for (const target of [document.documentElement, document.body]) {
      observer.observe(target, { attributes: true })
    }
  } else if (setting !== 'media') {
    const { on, attribute, dark, light } = setting
    const element = on === 'body' ? document.body : document.documentElement
    const has = (value: string) =>
      attribute === 'class'
        ? element.classList.contains(value)
        : element.getAttribute(attribute) === value
    isDark = () => has(dark) || (!!light && !has(light) && !!os?.matches)
    observer.observe(element, { attributes: true, attributeFilter: [attribute] })
  }
  const changed = () => onChange(isDark())
  os?.addEventListener('change', changed)
  changed()
  return () => {
    observer.disconnect()
    os?.removeEventListener('change', changed)
  }
}

/**
 * Whether the widget is dark: as the app is, by the `setting` the server
 * gave (`undefined` until it has, or when it has none).
 */
export function useDark(setting: ThemeSetting | undefined): boolean {
  const [dark, setDark] = useState(false)
  useEffect(() => watchTheme(setting, setDark), [setting])
  return dark
}
