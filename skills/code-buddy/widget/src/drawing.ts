import type { NewImage, ReviewBox, ReviewStroke } from './domain'

/** The widest side of the picture, in pixels: a drawing over a whole page stays readable. */
const MAX_SIDE = 1600
/** The lines' colour, styles.ts's --cb-ink. */
const INK = '#e5306b'
const WIDGET = '[data-code-buddy]'
/** Never painted: no box of their own, or a picture the canvas cannot copy. */
const SKIPPED = 'script, style, template, noscript, head, svg, canvas, video, iframe'
/** What the picture paints at most: a long page stays quick. */
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
 * Paints the page under `frame` on `context`, from its corner, as the reader
 * sees it, close enough: the elements of `root` in the order the page has
 * them, each with its ground, its borders and its image, then its own text,
 * word by word where it is, in its font and colour.
 */
function paintPage(context: CanvasRenderingContext2D, root: Element, frame: ReviewBox) {
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
    for (const { 0: word, index } of (node.data ?? '').matchAll(/\S+/g)) {
      if (++words > MAX_WORDS) return
      range.setStart(node, index)
      range.setEnd(node, index + word.length)
      const box = range.getBoundingClientRect()
      if (!overlaps(frame, box)) continue
      context.fillText(
        transformed(word, style.textTransform),
        box.left - frame.left,
        box.top - frame.top + box.height / 2,
        box.width + 1,
      )
    }
  }

  const paint = (element: Element) => {
    if (element.closest(WIDGET) || element.matches(SKIPPED)) return
    const style = getComputedStyle(element)
    if (style.display === 'none' || ++elements > MAX_ELEMENTS) return
    const box = element.getBoundingClientRect()
    const seen = style.visibility !== 'hidden' && style.opacity !== '0'
    if (seen && overlaps(frame, box)) {
      const left = box.left - frame.left
      const top = box.top - frame.top
      if (shows(style.backgroundColor)) {
        context.fillStyle = style.backgroundColor
        context.beginPath()
        context.roundRect(
          left,
          top,
          box.width,
          box.height,
          parseFloat(style.borderRadius) || 0,
        )
        context.fill()
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
      if (element instanceof HTMLImageElement && copyable(element))
        context.drawImage(element, left, top, box.width, box.height)
    }
    for (const child of element.childNodes) {
      if (child instanceof Text) {
        if (seen) paintText(child, style)
      } else if (child instanceof Element) paint(child)
    }
  }
  paint(root)
}

/**
 * A picture of a drawing for Claude, which reads lines in a picture better
 * than as points: the page under `frame`, wider than the lines' box (`rect`),
 * with its colours and text where the reader saw them, and the lines over it.
 * None where the browser draws no canvas.
 */
export function drawingImage(
  frame: ReviewBox,
  rect: ReviewBox,
  strokes: ReviewStroke[],
  root: Element,
): NewImage | undefined {
  const scale = Math.min(1, MAX_SIDE / Math.max(frame.width, frame.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(frame.width * scale))
  canvas.height = Math.max(1, Math.round(frame.height * scale))
  let context: CanvasRenderingContext2D | null = null
  try {
    context = canvas.getContext('2d')
  } catch {
    return undefined
  }
  if (!context) return undefined
  context.scale(scale, scale)
  paintPage(context, root, frame)

  // The lines are from the corner of their box, inside the frame, a light edge
  // under them so they show on any ground.
  context.translate(rect.left - frame.left, rect.top - frame.top)
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

  let url: string
  try {
    url = canvas.toDataURL('image/png')
  } catch {
    // A picture the page could not vouch for taints the canvas.
    return undefined
  }
  return url.startsWith('data:image/png;base64,')
    ? { type: 'image/png', data: url.slice(url.indexOf(',') + 1) }
    : undefined
}
