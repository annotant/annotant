import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import type { ReviewComment } from '../src/domain'
import { comment, fakeEvents, fakeServer, openPanel, openThread } from './server'
import { renderWidget } from './widget'

const AT = '2026-01-01T10:00:00.000Z'
const VIEW = 300
const LATEST = { name: 'Scroll to the latest message' }

const replies = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    author: 'claude' as const,
    body: `Answer ${index + 1}`,
    at: AT,
    run: 'r1',
  }))

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

function answered(count: number, id = 'c1'): ReviewComment {
  return comment({ id, state: 'answered', messages: replies(count) })
}

/**
 * Lays out the panel's body as a browser would, which happy-dom does not: each
 * message, summary and message box 200 px tall in a view of 300, scrolled as
 * far as it goes. A sent reply swaps the box for the message: the body does not
 * grow. A smooth scroll goes halfway, then the rest a moment later, each step
 * with its scroll event; any other scroll cuts it short, as in a browser.
 */
async function layOut(text = 'Answer 1') {
  await screen.findAllByText(text)
  const body = document.querySelector<HTMLElement>('.an-body')
  if (!body) throw new Error('No panel body')
  const height = () =>
    body.querySelectorAll('.an-msg, textarea, [data-testid="an-summary"]').length * 200
  let top = 0
  const behaviors: (ScrollBehavior | undefined)[] = []
  let gliding: ReturnType<typeof setTimeout> | undefined
  const move = (to: number) => {
    body.scrollTop = to
    fireEvent.scroll(body)
  }
  const scroll = (to: number) => {
    clearTimeout(gliding)
    move(to)
  }
  Object.defineProperties(body, {
    clientHeight: { get: () => VIEW, configurable: true },
    scrollHeight: { get: height, configurable: true },
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, height() - VIEW))
      },
    },
    scrollTo: {
      configurable: true,
      value: ({ top: to = top, behavior }: ScrollToOptions) => {
        behaviors.push(behavior)
        if (behavior !== 'smooth') return scroll(to)
        scroll((top + to) / 2)
        gliding = setTimeout(() => move(to), 200)
      },
    },
  })
  // The widget measures the new layout before the test scrolls it.
  fireEvent.scroll(body)
  await frame()
  return { body, behaviors, height, scroll, nudge: move }
}

/** Whether the button to the latest message shows at any time from now on. */
function watchLatestButton() {
  const seen = { shown: false }
  const observer = new MutationObserver(() => {
    seen.shown ||= document.querySelector('.an-scroll-down') !== null
  })
  observer.observe(document.body, { childList: true, subtree: true })
  onTestFinished(() => observer.disconnect())
  return seen
}

test('a thread read to its end follows the message that arrives, smoothly', async () => {
  const events = fakeEvents()
  const served = [answered(3)]
  fakeServer(served)
  openThread('c1')
  renderWidget()
  const { body, behaviors, height, scroll } = await layOut()
  scroll(height())
  await frame()
  const button = watchLatestButton()

  served[0] = answered(4)
  events.send('changed')
  await screen.findByText('Answer 4')
  await waitFor(() => expect(body.scrollTop).toBe(height() - VIEW))
  expect(behaviors.at(-1)).toBe('smooth')
  // On its way down, the view never offers the button.
  expect(button.shown).toBe(false)

  // Still following when the next one lands.
  served[0] = answered(5)
  events.send('changed')
  await screen.findByText('Answer 5')
  await waitFor(() => expect(body.scrollTop).toBe(height() - VIEW))
})

test('a thread keeps following when the browser nudges it on its way down', async () => {
  const events = fakeEvents()
  const served = [answered(3)]
  fakeServer(served)
  openThread('c1')
  renderWidget()
  const { body, height, scroll, nudge } = await layOut()
  scroll(height())
  const from = body.scrollTop

  served[0] = answered(4)
  events.send('changed')
  await waitFor(() => expect(body.scrollTop).toBeGreaterThan(from))
  // Scroll anchoring, as the content above moves: a few pixels up, not the
  // reader. More arrives before the scroll ends, at the end it aimed for.
  nudge(body.scrollTop - 6)
  served[0] = answered(5)
  events.send('changed')
  await screen.findByText('Answer 5')
  await waitFor(() => expect(body.scrollTop).toBe(height() - VIEW))
})

