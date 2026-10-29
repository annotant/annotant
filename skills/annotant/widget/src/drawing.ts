import { UNREAD, WIDGET } from './anchors'
import { clipOf, clippersOf, positioned, within } from './clips'
import type { NewImage, ReviewBox, ReviewStroke } from './domain'

/** The widest side of the picture, in pixels: a drawing over a whole page stays readable. */
const MAX_SIDE = 1600
/** The lines' colour, styles.ts's --cb-ink. */
const INK = '#e5306b'
/** Never painted: what the reader does not read, no box of its own, or a picture the canvas cannot copy. */
const SKIPPED = `${WIDGET}, ${UNREAD}, head, svg, canvas, video, iframe`
/** What the picture paints at most, in its frame: a busy page stays quick. */
const MAX_ELEMENTS = 3000
const MAX_WORDS = 4000

const BORDERS = ['Top', 'Right', 'Bottom', 'Left'] as const

/** Whether a computed colour paints anything: one with no alpha does, black too. */
const shows = (color: string) =>
  !!color &&
  color !== 'transparent' &&
  !/^rgba\(.*,\s*0(\.0*)?\)$|\/\s*0(\.0*)?%?\)$/.test(color)

const overlaps = (a: ReviewBox, b: DOMRect) =>
  b.width > 0 &&
  b.height > 0 &&
  a.left < b.right &&
  b.left < a.left + a.width &&
  a.top < b.bottom &&
  b.top < a.top + a.height

/** The page's own colour: the first ground of `<body>` and `<html>` that shows, white otherwise. */
function groundOf(): string {
  for (const element of [document.body, document.documentElement]) {
    const color = element && getComputedStyle(element).backgroundColor
    if (color && shows(color)) return color
  }
  return '#fff'
}

/** An image the canvas can copy and still be read: the page's own, or inline. */
function copyable(image: HTMLImageElement): boolean {
  if (!image.complete || !image.naturalWidth) return false
  try {
    const url = new URL(image.currentSrc || image.src, document.baseURI)
    return url.origin === window.location.origin || /^(data|blob):$/.test(url.protocol)
  } catch {
    return false
  }
}

function transformed(word: string, transform: string): string {
  if (transform === 'uppercase') return word.toUpperCase()
  if (transform === 'lowercase') return word.toLowerCase()
  if (transform === 'capitalize') return word.charAt(0).toUpperCase() + word.slice(1)
  return word
}

/** A layer of the page's stacking order: its z-index, and what paints it. */
interface Layer {
  z: number
  paint: () => void
}

/** Whether an element stacks what it holds apart, over or under the rest: most of what makes a stacking context. */
const stacks = (style: CSSStyleDeclaration, item: boolean) =>
  ((positioned(style) || item) && !!style.zIndex && style.zIndex !== 'auto') ||
  style.position === 'fixed' ||
  style.position === 'sticky' ||
  parseFloat(style.opacity) < 1 ||
  [style.transform, style.filter].some((value) => !!value && value !== 'none') ||
  style.isolation === 'isolate'

/** Its z-index, which counts on a positioned element, or on a flex or grid item (`item`). */
const zOf = (style: CSSStyleDeclaration, item: boolean) =>
  positioned(style) || item ? parseInt(style.zIndex, 10) || 0 : 0

/**
 * Paints the page under `frame` on `context`, from its corner, close to what
 * the reader sees: the elements of `root` in their stacking order (what holds
 * them, then their z-index and position, then the order the page has them),
 * each with its ground, its borders and, with `images`, its image, then its
 * own text, word by word where it is, in its font and colour. Each is cut by
 * the window and the scrolling boxes that hold it, the ones an absolute or
 * fixed element escapes aside. No SVG, video, canvas, shadow DOM, rotated
 * or skewed boxes, or clip-path.
 */
