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
})

test('a comment card in All comments is a button that opens its thread', async () => {
  fakeServer([comment()])
  openPanel('all')
  renderWidget()

  press(await screen.findByRole('button', { name: 'Make the title bigger' }))

  expect((await screen.findByTestId('cb-working')).textContent).toBe('Sent…')
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
