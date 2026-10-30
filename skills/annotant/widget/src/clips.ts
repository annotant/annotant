// What hides the parts of an element out of the window and the scrolling boxes that hold it.
import type { ReviewBox } from './domain'

type Box = ReviewBox

export interface Edges {
  top: number
  left: number
  right: number
  bottom: number
}

/** Whether a side of a box shows from `from` to `to`: with no `size`, at a point. */
const shows = (from: number, to: number, size: number) => (size ? to > from : to >= from)

/** The part of `box` inside `clip`, if any: a box with no size shows where it is. */
export function within(box: Box, clip: Edges): Box | undefined {
  const top = Math.max(box.top, clip.top)
  const left = Math.max(box.left, clip.left)
  const bottom = Math.min(box.top + box.height, clip.bottom)
  const right = Math.min(box.left + box.width, clip.right)
  return shows(top, bottom, box.height) && shows(left, right, box.width)
    ? { top, left, width: right - left, height: bottom - top }
    : undefined
}

/** An ancestor that cuts what overflows it, on one axis or both. */
export interface Clipper {
  element: Element
  x: boolean
  y: boolean
}

const cuts = (overflow: string) => overflow !== '' && overflow !== 'visible'

/** Whether its position is not the default one, which makes it hold its absolute descendants. */
export const positioned = (style: CSSStyleDeclaration) =>
  !!style.position && style.position !== 'static'

/** Whether its element holds its fixed descendants, as it holds its absolute ones. */
const holdsFixed = (style: CSSStyleDeclaration) =>
  [style.transform, style.filter, style.perspective].some(
    (value) => value && value !== 'none',
  ) ||
  /paint|layout|strict|content/.test(style.contain) ||
  /transform|filter|perspective/.test(style.willChange)

/**
 * What cuts what `element` holds: `element` and each ancestor that clips its
 * overflow (a scrolling sidebar, a list) and contains it, up to `body`, whose
 * overflow is the viewport's. `position` is that of what it holds: absolute
 * or fixed, it escapes the ancestors that do not contain it. Read with the
 * page's changes, not on every scroll: a scroll leaves them as they are.
 */
export function clippersOf(
  element: Element | null,
  position = 'static',
  styleOf: (element: Element) => CSSStyleDeclaration = getComputedStyle,
): Clipper[] {
  const clippers: Clipper[] = []
  for (
    let ancestor = element;
    ancestor && ancestor !== document.body && ancestor !== document.documentElement;
    ancestor = ancestor.parentElement
  ) {
    const style = styleOf(ancestor)
    const contains =
      position === 'fixed'
        ? holdsFixed(style)
        : position !== 'absolute' || positioned(style) || holdsFixed(style)
    if (!contains) continue
    position = style.position
    // Overflow cuts nothing on an inline box (a truncated `span`), nor on no box.
    if (style.display === 'inline' || style.display === 'contents') continue
    const x = cuts(style.overflowX)
    const y = cuts(style.overflowY)
    if (x || y) clippers.push({ element: ancestor, x, y })
  }
  return clippers
}

/** Where what `clippers` cut shows on screen: the viewport, cut by their padding boxes. */
export function clipOf(clippers: Clipper[]): Edges {
  const clip = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight }
  for (const { element, x, y } of clippers) {
    const rect = element.getBoundingClientRect()
    // Its padding box, scaled as its box is: its border and scrollbars hide what scrolls too.
    const scaled =
      element instanceof HTMLElement && element.offsetWidth && element.offsetHeight
    const scaleX = scaled ? rect.width / element.offsetWidth : 1
    const scaleY = scaled ? rect.height / element.offsetHeight : 1
    if (x) {
      const left = rect.left + element.clientLeft * scaleX
      clip.left = Math.max(clip.left, left)
      clip.right = Math.min(clip.right, left + element.clientWidth * scaleX)
    }
    if (y) {
      const top = rect.top + element.clientTop * scaleY
      clip.top = Math.max(clip.top, top)
      clip.bottom = Math.min(clip.bottom, top + element.clientHeight * scaleY)
    }
  }
  return clip
}
