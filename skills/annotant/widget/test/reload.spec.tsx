import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import type { ReviewComment } from '../src/domain'
import { comment, fakeEvents, fakeServer, openPanel } from './server'
import { renderWidget, startPageComment } from './widget'

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

/** The widget over the two cards, the cards rendered after it, as an app renders its page. */
function renderCards(comments: ReviewComment[] = [], page = PAGE) {
  layout()
  document.body.replaceChildren()
  const server = fakeServer(comments)
  const view = renderWidget()
  const root = document.querySelector('main')
  if (!root) throw new Error('no root')
  root.setAttribute('data-box', '0,0,1000,2000')
  root.innerHTML = page
  return { ...server, view }
}

/** The dev server reloads the page: the widget starts again, from what the tab kept. */
function reload(comments: ReviewComment[] = [], page = PAGE) {
  const { view } = renderCards(comments, page)
  return view
}

/** Drags from one corner to the other over the drawing layer. */
function drag(from: [number, number], to: [number, number]) {
  fireEvent.mouseDown(screen.getByTestId('an-draw'), {
    button: 0,
    clientX: from[0],
    clientY: from[1],
  })
  fireEvent.mouseMove(document, { clientX: to[0], clientY: to[1] })
  fireEvent.mouseUp(document, { clientX: to[0], clientY: to[1] })
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

const messageBox = () =>
  screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'What should change?' })

test('a draft with a drawn area and its text comes back once the page reloads', async () => {
  const { view } = renderCards()
  fireEvent.click(await screen.findByRole('button', { name: 'Draw area' }))
  drag([10, 300], [510, 360])
  fireEvent.change(await messageBox(), { target: { value: 'Tighten this gap' } })

  view.unmount()
  const comments: ReviewComment[] = []
  reload(comments)

  const box = await messageBox()
  expect(box.value).toBe('Tighten this gap')
  expect(screen.getByTestId('an-area-chip').textContent).toBe(
    '500 × 60across <div> <div> <p>',
  )
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(comments).toHaveLength(1))
  expect(comments[0]?.anchor.area).toMatchObject({ width: 500, height: 60 })
  expect(comments[0]?.messages[0]?.body).toBe('Tighten this gap')
})

