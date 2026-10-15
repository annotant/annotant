import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import type { ReviewComment } from '../src/domain'
import { comment, fakeServer } from './server'
import { renderWidget, stubHighlights } from './widget'

/**
 * The widget over a page with two blocks, the reader selecting from the first
 * to the second, as a browser reads it (happy-dom puts no line break between).
 */
async function selectAcrossBlocks(comments: ReviewComment[] = []) {
  // renderWidget's page outlives the test: only its unmount removes it.
  document.body.replaceChildren()
  fakeServer(comments)
  renderWidget()
  const page = document.querySelector('main')
  if (!page) throw new Error('no page')
  page.insertAdjacentHTML('beforeend', '<div>Part 1</div><div>part 2</div>')
  const [from, to] = page.querySelectorAll('div')
  if (!from?.firstChild || !to?.firstChild) throw new Error('no text')

  const range = document.createRange()
  range.setStart(from.firstChild, 'Pa'.length)
  range.setEnd(to.firstChild, 'part 2'.length)
  const selection = getSelection()
  if (!selection) throw new Error('no selection')
  selection.removeAllRanges()
  selection.addRange(range)
  selection.toString = () => 'rt 1\npart 2'
  document.dispatchEvent(new Event('selectionchange'))
  return {
    from: from.firstChild,
    to: to.firstChild,
    selection,
    button: await screen.findByTestId('cb-selection'),
  }
}

test('the selected text stays highlighted while the comment is written', async () => {
  const highlights = stubHighlights()
  const { from, to, selection, button } = await selectAcrossBlocks()
  fireEvent.click(button)
  selection.removeAllRanges()

  await waitFor(() => {
    const [drafted] = highlights.get('code-buddy-draft') ?? []
    expect(drafted?.startContainer).toBe(from)
    expect(drafted?.endContainer).toBe(to)
  })
})

test('the Comment button sits above the start of the selection', async () => {
  // Line 1 starts mid-line, at x = 300; the second line, further left, widens the whole box.
  const measure = vi.spyOn(Range.prototype, 'getBoundingClientRect')
  onTestFinished(() => measure.mockRestore())
  measure.mockImplementation(function (this: Range) {
    return this.collapsed
      ? DOMRect.fromRect({ x: 300, y: 100, width: 0, height: 20 })
      : DOMRect.fromRect({ x: 40, y: 100, width: 600, height: 50 })
  })
  const { button } = await selectAcrossBlocks()
  expect(button.style.left).toBe('300px')
  expect(button.style.top).toBe('60px')
})

test('a bubble above the start of a commented text opens its thread', async () => {
  // happy-dom lays nothing out: the quote starts at x = 120, on a line at y = 100.
  const measure = vi
    .spyOn(Range.prototype, 'getBoundingClientRect')
    .mockImplementation(() => DOMRect.fromRect({ x: 120, y: 100, width: 0, height: 20 }))
  onTestFinished(() => measure.mockRestore())
  document.body.replaceChildren()
  fakeServer([comment({ quote: 'Playground' })])
  renderWidget()

  const bubble = await screen.findByRole('button', {
    name: 'Open the comment on “Playground”',
  })
  expect([bubble.style.left, bubble.style.top]).toEqual(['120px', '100px'])
  fireEvent.click(bubble)
  expect((await screen.findByTestId('cb-working')).textContent).toBe('Sent…')
})

/** happy-dom lays nothing out: every range starts where `at` says. */
function layout(at: (range: Range) => { x: number; y: number }) {
  const measure = vi
    .spyOn(Range.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Range) {
      return DOMRect.fromRect({ ...at(this), width: 0, height: 20 })
    })
  onTestFinished(() => measure.mockRestore())
}

