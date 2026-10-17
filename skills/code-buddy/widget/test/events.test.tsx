import { act, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { comment, fakeEvents, fakeServer, openPanel, openThread } from './server'
import { renderWidget } from './widget'

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
  expect(screen.queryByTestId('cb-understood')).toBeNull()
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

test('what the agent understood shows above its current step', async () => {
  fakeServer([
    comment({
      state: 'working',
      understood: 'the title becomes "Plans", in src/Home.tsx',
      progress: [{ at: 1, kind: 'edit', label: 'src/Home.tsx', state: 'running' }],
    }),
  ])
  openThread('c1')
  renderWidget()
  expect((await screen.findByTestId('cb-understood')).textContent).toBe(
    'Understood: the title becomes "Plans", in src/Home.tsx',
  )
  expect(screen.getByTestId('cb-progress').textContent).toContain('Editing src/Home.tsx')
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
  // Then the slow reload, for what a dropped stream missed.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(11_000)
  })
  expect(listed(server.fetch)).toBe(before + 1)
})

test('the widget reloads each time its stream opens, the first time included', async () => {
  const events = fakeEvents()
  const server = fakeServer([comment()])
  openThread('c1')
  renderWidget()
  await screen.findByTestId('cb-working')
  const before = listed(server.fetch)

  // A change made before the server knew this tab is in this reload.
  events.send('open')
  await waitFor(() => expect(listed(server.fetch)).toBe(before + 1))
  events.send('error')
  await waitFor(() => expect(listed(server.fetch)).toBe(before + 2))
  events.send('open')
  await waitFor(() => expect(listed(server.fetch)).toBe(before + 3))
})

test('one stream for the tab whatever the number of lists, closed with the widget', async () => {
  const events = fakeEvents()
  fakeServer([comment()])
  // The page's list and the whole app's.
  openPanel('all')
  const widget = renderWidget()
  await screen.findAllByTestId('cb-summary')
  expect(events.streams).toHaveLength(1)

  widget.unmount()
  expect(events.streams[0]?.closed).toBe(true)
})

test('a hidden tab closes its stream, and opens a new one once shown', async () => {
  const events = fakeEvents()
  const server = fakeServer([comment()])
  openThread('c1')
  renderWidget()
  await screen.findByTestId('cb-working')
  let hidden = true
  const visibility = vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  onTestFinished(() => visibility.mockRestore())

  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(events.streams[0]?.closed).toBe(true)

  hidden = false
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(events.streams).toHaveLength(2)
  const before = listed(server.fetch)
  events.send('open')
  await waitFor(() => expect(listed(server.fetch)).toBe(before + 1))
})

test('a stream the browser gave up on is opened again', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const events = fakeEvents()
  fakeServer([comment()])
  openThread('c1')
  renderWidget()
  await screen.findByTestId('cb-working')

  // Something else answered on the server's port: no retry of the browser's own.
  const given = events.streams[0]!
  given.readyState = 2
  events.send('error')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(given.closed).toBe(true)
  expect(events.streams).toHaveLength(2)
  expect(events.streams[1]?.closed).toBe(false)
})
