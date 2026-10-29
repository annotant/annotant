// How the reader laid the widget out, kept for every tab of the app and the
// next sessions: the panel floating or docked, its width, and where the closed
// widget's tool strip is.
import { readLocal, writeLocal } from './session'

const LAYOUT_KEY = 'annotant:layout'

type Corner = `${'top' | 'bottom'}-${'left' | 'right'}`

/** From the window's corner nearest to it, so it stays there as the window changes size. */
export interface StripPlace {
  corner: Corner
  /** From the corner's left or right side. */
  x: number
  /** From its top or bottom side. */
  y: number
}

export interface Layout {
  docked?: boolean
  width?: number
  /** None: its own place, in the bottom right corner. */
  strip?: StripPlace
}

export interface Size {
  width: number
  height: number
}

export interface Box extends Size {
  left: number
  top: number
}

const CORNERS: readonly string[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] satisfies Corner[]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isCorner = (value: unknown): value is Corner =>
  typeof value === 'string' && CORNERS.includes(value)

function isStripPlace(value: unknown): value is StripPlace {
  return (
    isRecord(value) &&
    isCorner(value['corner']) &&
    isNumber(value['x']) &&
    isNumber(value['y'])
  )
}

/** What was kept, field by field: one written wrong, by hand or another version, is left out. */
export function readLayout(): Layout {
  const saved = readLocal(LAYOUT_KEY)
  const layout: Layout = {}
  if (!isRecord(saved)) return layout
  const { docked, width, strip } = saved
  if (typeof docked === 'boolean') layout.docked = docked
  if (isNumber(width)) layout.width = width
  if (isStripPlace(strip)) layout.strip = strip
  return layout
}

export function writeLayout(layout: Layout) {
  writeLocal(LAYOUT_KEY, layout)
}

/** The window the strip lies in, without its scrollbars, as `position: fixed` places it. */
export function viewport(): Size {
  const html = document.documentElement
  return {
    width: html.clientWidth || window.innerWidth,
    height: html.clientHeight || window.innerHeight,
  }
}

const clamp = (value: number, max: number) =>
  Math.min(Math.max(value, 0), Math.max(max, 0))

/** The strip at `box`, from the corner of the window nearest to its middle. */
export function placeOf(box: Box, bounds: Size): StripPlace {
  const right = box.left + box.width / 2 > bounds.width / 2
  const bottom = box.top + box.height / 2 > bounds.height / 2
  return {
    corner: `${bottom ? 'bottom' : 'top'}-${right ? 'right' : 'left'}`,
    x: Math.round(right ? bounds.width - box.left - box.width : box.left),
    y: Math.round(bottom ? bounds.height - box.top - box.height : box.top),
  }
}

/** The place within the window, all of the strip (`size`) on screen. */
export function fitPlace(place: StripPlace, size: Size, bounds: Size): StripPlace {
  return {
    ...place,
    x: clamp(place.x, bounds.width - size.width),
    y: clamp(place.y, bounds.height - size.height),
  }
}

/** The box `size` dragged to `left` and `top`, kept within the window. */
export function fitBox(left: number, top: number, size: Size, bounds: Size): Box {
  return {
    left: clamp(left, bounds.width - size.width),
    top: clamp(top, bounds.height - size.height),
    ...size,
  }
}

/** Its CSS: from its corner's two sides, so that it grows away from them, towards the window's inside. */
export function placeStyle({ corner, x, y }: StripPlace) {
  const [vertical, horizontal] = corner.split('-')
  return {
    top: vertical === 'top' ? y : 'auto',
    bottom: vertical === 'bottom' ? y : 'auto',
    left: horizontal === 'left' ? x : 'auto',
    right: horizontal === 'right' ? x : 'auto',
  }
}
