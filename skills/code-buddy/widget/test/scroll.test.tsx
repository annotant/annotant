import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { ReviewComment } from '../src/domain'
import { comment, fakeEvents, fakeServer, openThread } from './server'
import { renderWidget } from './widget'

const AT = '2026-01-01T10:00:00.000Z'
const VIEW = 300

const replies = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    author: 'claude' as const,
    body: `Answer ${index + 1}`,
    at: AT,
    run: 'r1',
  }))

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

function answered(count: number): ReviewComment {
  return comment({ state: 'answered', messages: replies(count) })
}

/**
 * Lays out the panel's body as a browser would, which happy-dom does not: each
 * message 200 px tall in a view of 300, scrolled as far as it goes.
 */
async function layOut() {
  await screen.findByText('Answer 1')
  const body = document.querySelector<HTMLElement>('.cb-body')
  if (!body) throw new Error('No panel body')
  const height = () => body.querySelectorAll('.cb-msg').length * 200
  let top = 0
  Object.defineProperties(body, {
    clientHeight: { get: () => VIEW },
    scrollHeight: { get: height },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, height() - VIEW))
      },
    },
    scrollTo: {
      value: (options: ScrollToOptions) => {
        body.scrollTop = options.top ?? top
      },
    },
  })
  const scroll = (to: number) => {
    body.scrollTop = to
    fireEvent.scroll(body)
  }
  // The widget measures the new layout before the test scrolls it.
  fireEvent.scroll(body)
  await frame()
  return { body, height, scroll }
}

test('a thread read to its end follows the message that arrives', async () => {
  const events = fakeEvents()
  const served = [answered(3)]
  fakeServer(served)
  openThread('c1')
  renderWidget()
  const { body, height, scroll } = await layOut()
  scroll(height())

  served[0] = answered(4)
  events.send('changed')
  await screen.findByText('Answer 4')
  await waitFor(() => expect(body.scrollTop).toBe(height() - VIEW))
})

test('a thread scrolled up keeps its place when a message arrives', async () => {
  const events = fakeEvents()
  const served = [answered(3)]
  fakeServer(served)
  openThread('c1')
  renderWidget()
  const { body, height, scroll } = await layOut()
  scroll(height())
  scroll(100)

  served[0] = answered(4)
  events.send('changed')
  await screen.findByText('Answer 4')
  await frame()
  expect(body.scrollTop).toBe(100)
  expect(
    screen.getByRole('button', { name: 'Scroll to the latest message' }),
  ).toBeTruthy()
})

test('a thread read to its end lets the reader scroll up a little', async () => {
  fakeEvents()
  fakeServer([answered(3)])
  openThread('c1')
  renderWidget()
  const { body, height, scroll } = await layOut()
  scroll(height())
  scroll(height() - VIEW - 20)

  await frame()
  await frame()
  expect(body.scrollTop).toBe(height() - VIEW - 20)
})

test("the reader's own message brings a thread scrolled up to its end", async () => {
  const events = fakeEvents()
  const served = [answered(3)]
  fakeServer(served)
  openThread('c1')
  renderWidget()
  const { body, height, scroll } = await layOut()
  scroll(height())
  scroll(0)

  const box = screen.getByPlaceholderText('Follow up, clarify, ask for a change…')
  fireEvent.change(box, { target: { value: 'Bolder too' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  served[0] = comment({
    messages: [...replies(3), { author: 'reader', body: 'Bolder too', at: AT }],
  })
  events.send('changed')
  await screen.findByText('Bolder too')
  await waitFor(() => expect(body.scrollTop).toBe(height() - VIEW))
})

test('a comment sent again brings a thread scrolled up to its end', async () => {
  const events = fakeEvents()
  const cancellation = { at: AT, changed: [], steps: 1 }
  const served = [comment({ state: 'stopped', cancellation, messages: replies(3) })]
  fakeServer(served)
  openThread('c1')
  renderWidget()
  const { body, height, scroll } = await layOut()
  scroll(height())
  scroll(0)

  fireEvent.click(screen.getByRole('button', { name: 'Send again' }))
  served[0] = comment({
    messages: [...replies(3), { author: 'reader', body: 'Make it bigger again', at: AT }],
  })
  events.send('changed')
  await screen.findByText('Make it bigger again')
  await waitFor(() => expect(body.scrollTop).toBe(height() - VIEW))
})
