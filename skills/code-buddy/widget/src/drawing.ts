import { boxOf, shownText } from './anchors'
import type { NewImage, ReviewBox, ReviewStroke } from './domain'

/** The widest side of the picture, in pixels: a drawing over a whole page stays readable. */
const MAX_SIDE = 1600
/** The lines' colour, styles.ts's --cb-ink, and the elements'. */
const INK = '#e5306b'
const OUTLINE = '#8792a2'
/** The element the lines point at, darker than the others. */
const TARGET = '#2f3a4a'

/** The words of an element's text an outline in the picture carries: enough to tell headings apart. */
const LABEL_WORDS = 6
const LABEL_LENGTH = 40

/** An element in the picture: its tag, then the first words of its text. */
function labelOf(element: Element): string {
  const words = shownText(element).split(' ').filter(Boolean)
  let text = words.slice(0, LABEL_WORDS).join(' ')
  if (text.length > LABEL_LENGTH) text = text.slice(0, LABEL_LENGTH - 1).trimEnd()
  const cut = text.length < words.join(' ').length ? '…' : ''
  return `<${element.tagName.toLowerCase()}>${text ? ` ${text}${cut}` : ''}`
}

/**
 * A picture of a drawing for Claude, which reads lines in a picture better
 * than as points: on a white ground over `frame`, wider than the lines' box
 * (`rect`), the outlines of the elements it records, each with its tag and
 * the first words of its text, the one the lines point at (`target`) solid,
 * then the lines over them. None where the browser draws no canvas.
 */
export function drawingImage(
  frame: ReviewBox,
  rect: ReviewBox,
  strokes: ReviewStroke[],
  elements: Element[],
  target?: Element,
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
  context.fillStyle = '#fff'
  context.fillRect(0, 0, frame.width, frame.height)

  context.font = '11px ui-monospace, monospace'
  context.textBaseline = 'top'
  const outlined = target && !elements.includes(target) ? [...elements, target] : elements
  for (const element of outlined) {
    const box = boxOf(element)
    const left = box.left - frame.left
    const top = box.top - frame.top
    const pointed = element === target
    context.strokeStyle = pointed ? TARGET : OUTLINE
    context.fillStyle = pointed ? TARGET : OUTLINE
    context.lineWidth = pointed ? 2 : 1
    context.setLineDash(pointed ? [] : [4, 3])
    context.strokeRect(left + 0.5, top + 0.5, box.width - 1, box.height - 1)
    context.fillText(labelOf(element), Math.max(2, left + 3), Math.max(2, top + 3))
  }

  // The lines are from the corner of their box, inside the frame.
  context.translate(rect.left - frame.left, rect.top - frame.top)
  context.setLineDash([])
  context.strokeStyle = INK
  context.lineWidth = 3
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const stroke of strokes) {
    const [first, ...rest] = stroke
    if (!first) continue
    context.beginPath()
    context.moveTo(first[0], first[1])
    // A dot is a line to itself, which a round cap draws.
    for (const [x, y] of rest.length ? rest : [first]) context.lineTo(x, y)
    context.stroke()
  }

  const url = canvas.toDataURL('image/png')
  return url.startsWith('data:image/png;base64,')
    ? { type: 'image/png', data: url.slice(url.indexOf(',') + 1) }
    : undefined
}