test('the bubbles follow the page when an attribute moves its text', async () => {
  let x = 120
  layout(() => ({ x, y: 100 }))
  document.body.replaceChildren()
  fakeServer([comment({ quote: 'Playground' })])
  renderWidget()

  const bubble = await screen.findByRole('button', { name: /Open the comment/ })
  expect(bubble.style.left).toBe('120px')
  // A docked panel squeezes the page through its root element: no node changes, no resize, no scroll.
  x = 80
  document.documentElement.style.marginRight = '380px'
  onTestFinished(() => document.documentElement.removeAttribute('style'))
  await waitFor(() => expect(bubble.style.left).toBe('80px'))
})

test('bubbles on the same spot sit side by side', async () => {
  layout(() => ({ x: 120, y: 100 }))
  document.body.replaceChildren()
  fakeServer([
    comment({ id: 'c1', quote: 'Playground' }),
    comment({ id: 'c2', quote: 'Play' }),
  ])
  renderWidget()

  await waitFor(() =>
    expect(
      screen
        .getAllByRole('button', { name: /Open the comment/ })
        .map((bubble) => bubble.style.left),
    ).toEqual(['120px', '146px']),
  )
})

test('a bubble does not throw away the comment being written', async () => {
  layout(() => ({ x: 120, y: 100 }))
  document.body.replaceChildren()
  fakeServer([comment({ quote: 'Playground' })])
  renderWidget()
  const [newComment] = await screen.findAllByRole('button', { name: 'Comment' })
  if (!newComment) throw new Error('no Comment button')
  fireEvent.click(newComment)
  const box = await screen.findByRole('textbox')
  fireEvent.change(box, { target: { value: 'Half a thought' } })

  fireEvent.click(await screen.findByRole('button', { name: /Open the comment/ }))

  expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('Half a thought')
})

test('the Comment button sits on the quote when the drag starts on the line above', async () => {
  // Past the end of "Part 1", the caret is at the end of its line, far right.
  layout((range) =>
    range.startOffset === 'Part 1'.length ? { x: 900, y: 100 } : { x: 40, y: 130 },
  )
  document.body.replaceChildren()
  fakeServer([])
  renderWidget()
  const page = document.querySelector('main')
  page?.insertAdjacentHTML('beforeend', '<div>Part 1</div><div>part 2</div>')
  const [from, to] = page?.querySelectorAll('div') ?? []
  if (!from?.firstChild || !to?.firstChild) throw new Error('no text')
  const range = document.createRange()
  range.setStart(from.firstChild, 'Part 1'.length)
  range.setEnd(to.firstChild, 'part 2'.length)
  getSelection()?.removeAllRanges()
  getSelection()?.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))

  const button = await screen.findByTestId('cb-selection')
  expect([button.style.left, button.style.top]).toEqual(['40px', '90px'])
})

test('a comment is filed on the page where it was started, not where it is saved', async () => {
  const comments: ReviewComment[] = []
  const startedOn = window.location.href
  const { selection, button } = await selectAcrossBlocks(comments)
  fireEvent.click(button)
  selection.removeAllRanges()
  const box = await screen.findByRole('textbox')
  // The app navigates on the client: the widget stays mounted.
  history.pushState(null, '', '/docs')
  onTestFinished(() => history.pushState(null, '', startedOn))
  window.dispatchEvent(new PopStateEvent('popstate'))

  fireEvent.change(box, { target: { value: 'Shorter' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await screen.findByText('Comment saved')
  expect(comments.map(({ route, url }) => ({ route, url }))).toEqual([
    { route: '/', url: startedOn },
  ])
})

test('the quote being written is not marked on another page', async () => {
  const highlights = stubHighlights()
  const startedOn = window.location.href
  const { selection, button } = await selectAcrossBlocks()
  fireEvent.click(button)
  selection.removeAllRanges()
  await waitFor(() => expect(highlights.get('code-buddy-draft')?.size).toBe(1))

  history.pushState(null, '', '/docs')
  onTestFinished(() => history.pushState(null, '', startedOn))
  window.dispatchEvent(new PopStateEvent('popstate'))

  await waitFor(() => expect(highlights.get('code-buddy-draft')?.size ?? 0).toBe(0))
})