test('a thread stops following when the reader cuts its way down short', async () => {
  const events = fakeEvents()
  const served = [answered(3)]
  fakeServer(served)
  openThread('c1')
  renderWidget()
  const { body, height, scroll } = await layOut()
  scroll(height())
  const from = body.scrollTop

  served[0] = answered(4)
  events.send('changed')
  await waitFor(() => expect(body.scrollTop).toBeGreaterThan(from))
  scroll(100)
  expect(await screen.findByRole('button', LATEST, { timeout: 2000 })).toBeTruthy()

  served[0] = answered(5)
  events.send('changed')
  await screen.findByText('Answer 5')
  await frame()
  expect(body.scrollTop).toBe(100)
})

test('a thread follows at once under reduced motion', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
  }))
  const events = fakeEvents()
  const served = [answered(3)]
  fakeServer(served)
  openThread('c1')
  renderWidget()
  const { body, behaviors, height, scroll } = await layOut()
  scroll(height())

  served[0] = answered(4)
  events.send('changed')
  await screen.findByText('Answer 4')
  await waitFor(() => expect(body.scrollTop).toBe(height() - VIEW))
  expect(behaviors.at(-1)).toBe('auto')
})

test('a thread scrolled up keeps its place when a message arrives', async () => {
  const events = fakeEvents()
  const served = [answered(3)]
  fakeServer(served)
  openThread('c1')
  renderWidget()
  const { body, height, scroll } = await layOut()
  scroll(height())
  scroll(height() - VIEW - 20)
  await frame()
  // Within the threshold: no button yet.
  expect(screen.queryByRole('button', LATEST)).toBeNull()
  scroll(100)

  served[0] = answered(4)
  events.send('changed')
  await screen.findByText('Answer 4')
  await frame()
  expect(body.scrollTop).toBe(100)
  expect(screen.getByRole('button', LATEST)).toBeTruthy()
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

test('the button to the latest message brings the thread back to following', async () => {
  const events = fakeEvents()
  const served = [answered(3)]
  fakeServer(served)
  openThread('c1')
  renderWidget()
  const { body, height, scroll } = await layOut()
  scroll(height())
  scroll(0)

  fireEvent.click(await screen.findByRole('button', LATEST))
  await waitFor(() => expect(body.scrollTop).toBe(height() - VIEW))

  served[0] = answered(4)
  events.send('changed')
  await screen.findByText('Answer 4')
  await waitFor(() => expect(body.scrollTop).toBe(height() - VIEW))
})

test('a list does not follow the comments that arrive', async () => {
  const events = fakeEvents()
  const served = [answered(1, 'c1'), answered(1, 'c2')]
  fakeServer(served)
  openPanel()
  renderWidget()
  const { body } = await layOut('Make the title bigger')

  served.push(answered(1, 'c3'))
  events.send('changed')
  await waitFor(() => expect(screen.getAllByTestId('an-summary')).toHaveLength(3))
  await frame()
  expect(body.scrollTop).toBe(0)
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
  const sent = { author: 'reader' as const, body: 'Bolder too', at: AT }
  served[0] = comment({ messages: [...replies(3), sent] })
  events.send('changed')
  await screen.findByText('Bolder too')
  await waitFor(() => expect(body.scrollTop).toBe(height() - VIEW))

  // And the answer to it follows.
  const answer = { author: 'claude' as const, body: 'Bolder.', at: AT, run: 'r2' }
  served[0] = comment({ state: 'answered', messages: [...replies(3), sent, answer] })
  events.send('changed')
  await screen.findByText('Bolder.')
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

test('a reply that comes back after the reader left the thread scrolls nothing', async () => {
  fakeEvents()
  // The reply to the send, held back until the test lets it through.
  let reply: (() => void) | undefined
  const server = fakeServer([answered(3)])
  const served = server.fetch.getMockImplementation()
  if (!served) throw new Error('No fake server')
  server.fetch.mockImplementation(async (input: string, init?: RequestInit) => {
    const response = await served(input, init)
    if (init?.method !== 'PATCH') return response
    await new Promise<void>((resolve) => {
      reply = resolve
    })
    return response
  })
  openThread('c1')
  renderWidget()
  await layOut()

  const box = screen.getByPlaceholderText('Follow up, clarify, ask for a change…')
  fireEvent.change(box, { target: { value: 'Bolder too' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }))
  const { body, behaviors } = await layOut('Make the title bigger')
  behaviors.length = 0

  reply?.()
  await waitFor(() => expect(server.patches).toHaveLength(1))
  await frame()
  expect(behaviors).toEqual([])
  expect(body.scrollTop).toBe(0)
})
