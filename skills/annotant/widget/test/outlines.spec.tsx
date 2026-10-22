import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { RAINBOW_PERIOD } from '../src/styles'
import { comment, fakeServer, openPanel } from './server'
import { renderWidget, stubHighlights } from './widget'

const TITLE = {
  selector: 'h1',
  tag: 'h1',
  text: 'Playground',
  html: '<h1>Playground</h1>',
}

/** happy-dom lays nothing out: every element is a box on screen. */
function layout() {
  const box = DOMRect.fromRect({ x: 40, y: 100, width: 200, height: 30 })
  const element = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockReturnValue(box)
  const range = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(box)
  const lines = vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue(
    // A list of one line: all the widget reads of a DOMRectList.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    [box] as unknown as DOMRectList,
  )
  onTestFinished(() => {
    element.mockRestore()
    range.mockRestore()
    lines.mockRestore()
  })
  /** Lays every box out at `next` instead, as a reflow would, with no change to the nodes. */
  return (next: DOMRect) => {
    element.mockReturnValue(next)
    range.mockReturnValue(next)
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    lines.mockReturnValue([next] as unknown as DOMRectList)
  }
}

/** Resolved once, then followed up: open again, about something else. */
const reopened = [
  { at: '2026-01-01T10:00:00.000Z', state: 'open', by: 'reader' },
  { at: '2026-01-01T10:00:01.000Z', state: 'working', by: 'agent', run: 'r1' },
  { at: '2026-01-01T10:00:02.000Z', state: 'resolved', by: 'agent', run: 'r1' },
  { at: '2026-01-01T10:00:03.000Z', state: 'open', by: 'reader' },
] as const

const marks = () => Array.from(document.querySelectorAll('.an-mark'))
/** The rainbow behind each line of a text: in a layer of the page, out of `body`. */
const lines = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.annotant-layer > *'))

test('an element is in progress until its thread is first resolved', async () => {
  layout()
  document.body.replaceChildren()
  fakeServer([
    comment({ id: 'c1', element: TITLE }),
    comment({ id: 'c2', element: TITLE, state: 'resolved' }),
    comment({ id: 'c3', element: TITLE, events: [...reopened] }),
  ])
  renderWidget()

  await waitFor(() => expect(marks()).toHaveLength(1))
})

test("a bubble on an element opens its comment's thread", async () => {
  layout()
  document.body.replaceChildren()
  fakeServer([comment({ element: TITLE })])
  renderWidget()

  fireEvent.click(await screen.findByRole('button', { name: 'Open the comment on <h1>' }))

  expect((await screen.findByTestId('an-working')).textContent).toBe('Sent…')
})

test('an element keeps its in-progress look once its thread is opened', async () => {
  layout()
  document.body.replaceChildren()
  fakeServer([comment({ element: TITLE })])
  openPanel()
  renderWidget()
  await waitFor(() => expect(marks()).toHaveLength(1))

  fireEvent.click(await screen.findByText('Make the title bigger'))

  await screen.findByTestId('an-working')
  expect(marks().map((mark) => mark.className)).toEqual(['an-mark'])
})

test('a text is in progress until its thread is first resolved', async () => {
  const highlights = stubHighlights()
  layout()
  document.body.replaceChildren()
  fakeServer([
    comment({ id: 'c1', quote: 'Playground' }),
    comment({ id: 'c2', quote: 'Play', state: 'resolved' }),
    comment({ id: 'c3', quote: 'Play', events: [...reopened] }),
  ])
  renderWidget()

  await waitFor(() => expect(lines()).toHaveLength(1))
  expect([lines()[0]?.style.left, lines()[0]?.style.width]).toEqual(['40px', '200px'])
  // Its rainbow starts at the viewport's corner, as every line's does: they carry on.
  const rainbow = lines()[0]?.firstElementChild
  expect(
    rainbow instanceof HTMLElement && [rainbow.style.left, rainbow.style.top],
  ).toEqual([`${-40 - RAINBOW_PERIOD}px`, '-100px'])
  // Drawn by the widget: the page's highlights only hold the draft.
  expect([...highlights.keys()]).toEqual(['annotant-draft'])
})

/** The reader points at the page's title and starts a comment on it. */
async function pickTitle() {
  layout()
  document.body.replaceChildren()
  fakeServer([])
  renderWidget()
  const title = document.querySelector('h1')
  if (!title) throw new Error('no title')
  title.style.borderRadius = '12px'
  const pointed = vi.spyOn(document, 'elementFromPoint').mockReturnValue(title)
  onTestFinished(() => pointed.mockRestore())

  fireEvent.click(await screen.findByRole('button', { name: 'Point at element' }))
  fireEvent.mouseMove(document, { clientX: 50, clientY: 110 })
  fireEvent.click(title, { clientX: 50, clientY: 110, detail: 1 })
  return screen.findByRole('textbox')
}

