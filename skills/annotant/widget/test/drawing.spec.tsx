import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { anchorFromDrawing } from '../src/anchors'
import { drawingImage } from '../src/drawing'
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
  // Nor does it hit anything: under a point are the boxes holding it, the innermost first.
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: (x: number, y: number) =>
      [...document.querySelectorAll('[data-box]')]
        .filter((element) => {
          const { left, top, right, bottom } = element.getBoundingClientRect()
          return x >= left && x <= right && y >= top && y <= bottom
        })
        .toReversed(),
  })
  onTestFinished(() => {
    box.mockRestore()
    scroll.mockRestore()
    Reflect.deleteProperty(document, 'elementsFromPoint')
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
  const layer = screen.getByTestId('an-sketch')
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
  // The end of the longest line is on card B's text.
  expect(area?.pointsAt).toEqual({
    selector: 'section > div:nth-of-type(2) > p',
    tag: 'p',
    text: 'Card B',
  })
  expect(area?.strokes).toEqual([
    [
      [8, 8],
      [8, 118],
    ],
    [[28, 58]],
  ])
  expect(anchorFromDrawing(root, [[], []])).toBeUndefined()
})

test('what a drawing records reaches past its lines, to what an arrow stops short of', () => {
  layout()
  document.body.innerHTML = `<main data-box="0,0,1000,2000">${PAGE}</main>`
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')

  // An arrow down from card A, its tip in the gap above card B.
  const drawn = anchorFromDrawing(root, [
    [
      { x: 100, y: 250 },
      { x: 100, y: 330 },
    ],
  ])

  // The comment's box stays the lines', what Claude gets is 120px wider each way,
  // cut to the window: none of it past its left edge.
  expect(drawn?.rect).toEqual({ left: 92, top: 242, width: 16, height: 96 })
  expect(drawn?.reach).toEqual({ left: 0, top: 122, width: 228, height: 336 })
  // In the section, its box crosses the cards and their text.
  expect(drawn?.anchor.area?.crosses.map((node) => node.selector)).toEqual([
    'section > div:nth-of-type(1)',
    'section > div:nth-of-type(1) > p',
    'section > div:nth-of-type(2)',
    'section > div:nth-of-type(2) > p',
  ])
  // Its tip is on the section only: it points at what is next along it, card B's text.
  expect(drawn?.anchor.area?.pointsAt?.selector).toBe('section > div:nth-of-type(2) > p')
  // A wide drawing gets a quarter of its width on each side, in the 1024px window.
  expect(
    anchorFromDrawing(root, [
      [
        { x: 100, y: 200 },
        { x: 900, y: 200 },
      ],
    ])?.reach,
  ).toEqual({ left: 0, top: 72, width: 1024, height: 256 })
})

test("a drawing records its elements' text as the page shows it, blocks apart", () => {
  layout()
  document.body.innerHTML = `<main data-box="0,0,1000,2000">
    <article data-box="0,0,400,200"><span>Colombia</span><h3>Huila</h3></article>
  </main>`
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')

  const area = anchorFromDrawing(root, [[{ x: 100, y: 100 }]])?.anchor.area

  expect(area?.pointsAt?.text).toBe('Colombia Huila')
})

test('a drawing points at what is under the end of its longest line, drawn first or not', () => {
  layout()
  document.body.innerHTML = `<main data-box="0,0,1000,2000">${PAGE}</main>`
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')

  // A long arrow down to card B, then a short stroke on card A.
  const area = anchorFromDrawing(root, [
    [
      { x: 100, y: 250 },
      { x: 100, y: 360 },
    ],
    [
      { x: 50, y: 150 },
      { x: 60, y: 150 },
    ],
  ])?.anchor.area

  expect(area?.pointsAt?.text).toBe('Card B')
})

