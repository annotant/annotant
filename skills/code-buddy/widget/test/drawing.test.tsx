import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { anchorFromDrawing } from '../src/anchors'
import type { NewReviewComment, ReviewArea, ReviewComment } from '../src/domain'
import { comment, fakeServer, openPanel } from './server'
import { renderWidget } from './widget'

/** Two cards in a section, a gap of 20px between them. */
const PAGE = `
  <h1 data-box="0,0,1000,60">Playground</h1>
  <section data-box="0,100,1000,400">
    <div data-box="20,120,400,200"><p data-box="30,130,300,40">Card A</p></div>
    <div data-box="20,340,400,140"><p data-box="30,350,300,40">Card B</p></div>
  </section>
`

/** happy-dom lays nothing out: each element's box is its `data-box` (left, top, width, height). */
function layout() {
  const box = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      const [x = 0, y = 0, width = 0, height = 0] = (this.getAttribute('data-box') ?? '')
        .split(',')
        .map(Number)
      return DOMRect.fromRect({ x, y, width, height })
    })
  const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
  onTestFinished(() => {
    box.mockRestore()
    scroll.mockRestore()
  })
}

function renderCards(comments: ReviewComment[] = []) {
  layout()
  document.body.replaceChildren()
  const server = fakeServer(comments)
  renderWidget()
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')
  root.setAttribute('data-box', '0,0,1000,2000')
  root.innerHTML = PAGE
  return server
}

/** Draws one line through `points` over the drawing layer. */
function line(...points: [number, number][]) {
  const layer = screen.getByTestId('cb-sketch')
  const [first = [0, 0], ...rest] = points
  fireEvent.pointerDown(layer, {
    button: 0,
    pointerId: 1,
    clientX: first[0],
    clientY: first[1],
  })
  for (const [x, y] of rest)
    fireEvent.pointerMove(layer, { pointerId: 1, clientX: x, clientY: y })
  fireEvent.pointerUp(layer, { pointerId: 1 })
}

/** An arrow from card A down to card B: its shaft, then its head. */
function arrow() {
  line([100, 250], [100, 300], [100, 360])
  line([90, 350], [100, 360], [110, 350])
}

test('a drawing is the box of its lines, with what it lies in, and its lines from its corner', () => {
  layout()
  document.body.innerHTML = `<main data-box="0,0,1000,2000">${PAGE}</main>`
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')

  const area = anchorFromDrawing(root, [
    [
      { x: 100, y: 250 },
      { x: 100, y: 360 },
    ],
    [{ x: 120.4, y: 300 }],
  ])?.anchor.area

  // The lines' box, 8px of room on each side.
  expect([area?.left, area?.top, area?.width, area?.height]).toEqual([92, 242, 36, 126])
  expect(area?.within?.selector).toBe('section')
  expect(area?.crosses.map((node) => node.selector)).toEqual([
    'section > div:nth-of-type(1)',
    'section > div:nth-of-type(2)',
    'section > div:nth-of-type(2) > p',
  ])
  expect(area?.strokes).toEqual([
    [
      [8, 8],
      [8, 118],
    ],
    [[28, 58]],
  ])
  expect(anchorFromDrawing(root, [[], []])).toBeUndefined()
})

test('a long line keeps at most 400 points, its ends among them', () => {
  layout()
  document.body.innerHTML = `<main data-box="0,0,1000,2000">${PAGE}</main>`
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')
  const points = Array.from({ length: 1000 }, (_, x) => ({ x, y: 200 }))

  const [stroke = []] = anchorFromDrawing(root, [points])?.strokes ?? []

  expect(stroke).toHaveLength(400)
  expect(stroke[0]).toEqual([8, 8])
  expect(stroke.at(-1)).toEqual([1007, 8])
})

test('a drawing keeps its latest lines, and is the box of those only', () => {
  layout()
  document.body.innerHTML = `<main data-box="0,0,1000,2000">${PAGE}</main>`
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')
  // A line far up the page, then 40 short ones over card B.
  const lines = [
    [{ x: 500, y: 10 }],
    ...Array.from({ length: 40 }, (_, at) => [{ x: 30 + at, y: 360 }]),
  ]

  const drawn = anchorFromDrawing(root, lines)

  expect(drawn?.strokes).toHaveLength(40)
  expect(drawn?.rect).toEqual({ left: 22, top: 352, width: 55, height: 16 })
  // Long lines: 4000 points in all at most, the earliest lines left out.
  const long = Array.from({ length: 12 }, (_, at) =>
    Array.from({ length: 400 }, (__, x) => ({ x, y: 400 + at })),
  )
  expect(anchorFromDrawing(root, long)?.strokes).toHaveLength(10)
})