test('the picked element stays outlined while the comment is written', async () => {
  await pickTitle()

  await screen.findByTestId('an-target')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByTestId('an-target')).toBeNull())
})

test("the picked element's frames sit on it, with its rounded corners", async () => {
  const box = await pickTitle()
  // On the title's box, not around it.
  const outline = await screen.findByTestId('an-target')
  expect([outline.style.top, outline.style.width, outline.style.borderRadius]).toEqual([
    '100px',
    '200px',
    '12px',
  ])

  fireEvent.change(box, { target: { value: 'Make the title bigger' } })
  fireEvent.keyDown(box, { key: 'Enter' })

  await waitFor(() => expect(marks()).toHaveLength(1))
  const [mark] = marks()
  expect(mark instanceof HTMLElement && mark.style.borderRadius).toBe('12px')
})

test('the picked element turns in progress once its comment is saved', async () => {
  const box = await pickTitle()
  await screen.findByTestId('an-target')

  fireEvent.change(box, { target: { value: 'Make the title bigger' } })
  fireEvent.keyDown(box, { key: 'Enter' })

  await waitFor(() => expect(marks()).toHaveLength(1))
  expect(screen.queryByTestId('an-target')).toBeNull()
  expect(screen.getByRole('button', { name: 'Open the comment on <h1>' })).toBeTruthy()
})

const PICKED = { ...TITLE, route: '/' }

/** A comment whose own message holds the title, as Point at element writes it. */
function holding(fields: Parameters<typeof comment>[0]) {
  const made = comment(fields)
  const [first] = made.messages
  if (first) made.messages[0] = { ...first, elements: [PICKED] }
  return made
}

test('an element picked in a message is marked until the thread is resolved', async () => {
  layout()
  document.body.replaceChildren()
  fakeServer([
    holding({ id: 'c1', events: reopened.slice(0, 2) }),
    holding({ id: 'c2', state: 'resolved' }),
  ])
  renderWidget()

  await waitFor(() => expect(marks()).toHaveLength(1))
  expect(pins()).toHaveLength(1)
})

test('an element picked in a reply after the thread was resolved takes the mark', async () => {
  stubHighlights()
  layout()
  document.body.replaceChildren()
  const reply = {
    author: 'reader' as const,
    body: 'This one now',
    at: '2026-01-01T10:00:03.000Z',
  }
  fakeServer([
    // On a text: the element picked since takes its place.
    comment({
      id: 'c1',
      quote: 'Playground',
      messages: [
        { author: 'claude', body: 'Done.', at: '2026-01-01T10:00:02.000Z' },
        { ...reply, elements: [PICKED] },
      ],
      events: [...reopened],
    }),
    // Reopened with words alone: nothing to mark.
    comment({
      id: 'c2',
      element: TITLE,
      messages: [
        { author: 'claude', body: 'Done.', at: '2026-01-01T10:00:02.000Z' },
        reply,
      ],
      events: [...reopened],
    }),
  ])
  renderWidget()

  await waitFor(() => expect(marks()).toHaveLength(1))
  expect(lines()).toHaveLength(0)
  expect(pins().map((pin) => pin.getAttribute('aria-label'))).toEqual([
    'Open the comment on <h1>',
  ])
})

/**
 * The page's `main` scrolls on its own, a 200px square from `top` down: the
 * title, from 100px to 130px, is out of it from 130px, half in at 110px.
 */
function scrollBox(top: number, size = 30) {
  const page = document.querySelector('main')
  if (!page) throw new Error('no page')
  page.style.overflowX = 'auto'
  page.style.overflowY = 'auto'
  const box = DOMRect.fromRect({ x: 40, y: 100, width: 200, height: size })
  const own = DOMRect.fromRect({ x: 40, y: top, width: 200, height: 200 })
  const element = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      return this === page ? own : box
    })
  Object.defineProperties(page, {
    clientWidth: { value: 200, configurable: true },
    clientHeight: { value: 200, configurable: true },
  })
  onTestFinished(() => element.mockRestore())
}

const pins = () => screen.queryAllByRole('button', { name: /^Open the comment on/ })

test('an element scrolled out of its box has no frame nor bubble', async () => {
  layout()
  document.body.replaceChildren()
  fakeServer([comment({ element: TITLE })])
  renderWidget()
  await waitFor(() => expect(marks()).toHaveLength(1))

  scrollBox(300)
  fireEvent.scroll(document)

  await waitFor(() => expect(marks()).toHaveLength(0))
  expect(pins()).toHaveLength(0)
})