test('an arrow ending in a gap points at the element it heads for, never at what holds it', () => {
  layout()
  document.body.innerHTML = `<main data-box="0,0,1000,2000">${PAGE}</main>`
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')
  const pointed = (...points: [number, number][]) =>
    anchorFromDrawing(root, [points.map(([x, y]) => ({ x, y }))])?.anchor.area?.pointsAt
      ?.text

  // From the heading down into the gap above the section: its first card's text.
  expect(pointed([100, 30], [100, 80], [100, 95])).toBe('Card A')
  // Its head drawn in the same line, a hook back at the end: the shaft's direction still.
  expect(pointed([100, 250], [100, 330], [96, 326])).toBe('Card B')
  // From card A right into the empty section: nothing ahead, and the section holds it all.
  expect(pointed([300, 150], [700, 150])).toBeUndefined()
  // From the heading into the section, away from the cards: the section, which does not hold it.
  expect(pointed([600, 30], [600, 80], [600, 200])).toBe('Card A Card B')
  // A dot in a gap has no direction: nothing past it, and the section holds it.
  expect(pointed([100, 330])).toBeUndefined()
  // Down card A under its text: card B's is 170px past the tip, too far to be what it points at.
  expect(pointed([100, 150], [100, 180])).toBeUndefined()
  expect(pointed([100, 150], [100, 200])).toBe('Card B')
})

test('an arrow ending on a block with text of its own, or on a control, points at it', () => {
  layout()
  document.body.innerHTML = `<main data-box="0,0,1000,2000">
    <div data-box="0,0,1000,200">Notes<p data-box="0,100,400,40">Body</p></div>
    <p data-box="0,240,400,40">Above</p>
    <button data-box="0,300,400,100" style="display: flex">
      <span data-box="20,320,100,20">Save</span>
    </button>
    <p data-box="0,500,400,40">Below</p>
  </main>`
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')
  const pointed = (...points: [number, number][]) =>
    anchorFromDrawing(root, [points.map(([x, y]) => ({ x, y }))])?.anchor.area?.pointsAt
      ?.tag

  expect(pointed([600, 300], [600, 250], [600, 180])).toBe('div')
  expect(pointed([300, 600], [300, 450], [300, 380])).toBe('button')
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
  expect(screen.getByTestId('an-sketch').querySelectorAll('polyline')).toHaveLength(3)
  // A line too many: Undo takes it back.
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(screen.getByTestId('an-sketch').querySelectorAll('polyline')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))

  const box = await screen.findByRole('textbox', { name: 'What should change?' })
  expect(screen.queryByTestId('an-sketch')).toBeNull()
  expect(screen.getByTestId('an-area-chip').textContent).toBe(
    '2 linespoints at <p> Card B',
  )
  const drawn = await screen.findByTestId('an-area-target')
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
  // Saved, the lines are drawn, in the rainbow of a comment in progress.
  const mark = await screen.findByTestId('an-area-mark')
  expect(mark.querySelectorAll('polyline')).toHaveLength(2)
})

/**
 * A canvas that draws nothing: what counts is what it is told to paint, each
 * fill's colour and each word at its place, and the size of each picture.
 * A word is where its element's text starts, 20px wide each.
 */
function paintingCanvas() {
  const painted: string[] = []
  const state = { fillStyle: '' }
  const context = new Proxy(state, {
    get: (target, name) =>
      name === 'fillStyle'
        ? target.fillStyle
        : name === 'fillRect'
          ? () => painted.push(`ground ${target.fillStyle}`)
          : name === 'fillText'
            ? (text: string, x: number, y: number) =>
                painted.push(`${text} at ${x},${y} in ${target.fillStyle}`)
            : () => undefined,
    set: (target, name, value) => {
      if (name === 'fillStyle') target.fillStyle = String(value)
      return true
    },
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a canvas that only records what it paints
    context as unknown as CanvasRenderingContext2D,
  )
  const sizes: [number, number][] = []
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    sizes.push([this.width, this.height])
    return 'data:image/png;base64,iVBORw0KGgo='
  })
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Range,
  ) {
    const { left = 0, top = 0 } =
      this.startContainer.parentElement?.getBoundingClientRect() ?? {}
    return DOMRect.fromRect({
      x: left + this.startOffset * 4,
      y: top,
      width: 20,
      height: 20,
    })
  })
  return { painted, sizes }
}

