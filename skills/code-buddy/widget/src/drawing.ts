import { boxOf } from './anchors'
import type { NewImage, ReviewBox, ReviewStroke } from './domain'

/** The widest side of the picture, in pixels: a drawing over a whole page stays readable. */
const MAX_SIDE = 1600
/** The lines' colour, styles.ts's --cb-ink, and the elements'. */
const INK = '#e5306b'
const OUTLINE = '#8792a2'

/**
 * A picture of a drawing for Claude, which reads lines in a picture better
 * than as points: on a white ground, the outlines of the elements its box
 * records, each with its tag, then the lines over them. None where the
 * browser draws no canvas.
 */
export function drawingImage(
  rect: ReviewBox,
  strokes: ReviewStroke[],
  elements: Element[],
): NewImage | undefined {
  const scale = Math.min(1, MAX_SIDE / Math.max(rect.width, rect.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rect.width * scale))
  canvas.height = Math.max(1, Math.round(rect.height * scale))
  let context: CanvasRenderingContext2D | null = null
  try {
    context = canvas.getContext('2d')
  } catch {
    return undefined
  }
  if (!context) return undefined
  context.scale(scale, scale)
  context.fillStyle = '#fff'
  context.fillRect(0, 0, rect.width, rect.height)

  context.strokeStyle = OUTLINE
  context.fillStyle = OUTLINE
  context.lineWidth = 1
  context.font = '11px ui-monospace, monospace'
  context.textBaseline = 'top'
  for (const element of elements) {
    const box = boxOf(element)
    const left = box.left - rect.left
    const top = box.top - rect.top
    context.setLineDash([4, 3])
    context.strokeRect(left + 0.5, top + 0.5, box.width - 1, box.height - 1)
    context.fillText(
      `<${element.tagName.toLowerCase()}>`,
      Math.max(2, left + 3),
      Math.max(2, top + 3),
    )
  }

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