test('an element half out of its box is framed where it shows, its bubble on that part', async () => {
  layout()
  document.body.replaceChildren()
  fakeServer([comment({ element: TITLE })])
  renderWidget()
  scrollBox(110)
  fireEvent.scroll(document)

  await waitFor(() => expect(pins()[0]?.style.top).toBe('110px'))
  // The frame keeps the title's box, cut to the part of it that shows.
  const [mark] = marks()
  const shown = mark?.parentElement
  expect(shown instanceof HTMLElement && [shown.style.top, shown.style.height]).toEqual([
    '110px',
    '20px',
  ])
  expect(mark instanceof HTMLElement && [mark.style.top, mark.style.height]).toEqual([
    '-10px',
    '30px',
  ])
})

test('a text scrolled out of its box has no rainbow nor bubble', async () => {
  stubHighlights()
  layout()
  document.body.replaceChildren()
  fakeServer([comment({ quote: 'Playground' })])
  renderWidget()
  await waitFor(() => expect(lines()).toHaveLength(1))

  scrollBox(300)
  fireEvent.scroll(document)

  await waitFor(() => expect(lines()).toHaveLength(0))
  expect(pins()).toHaveLength(0)
})

test('a text half out of its box has its rainbow cut where it shows, its bubble on it', async () => {
  stubHighlights()
  layout()
  document.body.replaceChildren()
  fakeServer([comment({ quote: 'Playground' })])
  renderWidget()
  scrollBox(110)
  fireEvent.scroll(document)

  await waitFor(() =>
    expect([lines()[0]?.style.top, lines()[0]?.style.height]).toEqual(['110px', '20px']),
  )
  // Its start is out of the box: its bubble sits on the part that shows.
  expect(pins()[0]?.style.top).toBe('110px')
})

test('an element with no height keeps its bubble', async () => {
  layout()
  document.body.replaceChildren()
  fakeServer([comment({ element: TITLE })])
  renderWidget()
  scrollBox(100, 0)
  fireEvent.scroll(document)

  await waitFor(() => expect(pins()[0]?.style.top).toBe('100px'))
})

test('a fixed element in a scrolling box is not cut by it', async () => {
  layout()
  document.body.replaceChildren()
  fakeServer([comment({ element: TITLE })])
  renderWidget()
  document.querySelector('h1')?.style.setProperty('position', 'fixed')
  scrollBox(300)
  fireEvent.scroll(document)

  await waitFor(() => expect(pins()[0]?.style.top).toBe('100px'))
  expect(marks()).toHaveLength(1)
})

test('a text in an inline box that hides its overflow keeps its rainbow', async () => {
  stubHighlights()
  layout()
  document.body.replaceChildren()
  fakeServer([comment({ quote: 'Playground' })])
  renderWidget()
  const title = document.querySelector('h1')
  if (!title) throw new Error('no title')
  // A truncated label: on an inline box, overflow cuts nothing, and its client box is empty.
  title.innerHTML =
    '<span style="display: inline; overflow-x: hidden; overflow-y: hidden">Playground</span>'

  await waitFor(() => expect(lines()).toHaveLength(1))
  expect(pins()).toHaveLength(1)
})

/** A ResizeObserver whose callbacks the test calls: happy-dom lays nothing out. */
function resizes() {
  const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      targets = new Set<Element>()
      constructor(callback: ResizeObserverCallback) {
        observers.push({ callback, targets: this.targets })
      }
      observe(target: Element) {
        this.targets.add(target)
      }
      unobserve(target: Element) {
        this.targets.delete(target)
      }
      disconnect() {
        this.targets.clear()
      }
    },
  )
  return (target: Element | null) => {
    for (const { callback, targets } of observers) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the widget reads no entry
      if (target && targets.has(target)) callback([], {} as ResizeObserver)
    }
  }
}

test('marks follow their element when the page is squeezed with no change to its nodes', async () => {
  const move = layout()
  const resize = resizes()
  document.body.replaceChildren()
  fakeServer([comment({ element: TITLE })])
  renderWidget()
  await waitFor(() => expect(pins()[0]?.style.left).toBe('40px'))

  // The docked panel squeezes the page through an animation: no node, no attribute changes.
  move(DOMRect.fromRect({ x: 20, y: 100, width: 150, height: 30 }))
  resize(document.querySelector('main'))

  await waitFor(() => expect(pins()[0]?.style.left).toBe('20px'))
})

test('a rainbow follows its text when the element holding it changes size', async () => {
  stubHighlights()
  const move = layout()
  const resize = resizes()
  document.body.replaceChildren()
  fakeServer([comment({ quote: 'Playground' })])
  renderWidget()
  await waitFor(() => expect(lines()[0]?.style.left).toBe('40px'))

  move(DOMRect.fromRect({ x: 60, y: 100, width: 200, height: 30 }))
  resize(document.querySelector('h1'))

  await waitFor(() => expect(lines()[0]?.style.left).toBe('60px'))
})
