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
    'Claude has your comment, waiting for a free agent…',
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(45_000)
  })
  expect(screen.getByTestId('cb-working').textContent).toBe(
    'No agent has started. Check the Claude Code session watching.',
  )
})

test("the reader's reply says an agent is picking it up, at each step", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const at = '2026-01-01T10:00:00.000Z'
  fakeServer([
    comment({
      messages: [
        {
          author: 'claude',
          body: 'Which title?',
          at,
          run: 'r1',
          question: true,
          options: [{ label: 'Fresh coffee, every week' }],
        },
        { author: 'reader', body: 'Fresh coffee, every week', at },
      ],
      events: [
        { at, state: 'open', by: 'reader' },
        { at, state: 'working', by: 'agent', run: 'r1' },
        { at, state: 'asking', by: 'agent', run: 'r1' },
        { at, state: 'open', by: 'reader' },
      ],
      notifiedAt: new Date().toISOString(),
    }),
  ])
  openThread('c1')
  renderWidget()

  const waiting = await screen.findByTestId('cb-working')
  expect(waiting.textContent).toBe('Claude has your reply, an agent is picking it up…')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000)
  })
  expect(screen.getByTestId('cb-working').textContent).toBe(
    'Claude has your reply, waiting for a free agent…',
  )
  expect(screen.getByTestId('cb-working').getAttribute('title')).toMatch(
    /picks up your reply as soon as another ends/,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(45_000)
  })
  expect(screen.getByTestId('cb-working').textContent).toBe(
    'No agent has picked up your reply. Check the Claude Code session watching.',
  )
  expect(screen.getByTestId('cb-working').getAttribute('title')).toMatch(
    /handed your reply over a minute ago/,
  )
})

test("a reply the server has not handed over yet is sent, whatever the comment's was", async () => {
  const at = '2026-01-01T10:00:00.000Z'
  const replied = comment({
    messages: [
      { author: 'claude', body: 'Which title?', at, run: 'r1', question: true },
      { author: 'reader', body: 'Fresh coffee', at },
    ],
    events: [
      { at, state: 'open', by: 'reader' },
      { at, state: 'working', by: 'agent', run: 'r1' },
      { at, state: 'asking', by: 'agent', run: 'r1' },
      { at, state: 'open', by: 'reader' },
    ],
  })
  // The comment itself was handed over long ago; the reply not yet.
  const [first, ...rest] = replied.messages
  fakeServer([
    { ...replied, messages: [{ ...first!, sentAt: at, notifiedAt: at }, ...rest] },
  ])
  openThread('c1')
  renderWidget()

  expect((await screen.findByTestId('cb-working')).textContent).toBe('Sent…')
})

test('a comment re-sent after a stop, with no reply, waits for a new agent', async () => {
  const at = '2026-01-01T10:00:00.000Z'
  fakeServer([
    comment({
      events: [
        { at, state: 'open', by: 'reader' },
        { at, state: 'working', by: 'agent', run: 'r1' },
        { at, state: 'stopped', by: 'reader', run: 'r1' },
        { at, state: 'open', by: 'reader' },
      ],
      notifiedAt: new Date().toISOString(),
    }),
  ])
  openThread('c1')
  renderWidget()

  // No reply in the thread: the server sends it as NEW, and a new agent starts.
  expect((await screen.findByTestId('cb-working')).textContent).toBe(
    'Claude has your comment, an agent is starting…',
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
      'No agent has started. Check the Claude Code session watching.',
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

/** A comment its agent works on, started on `model` for a `complexity` label. */
const routed = (complexity?: 'trivial' | 'hard') =>
  comment({
    state: 'working',
    events: [
      { at: '2026-01-01T10:00:00.000Z', state: 'open', by: 'reader' },
      {
        at: '2026-01-01T10:00:05.000Z',
        state: 'working',
        by: 'agent',
        run: 'r1',
        model: 'claude-haiku-5-5',
        ...(complexity && { complexity }),
      },
    ],
    progress: [
      {
        at: 1,
        kind: 'start',
        label: 'Started',
        state: 'done',
        model: 'claude-haiku-5-5',
      },
    ],
  })

test('a thread names the model Claude works on, and why it was picked', async () => {
  fakeServer([routed('trivial')])
  openThread('c1')
  renderWidget()

  const model = await screen.findByTestId('cb-model')
  expect(model.textContent).toBe('haiku · trivial')
  expect(model.getAttribute('title')).toBe(
    'Claude works on claude-haiku-5-5: the comment was sorted trivial',
  )
  expect(screen.getByTestId('cb-progress').textContent).toContain('Started on haiku')
})

test('a thread with no label names the model alone', async () => {
  fakeServer([routed()])
  openThread('c1')
  renderWidget()

  expect((await screen.findByTestId('cb-model')).textContent).toBe('haiku')
})

test('a thread started before routing names no model', async () => {
  fakeServer([comment({ state: 'working' })])
  openThread('c1')
  renderWidget()

  await screen.findByTestId('cb-progress')
  expect(screen.queryByTestId('cb-model')).toBeNull()
})

const run = (model?: string) => ({
  at: '2026-01-01T10:00:05.000Z',
  state: 'working' as const,
  by: 'agent' as const,
  ...(model && { model }),
})
const reopened = {
  at: '2026-01-01T10:01:00.000Z',
  state: 'open' as const,
  by: 'reader' as const,
}

test("a thread names its latest run's model", async () => {
  fakeServer([
    comment({
      state: 'working',
      events: [reopened, run('claude-haiku-5-5'), reopened, run('claude-opus-5-5')],
    }),
  ])
  openThread('c1')
  renderWidget()
  expect((await screen.findByTestId('cb-model')).textContent).toBe('opus')
})

test('a thread whose latest run recorded no model names none', async () => {
  fakeServer([
    comment({
      state: 'working',
      events: [reopened, run('claude-haiku-5-5'), reopened, run()],
    }),
  ])
  openThread('c1')
  renderWidget()
  await screen.findByTestId('cb-progress')
  expect(screen.queryByTestId('cb-model')).toBeNull()
})
