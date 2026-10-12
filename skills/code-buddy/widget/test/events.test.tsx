import { act, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { comment, fakeServer, openThread } from './server'
import { renderWidget } from './widget'

/** Stands in for the server's event stream: the test sends its events. */
function fakeEvents() {
  const streams: FakeEventSource[] = []
  class FakeEventSource extends EventTarget {
    closed = false
    constructor(readonly url: string) {
      super()
      streams.push(this)
    }
    close() {
      this.closed = true
    }
  }
  vi.stubGlobal('EventSource', FakeEventSource)
  return {
    streams,
    /** Sends `type` on the stream the widget listens to. */
    send(type: string) {
      const open = streams.filter((stream) => !stream.closed)
      expect(open).toHaveLength(1)
      act(() => {
        open[0]?.dispatchEvent(new Event(type))
      })
    },
  }
}

const listed = (fetch: ReturnType<typeof fakeServer>['fetch']) =>
  fetch.mock.calls.filter(([url, init]) => !init?.method && url.includes('/api/comments'))
    .length

test('a comment shows its new step as soon as the server says it changed', async () => {
  const events = fakeEvents()
  const comments = [
    comment({
      state: 'working',
      progress: [{ at: 1, kind: 'read', label: 'src/App.tsx', state: 'running' }],
    }),
  ]
  fakeServer(comments)
  openThread('c1')
  renderWidget()
  expect((await screen.findByTestId('cb-progress')).textContent).toContain(
    'Reading src/App.tsx',
  )
  expect(events.streams[0]?.url).toMatch(/\/api\/events$/)

  comments[0] = {
    ...comments[0]!,
    progress: [{ at: 2, kind: 'read', label: 'src/main.tsx', state: 'running' }],
  }
  events.send('changed')
  await waitFor(() =>
    expect(screen.getByTestId('cb-progress').textContent).toContain(
      'Reading src/main.tsx',
    ),
  )
})

test('the widget asks for nothing while nothing changes', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  fakeEvents()
  const server = fakeServer([comment({ state: 'working' })])
  openThread('c1')
  renderWidget()
  await screen.findByTestId('cb-working')
  const before = listed(server.fetch)

  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000)
  })
  expect(listed(server.fetch)).toBe(before)
})

test('the widget reloads once its stream comes back after a drop', async () => {
  const events = fakeEvents()
  const server = fakeServer([comment()])
  openThread('c1')
  renderWidget()
  await screen.findByTestId('cb-working')
  const before = listed(server.fetch)

  // The first opening reloads nothing: the lists just loaded.
  events.send('open')
  expect(listed(server.fetch)).toBe(before)
  events.send('error')
  await waitFor(() => expect(listed(server.fetch)).toBe(before + 1))
  events.send('open')
  await waitFor(() => expect(listed(server.fetch)).toBe(before + 2))
})

test('one stream for the tab, closed with the widget', async () => {
  const events = fakeEvents()
  fakeServer([comment()])
  openThread('c1')
  const widget = renderWidget()
  await screen.findByTestId('cb-working')
  expect(events.streams).toHaveLength(1)

  widget.unmount()
  expect(events.streams[0]?.closed).toBe(true)
})
