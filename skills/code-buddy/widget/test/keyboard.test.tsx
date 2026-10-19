import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { comment, fakeServer, openPanel, openThread } from './server'
import { renderWidget } from './widget'

const TITLE = {
  selector: 'h1',
  tag: 'h1',
  text: 'Playground',
  html: '<h1>Playground</h1>',
}

/** A browser fires `click` on a focused button for Enter and for Space. */
function press(button: HTMLElement) {
  expect(button.tagName).toBe('BUTTON')
  button.focus()
  expect(document.activeElement).toBe(button)
  fireEvent.click(button)
}

test("a comment card in the page's list is a button that opens its thread", async () => {
  fakeServer([comment()])
  openPanel()
  renderWidget()

  press(await screen.findByRole('button', { name: 'Make the title bigger' }))

  expect((await screen.findByTestId('cb-working')).textContent).toBe('Sent…')
  // The card is gone: the focus moves into the thread, not back to the page.
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Back to the list' }),
  )
})

test('a comment card in All comments is a button that opens its thread', async () => {
  fakeServer([comment()])
  openPanel('all')
  renderWidget()

  press(await screen.findByRole('button', { name: 'Make the title bigger' }))

  expect((await screen.findByTestId('cb-working')).textContent).toBe('Sent…')
  // The card is gone: the focus moves into the thread, not back to the page.
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Back to the list' }),
  )
})

test('the element chip is a button that centers the page on its element', async () => {
  document.body.replaceChildren()
  // happy-dom lays nothing out: the element is a box on screen, to outline.
  const box = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockReturnValue(DOMRect.fromRect({ x: 40, y: 100, width: 200, height: 30 }))
  onTestFinished(() => box.mockRestore())
  const scroll = vi
    .spyOn(Element.prototype, 'scrollIntoView')
    .mockImplementation(() => {})
  onTestFinished(() => scroll.mockRestore())
  fakeServer([comment({ element: TITLE })])
  openThread('c1')
  renderWidget()

  const chip = await screen.findByRole('button', { name: /<h1>\s*Playground/ })
  // Focused as hovered, its element shows on the page.
  fireEvent.focus(chip)
  await screen.findByTestId('cb-target')
  fireEvent.blur(chip)
  await waitFor(() => expect(screen.queryByTestId('cb-target')).toBeNull())

  press(chip)

  expect(scroll.mock.contexts).toContain(document.querySelector('main h1'))
})

test('the element chip centers its element at once when motion is reduced', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
  }))
  document.body.replaceChildren()
  const scroll = vi
    .spyOn(Element.prototype, 'scrollIntoView')
    .mockImplementation(() => {})
  onTestFinished(() => scroll.mockRestore())
  fakeServer([comment({ element: TITLE })])
  openThread('c1')
  renderWidget()

  press(await screen.findByRole('button', { name: /<h1>\s*Playground/ }))

  expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' })
})

test('a comment opened from the list scrolls to its text at once when motion is reduced', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
  }))
  document.body.replaceChildren()
  const scroll = vi
    .spyOn(Element.prototype, 'scrollIntoView')
    .mockImplementation(() => {})
  onTestFinished(() => scroll.mockRestore())
  fakeServer([comment({ quote: 'Playground' })])
  openPanel('page')
  renderWidget()

  fireEvent.click(await screen.findByTestId('cb-summary'))

  expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' })
})

const radio = (name: string) => screen.getByRole('radio', { name })

test('the status filter is one named Tab stop that arrow keys move through', async () => {
  fakeServer([comment()])
  openPanel('all')
  renderWidget()

  await screen.findByRole('radiogroup', { name: 'Filter by status' })
  // Only the checked radio, Open by default, is in the Tab order.
  expect(radio('All').tabIndex).toBe(-1)
  expect(radio('Open').tabIndex).toBe(0)
  expect(radio('Resolved').tabIndex).toBe(-1)

  radio('Open').focus()
  fireEvent.keyDown(radio('Open'), { key: 'ArrowRight' })
  expect(radio('Resolved').getAttribute('aria-checked')).toBe('true')
  expect(document.activeElement).toBe(radio('Resolved'))
  expect(radio('Resolved').tabIndex).toBe(0)
  expect(radio('Open').tabIndex).toBe(-1)

  // A shortcut of the browser's is left alone.
  fireEvent.keyDown(radio('Resolved'), { key: 'ArrowLeft', altKey: true })
  expect(radio('Resolved').getAttribute('aria-checked')).toBe('true')

  // The last radio wraps around to the first, and back.
  fireEvent.keyDown(radio('Resolved'), { key: 'ArrowDown' })
  expect(document.activeElement).toBe(radio('All'))
  fireEvent.keyDown(radio('All'), { key: 'ArrowLeft' })
  expect(document.activeElement).toBe(radio('Resolved'))
  fireEvent.keyDown(radio('Resolved'), { key: 'ArrowUp' })
  expect(document.activeElement).toBe(radio('Open'))
  fireEvent.keyDown(radio('Open'), { key: 'Home' })
  expect(document.activeElement).toBe(radio('All'))
  fireEvent.keyDown(radio('All'), { key: 'End' })
  expect(document.activeElement).toBe(radio('Resolved'))
  expect(radio('Resolved').getAttribute('aria-checked')).toBe('true')
})
