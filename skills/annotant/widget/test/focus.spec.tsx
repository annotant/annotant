import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { comment, fakeServer, openPanel, openThread } from './server'
import { renderWidget, startPageComment } from './widget'

const TITLE = {
  selector: 'h1',
  tag: 'h1',
  text: 'Playground',
  html: '<h1>Playground</h1>',
}

/** happy-dom lays nothing out: every element is a box on screen, with its bubble. */
function layout() {
  const box = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockReturnValue(DOMRect.fromRect({ x: 40, y: 100, width: 200, height: 30 }))
  onTestFinished(() => box.mockRestore())
}

const panel = () => screen.getByRole('region', { name: 'Annotant' })

test('the panel is named Annotant', () => {
  fakeServer([])
  openPanel()
  renderWidget()

  expect(panel()).toBe(screen.getByTestId('annotant-panel'))
})

test('a bubble moves the focus into the panel, and closing gives it back to the bubble', async () => {
  layout()
  document.body.replaceChildren()
  fakeServer([comment({ element: TITLE })])
  renderWidget()

  const bubble = await screen.findByRole('button', { name: 'Open the comment on <h1>' })
  bubble.focus()
  fireEvent.click(bubble)

  await screen.findByTestId('an-working')
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Comment' }))

  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(document.activeElement).toBe(bubble)
})

test('closing the panel opened from the dock gives the focus to the dock', async () => {
  fakeServer([])
  renderWidget()

  const dock = screen.getByRole('button', { name: 'Comments' })
  dock.focus()
  fireEvent.click(dock)
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Comments' }),
    ),
  )

  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Comments' }))
})

test('Escape closes the panel and gives the focus to the dock', async () => {
  fakeServer([comment()])
  openPanel()
  renderWidget()

  const card = await screen.findByRole('button', { name: 'Make the title bigger' })
  card.focus()
  fireEvent.keyDown(card, { key: 'Escape' })

  expect(panel().hasAttribute('data-closing')).toBe(true)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Comments' }))
})

test("Escape in a new comment's message box is the box's, not the panel's", async () => {
  fakeServer([])
  renderWidget()
  await startPageComment()
  const box = screen.getByRole('textbox', { name: 'What should change?' })

  fireEvent.change(box, { target: { value: 'Bigger' } })
  fireEvent.keyDown(box, { key: 'Escape' })
  expect(panel().hasAttribute('data-closing')).toBe(false)
  expect(screen.getByRole('heading', { name: 'New comment' })).toBeTruthy()

  // Empty, it leaves the draft for the list: the panel stays open, the focus in it.
  fireEvent.change(box, { target: { value: '' } })
  fireEvent.keyDown(box, { key: 'Escape' })
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'New comment' })).toBeNull(),
  )
  expect(panel().hasAttribute('data-closing')).toBe(false)
  expect(document.activeElement).toBe(
    screen.getByRole('heading', { name: 'All comments' }),
  )

  // So the next Escape closes the panel.
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  expect(panel().hasAttribute('data-closing')).toBe(true)
})

test('Escape while picking an element for the message cancels the picker only', async () => {
  fakeServer([])
  renderWidget()
  await startPageComment()
  fireEvent.click(screen.getByRole('button', { name: 'Pick an element in the page' }))
  expect(screen.getByRole('button', { name: 'Stop picking' })).toBeTruthy()

  fireEvent.keyDown(screen.getByRole('button', { name: 'Stop picking' }), {
    key: 'Escape',
  })

  expect(panel().hasAttribute('data-closing')).toBe(false)
  expect(screen.getByRole('button', { name: 'Pick an element in the page' })).toBeTruthy()
})

test('Escape while composing a word with an input method leaves the panel open', async () => {
  fakeServer([comment()])
  openPanel()
  renderWidget()

  const card = await screen.findByRole('button', { name: 'Make the title bigger' })
  fireEvent.keyDown(card, { key: 'Escape', isComposing: true })

  expect(panel().hasAttribute('data-closing')).toBe(false)
})

test("Escape in a thread's reply box is the box's, not the panel's", async () => {
  fakeServer([
    comment({
      state: 'answered',
      messages: [
        { author: 'claude', body: 'Bigger.', at: '2026-01-01T10:01:00.000Z', run: 'r1' },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()
  const box = await screen.findByPlaceholderText('Follow up, clarify, ask for a change…')
  box.focus()

  fireEvent.change(box, { target: { value: 'Bolder too' } })
  fireEvent.keyDown(box, { key: 'Escape' })
  expect(panel().hasAttribute('data-closing')).toBe(false)
  expect(screen.getByRole('heading', { name: 'Comment' })).toBeTruthy()

  // Empty, it leaves the thread for the list, as a new comment's does.
  fireEvent.change(box, { target: { value: '' } })
  fireEvent.keyDown(box, { key: 'Escape' })
  expect(panel().hasAttribute('data-closing')).toBe(false)
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Comments' }),
    ),
  )
})