test('lines drawn on the page are commented on, and stay drawn while the comment is written', async () => {
  const comments: ReviewComment[] = []
  const server = renderCards(comments)

  fireEvent.click(await screen.findByRole('button', { name: 'Draw' }))
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Done' }).disabled).toBe(
    true,
  )
  arrow()
  line([500, 500], [600, 600])
  expect(screen.getByTestId('cb-sketch').querySelectorAll('polyline')).toHaveLength(3)
  // A line too many: Undo takes it back.
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(screen.getByTestId('cb-sketch').querySelectorAll('polyline')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))

  const box = await screen.findByRole('textbox', { name: 'What should change?' })
  expect(screen.queryByTestId('cb-sketch')).toBeNull()
  expect(screen.getByTestId('cb-area-chip').textContent).toBe(
    '2 linesacross <div> <div> <p>',
  )
  const drawn = await screen.findByTestId('cb-area-target')
  expect(drawn.querySelectorAll('polyline')).toHaveLength(2)

  fireEvent.change(box, { target: { value: 'Move card A under card B' } })
  fireEvent.keyDown(box, { key: 'Enter' })

  await waitFor(() => expect(comments).toHaveLength(1))
  const area: Partial<ReviewArea> | undefined = comments[0]?.anchor.area
  expect(area).toMatchObject({ left: 82, top: 242, width: 36, height: 126 })
  expect(area?.strokes).toHaveLength(2)
  // No canvas here: no picture, and the area says so.
  expect(area?.pictured).toBeUndefined()
  const [, init] =
    server.fetch.mock.calls.find(([, call]) => call?.method === 'POST') ?? []
  expect(typeof init?.body === 'string' && init.body.includes('"images"')).toBe(false)
  // Saved, the lines are drawn in the rainbow frame of a comment in progress.
  const mark = await screen.findByTestId('cb-area-mark')
  expect(mark.querySelectorAll('polyline')).toHaveLength(2)
})

test("the drawing's picture goes with the comment, for Claude", async () => {
  const context = new Proxy(
    {},
    { get: (_, name) => (name === 'canvas' ? undefined : () => undefined) },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    // A canvas that draws nothing: what counts here is the picture it gives.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    context as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,iVBORw0KGgo=',
  )
  onTestFinished(() => {
    vi.restoreAllMocks()
  })
  const server = renderCards()

  fireEvent.click(await screen.findByRole('button', { name: 'Draw' }))
  arrow()
  fireEvent.keyDown(document, { key: 'Enter' })
  const box = await screen.findByRole('textbox', { name: 'What should change?' })
  fireEvent.change(box, { target: { value: 'Move card A under card B' } })
  fireEvent.keyDown(box, { key: 'Enter' })

  await waitFor(() =>
    expect(server.fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(
      true,
    ),
  )
  const [, init] =
    server.fetch.mock.calls.find(([, call]) => call?.method === 'POST') ?? []
  const body = typeof init?.body === 'string' ? init.body : ''
  // The widget sends a new comment: the test reads it back as one.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const sent = JSON.parse(body) as NewReviewComment
  expect(sent.images).toEqual([{ type: 'image/png', data: 'iVBORw0KGgo=' }])
  expect(sent.anchor.area?.pictured).toBe(true)
})

test('Enter on a focused tool is its own, and an undo while drawing takes that line back', async () => {
  renderCards()

  fireEvent.click(await screen.findByRole('button', { name: 'Draw' }))
  arrow()
  const undo = screen.getByRole('button', { name: 'Undo' })
  fireEvent.keyDown(undo, { key: 'Enter' })
  expect(screen.getByTestId('cb-sketch')).toBeTruthy()

  // Ctrl+Z halfway through a line: the next moves draw nothing over the others.
  const layer = screen.getByTestId('cb-sketch')
  fireEvent.pointerDown(layer, { button: 0, pointerId: 1, clientX: 500, clientY: 500 })
  fireEvent.keyDown(document, { key: 'z', ctrlKey: true })
  fireEvent.pointerMove(layer, { pointerId: 1, clientX: 600, clientY: 600 })
  fireEvent.pointerUp(layer, { pointerId: 1 })
  const kept = [...layer.querySelectorAll('polyline')].map((one) =>
    one.getAttribute('points'),
  )
  expect(kept).toEqual(['100,250 100,300 100,360', '90,350 100,360 110,350'])
})

test('Clear takes every line back, and Escape leaves the drawing', async () => {
  renderCards()

  fireEvent.click(await screen.findByRole('button', { name: 'Draw' }))
  arrow()
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  expect(screen.getByTestId('cb-sketch').querySelectorAll('polyline')).toHaveLength(0)
  // Nothing drawn, Enter ends nothing.
  fireEvent.keyDown(document, { key: 'Enter' })
  expect(screen.getByTestId('cb-sketch')).toBeTruthy()

  arrow()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByTestId('cb-sketch')).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
})

test('a drawing made from a page comment keeps what the reader wrote, and goes with its removal', async () => {
  renderCards()
  fireEvent.click(await screen.findByRole('button', { name: 'Comment' }))
  const text = await screen.findByRole('textbox', { name: 'What should change?' })
  fireEvent.change(text, { target: { value: 'This goes there' } })

  fireEvent.click(screen.getByRole('button', { name: 'Draw on the page' }))
  arrow()
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))

  await screen.findByTestId('cb-area-chip')
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'What should change?' })
      .value,
  ).toBe('This goes there')
  fireEvent.click(screen.getByRole('button', { name: 'Remove the drawing' }))
  expect(screen.queryByTestId('cb-area-chip')).toBeNull()
  expect(screen.getByRole('checkbox')).toBeTruthy()
})

test("the drawing's chip in a resolved thread shows it again on the page", async () => {
  const drawing: ReviewArea = {
    top: 242,
    left: 92,
    width: 36,
    height: 126,
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
    covers: [],
    crosses: [],
    strokes: [
      [
        [8, 8],
        [8, 118],
      ],
    ],
  }
  openPanel('page', 'c1')
  renderCards([comment({ area: drawing, state: 'resolved' })])

  const chip = await screen.findByRole('button', { name: /1 line/ })
  expect(chip.title).toBe(
    'A drawing of 1 line over 36 × 126 px, drawn in a 1280 × 800 window',
  )
  fireEvent.mouseEnter(chip)
  const shown = await screen.findByTestId('cb-area-target')
  expect(shown.querySelector('polyline')?.getAttribute('points')).toBe('8,8 8,118')
})
