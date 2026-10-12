import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { comment, fakeEvents, fakeServer, openThread } from './server'
import { renderWidget } from './widget'

test('a claimed comment shows what Claude is doing, and can be cancelled', async () => {
  const server = fakeServer([
    comment({
      state: 'working',
      progress: [{ at: 1, kind: 'read', label: 'src/App.tsx', state: 'running' }],
    }),
  ])
  openThread('c1')
  renderWidget()

  const progress = await screen.findByTestId('cb-progress')
  expect(progress.textContent).toContain('Reading src/App.tsx')
  // No reply while it works: the next move is Claude's.
  expect(screen.queryByRole('textbox')).toBeNull()

  fireEvent.click(screen.getByTestId('cb-cancel'))
  await waitFor(() =>
    expect(server.patches).toEqual([{ id: 'c1', patch: { cancelled: true } }]),
  )
})

test('an open comment the server has not handed over yet says it was sent', async () => {
  fakeServer([comment()])
  openThread('c1')
  renderWidget()

  expect((await screen.findByTestId('cb-working')).textContent).toBe('Sent…')
  expect(screen.queryByTestId('cb-unwatched')).toBeNull()
})

test('an open comment says each step while no agent claims it', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  fakeServer([comment({ notifiedAt: new Date().toISOString() })])
  openThread('c1')
  renderWidget()

  const waiting = await screen.findByTestId('cb-working')
  expect(waiting.textContent).toBe('Claude has your comment, an agent is starting…')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000)
  })
  expect(screen.getByTestId('cb-working').textContent).toBe(
    'Claude has your comment but is busy…',
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(45_000)
  })
  expect(screen.getByTestId('cb-working').textContent).toBe(
    'No agent has started. Is the /code-buddy session busy?',
  )
})

test('a sent comment says Claude has it once the server pushes the hand-over', async () => {
  const events = fakeEvents()
  const served = [comment()]
  fakeServer(served)
  openThread('c1')
  renderWidget()

  expect((await screen.findByTestId('cb-working')).textContent).toBe('Sent…')
  served[0] = comment({ notifiedAt: new Date().toISOString() })
  events.send('changed')
  await waitFor(() =>
    expect(screen.getByTestId('cb-working').textContent).toBe(
      'Claude has your comment, an agent is starting…',
    ),
  )
})

test('an open comment the manager was not sent yet stays sent', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  fakeServer([comment()])
  openThread('c1')
  renderWidget()

  await screen.findByTestId('cb-working')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  expect(screen.getByTestId('cb-working').textContent).toBe('Sent…')
})

test('an open comment handed over long ago says no agent has started at once', async () => {
  fakeServer([comment({ notifiedAt: '2020-01-01T10:00:00.000Z' })])
  openThread('c1')
  renderWidget()

  await waitFor(() =>
    expect(screen.getByTestId('cb-working').textContent).toBe(
      'No agent has started. Is the /code-buddy session busy?',
    ),
  )
})

test('an open comment says when no session watches', async () => {
  fakeServer([comment()], { reachable: false })
  openThread('c1', 'all')
  renderWidget()

  expect((await screen.findByTestId('cb-unwatched')).textContent).toContain(
    'No Claude session is watching',
  )
  expect(screen.queryByTestId('cb-working')).toBeNull()
})