function paintPage(
  context: CanvasRenderingContext2D,
  root: Element,
  frame: ReviewBox,
  images: boolean,
) {
  context.fillStyle = groundOf()
  context.fillRect(0, 0, frame.width, frame.height)
  context.textBaseline = 'middle'
  const range = document.createRange()
  let elements = 0
  let words = 0

  const styles = new Map<Element, CSSStyleDeclaration>()
  const styleOf = (element: Element) => {
    const known = styles.get(element)
    if (known) return known
    const style = getComputedStyle(element)
    styles.set(element, style)
    return style
  }
  // What shows in the frame of what `holder` holds, at `position`: read once per holder.
  const shown = new Map<Element | null, Map<string, ReviewBox | undefined>>()
  const shownIn = (holder: Element | null, position: string) => {
    let known = shown.get(holder)
    if (!known) shown.set(holder, (known = new Map()))
    if (!known.has(position))
      known.set(position, within(frame, clipOf(clippersOf(holder, position, styleOf))))
    return known.get(position)
  }
  const clipped = (to: ReviewBox, paint: () => void) => {
    context.save()
    context.beginPath()
    context.rect(to.left - frame.left, to.top - frame.top, to.width, to.height)
    context.clip()
    try {
      paint()
    } finally {
      context.restore()
    }
  }

  const paintText = (node: Text, element: Element, style: CSSStyleDeclaration) => {
    // The cheap checks first: most text nodes are blanks between elements.
    if (
      words >= MAX_WORDS ||
      elements > MAX_ELEMENTS ||
      !shows(style.color) ||
      !/\S/.test(node.data)
    )
      return
    const to = shownIn(element, 'static')
    if (!to) return
    clipped(to, () => {
      context.fillStyle = style.color
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      for (const { 0: word, index } of node.data.matchAll(/\S+/g)) {
        range.setStart(node, index)
        range.setEnd(node, index + word.length)
        const box = range.getBoundingClientRect()
        if (!overlaps(to, box)) continue
        if (++words > MAX_WORDS) return
        context.fillText(
          transformed(word, style.textTransform),
          box.left - frame.left,
          box.top - frame.top + box.height / 2,
          box.width + 1,
        )
      }
    })
  }

  const paintBox = (element: Element, style: CSSStyleDeclaration) => {
    // Visibility is inherited, and a child can show again.
    if (style.visibility === 'hidden') return
    const box = element.getBoundingClientRect()
    if (!overlaps(frame, box)) return
    const to = shownIn(element.parentElement, style.position)
    if (!to || !overlaps(to, box) || ++elements > MAX_ELEMENTS) return
    const left = box.left - frame.left
    const top = box.top - frame.top
    clipped(to, () => {
      if (shows(style.backgroundColor)) {
        context.fillStyle = style.backgroundColor
        const radius = parseFloat(style.borderRadius) || 0
        if (radius && typeof context.roundRect === 'function') {
          context.beginPath()
          context.roundRect(left, top, box.width, box.height, radius)
          context.fill()
        } else context.fillRect(left, top, box.width, box.height)
      }
      for (const side of BORDERS) {
        const width = parseFloat(style[`border${side}Width`]) || 0
        const color = style[`border${side}Color`]
        if (!width || !shows(color) || /none|hidden/.test(style[`border${side}Style`]))
          continue
        context.fillStyle = color
        if (side === 'Top') context.fillRect(left, top, box.width, width)
        if (side === 'Bottom')
          context.fillRect(left, top + box.height - width, box.width, width)
        if (side === 'Left') context.fillRect(left, top, width, box.height)
        if (side === 'Right')
          context.fillRect(left + box.width - width, top, width, box.height)
      }
      if (images && element instanceof HTMLImageElement && copyable(element))
        context.drawImage(element, left, top, box.width, box.height)
    })
  }

  // What `element` holds: in its flow, painted in the page's order, or in a layer.
  // A positioned element with no z-index is a layer of its own, but what it
  // holds positioned stacks with the layers around it.
  const gather = (
    element: Element,
    style: CSSStyleDeclaration,
    flow: (() => void)[],
    layers: Layer[],
  ) => {
    // A z-index counts on what a flex or grid lays out, positioned or not.
    const item = /flex|grid/.test(style.display)
    for (const child of element.childNodes) {
      if (child instanceof Text) {
        if (style.visibility !== 'hidden')
          flow.push(() => paintText(child, element, style))
        continue
      }
      if (!(child instanceof Element) || child.matches(SKIPPED)) continue
      const own = styleOf(child)
      // Opacity is not inherited: an element see-through hides what it holds.
      if (own.display === 'none' || own.opacity === '0') continue
      if (stacks(own, item))
        layers.push({ z: zOf(own, item), paint: () => paintStack(child, own) })
      else if (positioned(own)) {
        const inner: (() => void)[] = []
        layers.push({
          z: 0,
          paint: () => {
            paintBox(child, own)
            for (const paint of inner) paint()
          },
        })
        gather(child, own, inner, layers)
      } else {
        flow.push(() => paintBox(child, own))
        gather(child, own, flow, layers)
      }
    }
  }

  // An element that stacks what it holds: its box, the layers under the rest,
  // what is in its flow, then the other layers.
  const paintStack = (element: Element, style: CSSStyleDeclaration) => {
    paintBox(element, style)
    const flow: (() => void)[] = []
    const layers: Layer[] = []
    gather(element, style, flow, layers)
    // A stable sort: layers with the same z-index keep the page's order.
    layers.sort((a, b) => a.z - b.z)
    for (const layer of layers) if (layer.z < 0) layer.paint()
    for (const paint of flow) paint()
    for (const layer of layers) if (layer.z >= 0) layer.paint()
  }

  if (root.matches(SKIPPED)) return
  const style = styleOf(root)
  if (style.display !== 'none' && style.opacity !== '0') paintStack(root, style)
}

