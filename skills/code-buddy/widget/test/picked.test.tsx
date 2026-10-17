import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest'
import { comment, fakeServer, openThread } from './server'
import { renderWidget } from './widget'

const TITLE = {
  selector: 'h1',
  tag: 'h1',
  text: 'Playground',
  html: '<h1>Playground</h1>',
  route: '/',
}

// The pages of earlier tests stay behind their widgets: the title is this one's.
beforeEach(() => document.body.replaceChildren())

const resolved = () =>
  comment({
    state: 'resolved',
    messages: [{ author: 'claude', body: 'Done.', at: '2026-01-01T10:01:00.000Z' }],
  })

/** The pointer points at the page's title, as the picker reads it. */
function pointAtTitle() {
  const title = document.querySelector('main h1')
  if (!title) throw new Error('no title')
  const pointed = vi.spyOn(document, 'elementFromPoint').mockReturnValue(title)
  onTestFinished(() => pointed.mockRestore())
  return title
}

test('an element picked in the page goes with the reply, the thread still open', async () => {
  const server = fakeServer([resolved()])
  openThread('c1')
  renderWidget()
  const box = await screen.findByPlaceholderText('Follow up, clarify, ask for a change…')
  const title = pointAtTitle()

  fireEvent.click(screen.getByRole('button', { name: 'Pick an element in the page' }))
  expect(screen.getByText(/Click an element to add it to your message/)).toBeTruthy()
  fireEvent.click(title, { clientX: 50, clientY: 20 })

  // Picked once: the picker stops, and the element waits above the text.
  expect(screen.queryByText(/Click an element to add it/)).toBeNull()
  expect(screen.getByTestId('code-buddy-panel')).toBeTruthy()
  expect(screen.getByTestId('cb-picked').textContent).toContain('Playground')

  fireEvent.change(box, { target: { value: 'Same size as this' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() =>
    expect(server.patches).toEqual([
      { id: 'c1', patch: { followUp: 'Same size as this', elements: [TITLE] } },
    ]),
  )
})

test('an element alone is a reply, and the reader may remove it before sending', async () => {
  const server = fakeServer([resolved()])
  openThread('c1')
  renderWidget()
  await screen.findByPlaceholderText('Follow up, clarify, ask for a change…')
  const title = pointAtTitle()
  const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Send' })
  expect(send.disabled).toBe(true)

  for (const _ of [1, 2]) {
    fireEvent.click(screen.getByRole('button', { name: 'Pick an element in the page' }))
    fireEvent.click(title, { clientX: 50, clientY: 20 })
  }
  // The same element twice is one.
  expect(screen.getAllByRole('button', { name: /Remove the element/ })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Remove the element <h1>' }))
  expect(screen.queryByTestId('cb-picked')).toBeNull()
  expect(send.disabled).toBe(true)

  fireEvent.click(screen.getByRole('button', { name: 'Pick an element in the page' }))
  fireEvent.click(title, { clientX: 50, clientY: 20 })
  expect(send.disabled).toBe(false)
  fireEvent.click(send)
  await waitFor(() =>
    expect(server.patches).toEqual([{ id: 'c1', patch: { elements: [TITLE] } }]),
  )
})

test('Escape stops picking, and leaves the page as it was', async () => {
  fakeServer([resolved()])
  openThread('c1')
  renderWidget()
  await screen.findByPlaceholderText('Follow up, clarify, ask for a change…')

  fireEvent.click(screen.getByRole('button', { name: 'Pick an element in the page' }))
  fireEvent.keyDown(document, { key: 'Escape' })

  await waitFor(() => expect(screen.queryByText(/Click an element to add it/)).toBeNull())
  expect(screen.queryByTestId('cb-picked')).toBeNull()
})

test("the reader's message shows its elements: a click scrolls to one", async () => {
  const scroll = vi
    .spyOn(Element.prototype, 'scrollIntoView')
    .mockImplementation(() => {})
  onTestFinished(() => scroll.mockRestore())
  fakeServer([
    comment({
      state: 'open',
      messages: [
        { author: 'claude', body: 'Done.', at: '2026-01-01T10:01:00.000Z' },
        {
          author: 'reader',
          body: 'This one too',
          at: '2026-01-01T10:02:00.000Z',
          elements: [TITLE],
        },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  const shown = await screen.findByTestId('cb-msg-elements')
  fireEvent.click(shown.querySelector('button') ?? shown)

  expect(scroll.mock.contexts).toContain(document.querySelector('main h1'))
})