test('a question waits on the reader', async () => {
  const server = fakeServer([
    comment({
      state: 'asking',
      messages: [
        {
          author: 'claude',
          body: 'Which title?',
          at: '2026-01-01T10:01:00.000Z',
          question: true,
        },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  const box = await screen.findByPlaceholderText('Answer Claude…')
  expect(screen.queryByTestId('cb-working')).toBeNull()
  expect(screen.queryByTestId('cb-cancel')).toBeNull()

  fireEvent.change(box, { target: { value: 'The page title' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() =>
    expect(server.patches).toEqual([{ id: 'c1', patch: { followUp: 'The page title' } }]),
  )
})

test('a stopped comment lists the files Claude changed, and sends again', async () => {
  const server = fakeServer([
    comment({
      state: 'stopped',
      cancellation: {
        at: '2026-01-01T10:02:00.000Z',
        changed: ['src/App.tsx', 'src/title.css'],
        steps: 4,
      },
    }),
  ])
  openThread('c1')
  renderWidget()

  const stopped = await screen.findByTestId('cb-cancelled')
  expect(stopped.textContent).toBe(
    'Claude was stopped. It had already changed src/App.tsx, src/title.css. ' +
      'Those changes are still in the working tree.',
  )
  expect(screen.queryByTestId('cb-working')).toBeNull()

  const box = screen.getByRole('textbox', {
    name: 'Edit the comment before sending it again',
  })
  expect(box).toHaveProperty('value', 'Make the title bigger')
  fireEvent.change(box, { target: { value: 'Make the title much bigger' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send again' }))
  await waitFor(() =>
    expect(server.patches).toEqual([
      { id: 'c1', patch: { text: 'Make the title much bigger', cancelled: false } },
    ]),
  )
})

test('a stopped comment says when Claude had changed nothing', async () => {
  fakeServer([
    comment({
      state: 'stopped',
      cancellation: { at: '2026-01-01T10:02:00.000Z', changed: [], steps: 3 },
    }),
  ])
  openThread('c1')
  renderWidget()

  expect((await screen.findByTestId('cb-cancelled')).textContent).toBe(
    'Claude was stopped. It had looked around (3 steps) but changed no file.',
  )
})

test('a comment stopped before it started says so', async () => {
  fakeServer([comment({ state: 'stopped' })])
  openThread('c1')
  renderWidget()

  expect((await screen.findByTestId('cb-cancelled')).textContent).toBe(
    'Claude was stopped. It had not started yet.',
  )
})

test("a move the comment can no longer make shows the server's words", async () => {
  const server = fakeServer([comment({ state: 'working' })]).fetch
  const comments = server.getMockImplementation()
  server.mockImplementation(async (input, init) =>
    init?.method === 'PATCH'
      ? Response.json({ error: 'comment c1 is resolved' }, { status: 409 })
      : (comments?.(input, init) ?? new Response(null, { status: 500 })),
  )
  openThread('c1')
  renderWidget()

  fireEvent.click(await screen.findByTestId('cb-cancel'))
  expect(await screen.findByText('comment c1 is resolved')).toBeTruthy()
})

test("sending again starts from the reader's latest words, not their first", async () => {
  fakeServer([
    comment({
      state: 'stopped',
      messages: [
        { author: 'claude', body: 'Done.', at: '2026-01-01T10:01:00.000Z', run: 'r1' },
        { author: 'reader', body: 'Bigger still', at: '2026-01-01T10:02:00.000Z' },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  const box = await screen.findByRole('textbox', {
    name: 'Edit the comment before sending it again',
  })
  expect(box).toHaveProperty('value', 'Bigger still')
})

test("Claude's answer to a follow-up waits on the reader, who resolves it", async () => {
  const server = fakeServer([
    comment({
      state: 'answered',
      messages: [
        { author: 'claude', body: 'Bigger.', at: '2026-01-01T10:01:00.000Z', run: 'r1' },
        { author: 'reader', body: 'Bolder too', at: '2026-01-01T10:02:00.000Z' },
        { author: 'claude', body: 'Bolder.', at: '2026-01-01T10:03:00.000Z', run: 'r2' },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  expect(
    await screen.findByPlaceholderText('Follow up, clarify, ask for a change…'),
  ).toBeTruthy()
  expect(screen.queryByTestId('cb-working')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
  await waitFor(() =>
    expect(server.patches).toEqual([{ id: 'c1', patch: { status: 'resolved' } }]),
  )
})
