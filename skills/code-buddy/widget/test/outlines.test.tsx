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
}

/** Resolved once, then followed up: open again, about something else. */
const reopened = [
  { at: '2026-01-01T10:00:00.000Z', state: 'open', by: 'reader' },
  { at: '2026-01-01T10:00:01.000Z', state: 'working', by: 'agent', run: 'r1' },
  { at: '2026-01-01T10:00:02.000Z', state: 'resolved', by: 'agent', run: 'r1' },
  { at: '2026-01-01T10:00:03.000Z', state: 'open', by: 'reader' },
] as const

const marks = () => Array.from(document.querySelectorAll('.cb-mark'))
/** The rainbow behind each line of a text: in a layer of the page, out of `body`. */
const lines = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.code-buddy-layer > *'))

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

  expect((await screen.findByTestId('cb-working')).textContent).toBe('Sent…')
})

test('an element keeps its in-progress look once its thread is opened', async () => {
  layout()
  document.body.replaceChildren()
  fakeServer([comment({ element: TITLE })])
  openPanel()
  renderWidget()
  await waitFor(() => expect(marks()).toHaveLength(1))

  fireEvent.click(await screen.findByText('Make the title bigger'))

  await screen.findByTestId('cb-working')
  expect(marks().map((mark) => mark.className)).toEqual(['cb-mark'])
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
  expect([...highlights.keys()]).toEqual(['code-buddy-draft'])
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
  fireEvent.click(title, { clientX: 50, clientY: 110 })
  return screen.findByRole('textbox')
}

test('the picked element stays outlined while the comment is written', async () => {
  await pickTitle()

  await screen.findByTestId('cb-target')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByTestId('cb-target')).toBeNull())
})

test("the picked element's frames sit on it, with its rounded corners", async () => {
  const box = await pickTitle()
  // On the title's box, not around it.
  const outline = await screen.findByTestId('cb-target')
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
  await screen.findByTestId('cb-target')

  fireEvent.change(box, { target: { value: 'Make the title bigger' } })
  fireEvent.keyDown(box, { key: 'Enter' })

  await waitFor(() => expect(marks()).toHaveLength(1))
  expect(screen.queryByTestId('cb-target')).toBeNull()
})