/** The picture of `points`, one line, drawn over `root`, and what it paints. */
function picture(root: Element, ...points: [number, number][]) {
  const canvas = paintingCanvas()
  onTestFinished(() => {
    vi.restoreAllMocks()
  })
  const drawn = anchorFromDrawing(root, [points.map(([x, y]) => ({ x, y }))])
  if (!drawn) throw new Error('nothing drawn')
  const image = drawingImage(drawn.reach, drawn.rect, drawn.strokes, root)
  return {
    ...canvas,
    image,
    words: canvas.painted.filter((one) => !one.startsWith('ground')),
  }
}

test("a drawing near the window's edge is pictured with what the window shows only", () => {
  layout()
  document.body.innerHTML = `<main style="color: rgb(0, 0, 0)" data-box="0,0,1400,1000">
    <p data-box="900,700,100,20">Seen</p>
    <p data-box="900,780,100,20">Below</p>
    <p data-box="1030,700,100,20">Right</p>
  </main>`
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')

  // Lines in the window's corner, 1024 × 768: 120px of room up and left, down
  // and right up to the window's edges only.
  const { sizes, words } = picture(root, [950, 700], [1000, 740])

  expect(sizes).toEqual([[202, 196]])
  expect(words.map((word) => word.split(' ')[0])).toEqual(['Seen'])
})

test('a drawing over a modal is pictured in the stacking order, cut as the page is', () => {
  layout()
  document.body.innerHTML = `<main style="color: rgb(0, 0, 0)" data-box="0,0,1000,700">
    <div style="position: fixed; z-index: 10; background-color: rgb(255, 255, 255)" data-box="100,100,600,500">
      <div id="list" style="overflow-x: auto; overflow-y: auto" data-box="120,150,300,100">
        <p data-box="120,160,300,20">Item1505</p>
        <p data-box="120,300,300,20">Item1523</p>
        <ul style="position: absolute; background-color: rgb(0, 0, 255)" data-box="120,240,300,200">
          <li data-box="120,400,300,20">Escaped</li>
        </ul>
      </div>
      <footer data-box="100,520,600,60"><button data-box="500,530,80,30">Cancel</button></footer>
    </div>
    <table style="position: relative" data-box="0,0,1000,700">
      <tbody><tr><td data-box="100,140,200,20">Row1844</td></tr></tbody>
    </table>
  </main>`
  const root = document.querySelector('main')
  const list = document.getElementById('list')
  if (!root || !list) throw new Error('no root')
  // Its padding box, what its scrollbars and border leave of it.
  Object.defineProperties(list, {
    clientWidth: { value: 300, configurable: true },
    clientHeight: { value: 100, configurable: true },
  })

  const { painted } = picture(root, [200, 200], [400, 450])

  // The table, after the modal in the page but under it, then the modal: its
  // ground, its list cut where it scrolls, its footer, then its dropdown, which
  // the list does not hold, over them.
  expect(painted.map((one) => one.replace(/ at .*/, ''))).toEqual([
    'ground #fff',
    'Row1844',
    'ground rgb(255, 255, 255)',
    'Item1505',
    'Cancel',
    'ground rgb(0, 0, 255)',
    'Escaped',
  ])
})

test('a layer under the rest is painted first, one in a see-through block stays in it, a flex item stacks', () => {
  layout()
  document.body.innerHTML = `<main style="color: rgb(0, 0, 0)" data-box="0,0,1000,700">
    <div style="display: flex" data-box="100,100,400,300">
      <div style="z-index: 20; background-color: rgb(255, 255, 0)" data-box="100,100,400,300"></div>
    </div>
    <div style="position: relative" data-box="100,100,400,300">
      <p data-box="120,120,200,20">Front</p>
      <div style="position: absolute; z-index: -1; background-color: rgb(0, 128, 0)" data-box="100,100,400,300"></div>
    </div>
    <div style="opacity: 0.5" data-box="100,100,400,300">
      <div style="position: absolute; z-index: 100; background-color: rgb(255, 0, 0)" data-box="100,100,400,300"></div>
    </div>
    <div style="position: absolute; z-index: 10; background-color: rgb(0, 0, 255)" data-box="100,100,400,300"></div>
  </main>`
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')

  const { painted } = picture(root, [200, 200], [300, 300])

  // Its z-index of 100 counts in its block only, which stacks at 0: under the
  // z-index of 10. A flex item's counts, positioned or not: over them all.
  expect(painted.map((one) => one.replace(/ at .*/, ''))).toEqual([
    'ground #fff',
    'ground rgb(0, 128, 0)',
    'Front',
    'ground rgb(255, 0, 0)',
    'ground rgb(0, 0, 255)',
    'ground rgb(255, 255, 0)',
  ])
})