/** The lines on `context`, from the corner of their box at `left`, `top`, a light edge under them so they show on any ground. */
function paintStrokes(
  context: CanvasRenderingContext2D,
  strokes: ReviewStroke[],
  left: number,
  top: number,
) {
  context.translate(left, top)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const [color, width] of [
    ['rgba(255, 255, 255, 0.85)', 6],
    [INK, 3],
  ] as const) {
    context.strokeStyle = color
    context.lineWidth = width
    for (const stroke of strokes) {
      const [first, ...rest] = stroke
      if (!first) continue
      context.beginPath()
      context.moveTo(first[0], first[1])
      // A dot is a line to itself, which a round cap draws.
      for (const [x, y] of rest.length ? rest : [first]) context.lineTo(x, y)
      context.stroke()
    }
  }
}

/**
 * A picture of a drawing for Claude, which reads lines in a picture better
 * than as points: the page under `frame`, wider than the lines' box (`rect`),
 * with its colours and text where the reader saw them, and the lines over it.
 * Without the page's images when one of them keeps the picture from being
 * read; none where the browser draws no canvas.
 */
export function drawingImage(
  frame: ReviewBox,
  rect: ReviewBox,
  strokes: ReviewStroke[],
  root: Element,
): NewImage | undefined {
  const scale = Math.min(1, MAX_SIDE / Math.max(frame.width, frame.height))
  const draw = (images: boolean): string | undefined => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(frame.width * scale))
    canvas.height = Math.max(1, Math.round(frame.height * scale))
    try {
      const context = canvas.getContext('2d')
      if (!context) return undefined
      context.scale(scale, scale)
      paintPage(context, root, frame, images)
      paintStrokes(context, strokes, rect.left - frame.left, rect.top - frame.top)
      return canvas.toDataURL('image/png')
    } catch {
      // No canvas, or one an image of another origin tainted.
      return undefined
    }
  }
  const url = draw(true) ?? draw(false)
  return url?.startsWith('data:image/png;base64,')
    ? { type: 'image/png', data: url.slice(url.indexOf(',') + 1) }
    : undefined
}