test('a draft sent is not back after a reload', async () => {
  const comments: ReviewComment[] = []
  const { view } = renderCards(comments)
  await startPageComment()
  const box = await messageBox()
  fireEvent.change(box, { target: { value: 'Make it blue' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(comments).toHaveLength(1))

  view.unmount()
  reload(comments)

  await screen.findByRole('heading', { name: 'Comments' })
  expect(screen.queryByRole('textbox', { name: 'What should change?' })).toBeNull()
})

test('the lines of a drawing in progress come back once the page reloads', async () => {
  const { view } = renderCards()
  fireEvent.click(await screen.findByRole('button', { name: 'Draw' }))
  line([100, 250], [100, 300], [100, 360])
  line([90, 350], [100, 360], [110, 350])

  view.unmount()
  reload()

  const layer = await screen.findByTestId('an-sketch')
  expect(layer.querySelectorAll('polyline')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  await messageBox()
  expect(screen.getByTestId('an-area-chip').textContent).toBe(
    '2 linespoints at <p> Card B',
  )
})

test('the area being drawn, or the element being pointed at, is still the tool after a reload', async () => {
  const first = renderCards().view
  fireEvent.click(await screen.findByRole('button', { name: 'Draw area' }))
  first.unmount()
  const second = reload()
  expect(await screen.findByTestId('an-draw')).toBeTruthy()

  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(await screen.findByRole('button', { name: 'Point at element' }))
  second.unmount()
  reload()
  expect(await screen.findByText(/^Click an element to comment on it/)).toBeTruthy()
  expect(screen.queryByTestId('an-draw')).toBeNull()
})

test('a draft whose area is gone from the page comes back with its text alone, once it gave up waiting', async () => {
  const { view } = renderCards()
  fireEvent.click(await screen.findByRole('button', { name: 'Draw area' }))
  drag([10, 300], [510, 360])
  fireEvent.change(await messageBox(), { target: { value: 'Tighten this gap' } })

  view.unmount()
  vi.useFakeTimers({ toFake: ['Date', 'requestAnimationFrame', 'cancelAnimationFrame'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  // The agent took the section away: the area waits for it, then gives up.
  reload([], '<h1 data-box="0,0,1000,60">Playground</h1>')
  act(() => {
    vi.advanceTimersByTime(1000)
  })
  expect(screen.queryByRole('textbox', { name: 'What should change?' })).toBeNull()
  act(() => {
    vi.advanceTimersByTime(5000)
  })

  expect((await messageBox()).value).toBe('Tighten this gap')
  expect(screen.queryByTestId('an-area-chip')).toBeNull()
  expect(screen.getByText(/^Linked to the current page/)).toBeTruthy()
})

test('a draft on selected text comes back with its quote', async () => {
  const { view } = renderCards()
  const text = document.querySelectorAll('p')[1]?.firstChild
  if (!text) throw new Error('no text')
  const range = document.createRange()
  range.selectNodeContents(text)
  const selection = getSelection()
  if (!selection) throw new Error('no selection')
  selection.removeAllRanges()
  selection.addRange(range)
  selection.toString = () => 'Card B'
  document.dispatchEvent(new Event('selectionchange'))
  fireEvent.click(await screen.findByTestId('an-selection'))
  fireEvent.change(await messageBox(), { target: { value: 'Say more' } })

  view.unmount()
  reload()

  expect((await messageBox()).value).toBe('Say more')
  expect(document.querySelector('.an-quote')?.textContent).toBe('Card B')
})

test('a draft started while the kept one waits for the page is the one kept', async () => {
  const { view } = renderCards()
  fireEvent.click(await screen.findByRole('button', { name: 'Draw area' }))
  drag([10, 300], [510, 360])
  fireEvent.change(await messageBox(), { target: { value: 'Tighten this gap' } })

  view.unmount()
  reload([], '<h1 data-box="0,0,1000,60">Playground</h1>')
  fireEvent.click(await screen.findByRole('button', { name: 'New comment' }))
  fireEvent.change(await messageBox(), { target: { value: 'Something else' } })
  // The section is back: the kept draft could come back, but a draft is written.
  document.querySelector('main')?.insertAdjacentHTML('beforeend', PAGE)
  await new Promise((done) => requestAnimationFrame(done))
  await new Promise((done) => requestAnimationFrame(done))

  expect((await messageBox()).value).toBe('Something else')
  expect(screen.queryByTestId('an-area-chip')).toBeNull()
})

test('a draft cancelled, or a drawing left, is not back after a reload', async () => {
  const first = renderCards().view
  await startPageComment()
  fireEvent.change(await messageBox(), { target: { value: 'Never mind' } })
  fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Draw' }))
  line([100, 250], [100, 300])
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByTestId('an-sketch')).toBeNull())

  first.unmount()
  reload()

  await screen.findByRole('button', { name: 'Draw' })
  expect(screen.queryByRole('textbox', { name: 'What should change?' })).toBeNull()
  expect(screen.queryByTestId('an-sketch')).toBeNull()
})

test('a drawing started from a comment on the page keeps what the reader wrote, through a reload', async () => {
  const { view } = renderCards()
  await startPageComment()
  fireEvent.change(await messageBox(), { target: { value: 'Arrow here' } })
  fireEvent.click(screen.getByRole('button', { name: 'Draw on the page' }))
  line([100, 250], [100, 300], [100, 360])

  view.unmount()
  reload()

  fireEvent.click(await screen.findByRole('button', { name: 'Done' }))
  await waitFor(async () => expect((await messageBox()).value).toBe('Arrow here'))
  expect(screen.getByTestId('an-area-chip').textContent).toMatch(/^1 line/)
})

const IMAGE = { type: 'image/png', data: 'iVBORw0KGgo=' }

test('too big for the tab, the images are left out, and the drawing keeps its picture', async () => {
  sessionStorage.setItem(
    'annotant:draft',
    JSON.stringify({
      route: '/',
      url: 'http://localhost/',
      body: 'Look',
      section: '',
      quote: '',
      occurrence: 0,
    }),
  )
  sessionStorage.setItem(
    'annotant:draft-pictures',
    JSON.stringify({ images: [IMAGE], sketch: IMAGE }),
  )
  // happy-dom's storage keeps its own methods: the prototype's are not called.
  const setItem = sessionStorage.setItem.bind(sessionStorage)
  const full = vi
    .spyOn(sessionStorage, 'setItem')
    .mockImplementation((key: string, value: string) => {
      if (value.includes('"images"')) throw new DOMException('full', 'QuotaExceededError')
      setItem(key, value)
    })
  onTestFinished(() => full.mockRestore())

  openPanel()
  reload()

  expect((await messageBox()).value).toBe('Look')
  await waitFor(() =>
    expect(JSON.parse(sessionStorage.getItem('annotant:draft-pictures') ?? '{}')).toEqual(
      {
        sketch: IMAGE,
      },
    ),
  )
})

test('what the tab holds in a shape the widget cannot draw is left aside', async () => {
  sessionStorage.setItem(
    'annotant:draft',
    JSON.stringify({ route: '/', url: 'http://localhost/', body: 'hi', elements: {} }),
  )
  sessionStorage.setItem(
    'annotant:tool',
    JSON.stringify({ tool: 'sketch', lines: [{ x: 1, y: 2 }] }),
  )

  reload()

  await screen.findByRole('button', { name: 'Draw' })
  expect(screen.queryByTestId('an-sketch')).toBeNull()
  expect(screen.queryByRole('textbox', { name: 'What should change?' })).toBeNull()
})

test('an agent answering never cancels the area being drawn', async () => {
  const events = fakeEvents()
  const comments = [comment({ state: 'working' })]
  const { fetch } = renderCards(comments)
  const listed = () => fetch.mock.calls.filter(([, init]) => !init?.method).length
  fireEvent.click(await screen.findByRole('button', { name: 'Draw area' }))
  fireEvent.mouseDown(screen.getByTestId('an-draw'), {
    button: 0,
    clientX: 10,
    clientY: 300,
  })

  const before = listed()
  comments[0] = comment({
    state: 'answered',
    messages: [{ author: 'claude', body: 'Done', at: '2026-01-01T10:01:00.000Z' }],
  })
  events.send('changed')
  await waitFor(() => expect(listed()).toBeGreaterThan(before))

  fireEvent.mouseMove(document, { clientX: 510, clientY: 360 })
  fireEvent.mouseUp(document, { clientX: 510, clientY: 360 })
  expect((await screen.findByTestId('an-area-chip')).textContent).toBe(
    '500 × 60across <div> <div> <p>',
  )
})