test("the drawing's picture goes with the comment, for Claude", async () => {
  const { painted, sizes } = paintingCanvas()
  onTestFinished(() => {
    vi.restoreAllMocks()
    document.body.style.removeProperty('background-color')
  })
  const server = renderCards()
  document.body.style.backgroundColor = 'rgb(16, 24, 40)'
  for (const card of document.querySelectorAll('p'))
    card.style.color = 'rgb(240, 200, 120)'

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
  // The picture is wider than the lines' box, 36 × 126: 120px more on each side,
  // but none past the window's left edge, 82px from the lines.
  expect(sizes).toEqual([[238, 366]])
  // The page under it, its ground and its text where it is, in its colour:
  // card A, which the arrow leaves, is in, the heading above is not.
  expect(painted).toEqual([
    'ground rgb(16, 24, 40)',
    'Card at 30,18 in rgb(240, 200, 120)',
    'A at 50,18 in rgb(240, 200, 120)',
    'Card at 30,238 in rgb(240, 200, 120)',
    'B at 50,238 in rgb(240, 200, 120)',
  ])
})

test('Enter on a focused tool is its own, and an undo while drawing takes that line back', async () => {
  renderCards()

  fireEvent.click(await screen.findByRole('button', { name: 'Draw' }))
  arrow()
  const undo = screen.getByRole('button', { name: 'Undo' })
  fireEvent.keyDown(undo, { key: 'Enter' })
  expect(screen.getByTestId('an-sketch')).toBeTruthy()

  // Ctrl+Z halfway through a line: the next moves draw nothing over the others.
  const layer = screen.getByTestId('an-sketch')
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
  expect(screen.getByTestId('an-sketch').querySelectorAll('polyline')).toHaveLength(0)
  // Nothing drawn, Enter ends nothing.
  fireEvent.keyDown(document, { key: 'Enter' })
  expect(screen.getByTestId('an-sketch')).toBeTruthy()

  arrow()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByTestId('an-sketch')).toBeNull()
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

  await screen.findByTestId('an-area-chip')
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'What should change?' })
      .value,
  ).toBe('This goes there')
  fireEvent.click(screen.getByRole('button', { name: 'Remove the drawing' }))
  expect(screen.queryByTestId('an-area-chip')).toBeNull()
  expect(screen.getByRole('checkbox')).toBeTruthy()
})

const DRAWING: ReviewArea = {
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

test('a drawing loses its rainbow once its agent has written a file', async () => {
  renderCards([comment({ area: DRAWING, state: 'working', edited: true })])

  const mark = await screen.findByTestId('an-area-mark')
  expect(mark.hasAttribute('data-outdated')).toBe(true)
  const lines = mark.querySelector('svg')
  expect(lines?.style.stroke).toBe('')
  expect(lines?.querySelector('linearGradient')).toBeNull()
})

test("the drawing's chip in a resolved thread shows it again on the page", async () => {
  openPanel('page', 'c1')
  renderCards([comment({ area: DRAWING, state: 'resolved' })])

  const chip = await screen.findByRole('button', { name: /1 line/ })
  expect(chip.title).toBe(
    'A drawing of 1 line over 36 × 126 px, drawn in a 1280 × 800 window',
  )
  fireEvent.mouseEnter(chip)
  const shown = await screen.findByTestId('an-area-target')
  expect(shown.querySelector('polyline')?.getAttribute('points')).toBe('8,8 8,118')
})
