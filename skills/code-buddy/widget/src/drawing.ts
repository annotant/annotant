import { UNREAD, WIDGET } from './anchors'
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

/** Whether a computed colour paints anything. */
const shows = (color: string) =>
  !!color && color !== 'transparent' && !/rgba?\(.*,\s*0(\.0*)?\)$/.test(color)

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

/**
 * Paints the page under `frame` on `context`, from its corner, close to what
 * the reader sees: the elements of `root` in the order the page has them,
 * each with its ground, its borders and, with `images`, its image, then its
 * own text, word by word where it is, in its font and colour; what an element
 * clips stays in it. No stacking order, SVG, video, canvas or shadow DOM.
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

  const paintText = (node: Text, style: CSSStyleDeclaration) => {
    if (!shows(style.color)) return
    context.fillStyle = style.color
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    for (const { 0: word, index } of node.data.matchAll(/\S+/g)) {
      range.setStart(node, index)
      range.setEnd(node, index + word.length)
      const box = range.getBoundingClientRect()
      if (!overlaps(frame, box)) continue
      if (++words > MAX_WORDS) return
      context.fillText(
        transformed(word, style.textTransform),
        box.left - frame.left,
        box.top - frame.top + box.height / 2,
        box.width + 1,
      )
    }
  }

  const paintBox = (element: Element, style: CSSStyleDeclaration, box: DOMRect) => {
    const left = box.left - frame.left
    const top = box.top - frame.top
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
  }

  const paint = (element: Element) => {
    if (element.matches(SKIPPED)) return
    const style = getComputedStyle(element)
    // Opacity is not inherited: an element see-through hides what it holds.
    if (style.display === 'none' || style.opacity === '0') return
    const box = element.getBoundingClientRect()
    const inFrame = overlaps(frame, box)
    if (inFrame && ++elements > MAX_ELEMENTS) return
    // Visibility is inherited, and a child can show again.
    const seen = style.visibility !== 'hidden'
    if (seen && inFrame) paintBox(element, style, box)
    const clips = style.overflowX !== 'visible' || style.overflowY !== 'visible'
    if (clips) {
      context.save()
      context.beginPath()
      context.rect(box.left - frame.left, box.top - frame.top, box.width, box.height)
      context.clip()
    }
    for (const child of element.childNodes) {
      if (child instanceof Text) {
        if (seen) paintText(child, style)
      } else if (child instanceof Element) paint(child)
    }
    if (clips) context.restore()
  }
  paint(root)
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
