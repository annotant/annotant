import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { comment, fakeEvents, fakeServer, openPanel, openThread } from './server'
import { renderWidget, shownStep } from './widget'

test('a claimed comment shows what Claude is doing, and can be cancelled', async () => {
  const server = fakeServer([
    comment({
      state: 'working',
      progress: [{ at: 1, kind: 'read', label: 'src/App.tsx', state: 'running' }],
    }),
  ])
  openThread('c1')
  renderWidget()

  await screen.findByTestId('an-progress')
  expect(shownStep()).toContain('Reading src/App.tsx')
  // No reply while it works: the next move is Claude's.
  expect(screen.queryByRole('textbox')).toBeNull()

  fireEvent.click(screen.getByTestId('an-cancel'))
  await waitFor(() =>
    expect(server.patches).toEqual([{ id: 'c1', patch: { cancelled: true } }]),
  )
})

test('an open comment the server has not handed over yet says it was sent', async () => {
  fakeServer([comment()])
  openThread('c1')
  renderWidget()

  expect((await screen.findByTestId('an-working')).textContent).toBe('Sent…')
  expect(screen.queryByTestId('an-unwatched')).toBeNull()
})

test('an open comment says each step while no agent claims it', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  fakeServer([comment({ notifiedAt: new Date().toISOString() })])
  openThread('c1')
  renderWidget()

  const waiting = await screen.findByTestId('an-working')
  expect(waiting.textContent).toBe('Claude has your comment, an agent is starting…')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000)
  })
  expect(screen.getByTestId('an-working').textContent).toBe(
    'Claude has your comment, waiting for a free agent…',
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(45_000)
  })
  expect(screen.getByTestId('an-working').textContent).toBe(
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

  const waiting = await screen.findByTestId('an-working')
  expect(waiting.textContent).toBe('Claude has your reply, an agent is picking it up…')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000)
  })
  expect(screen.getByTestId('an-working').textContent).toBe(
    'Claude has your reply, waiting for a free agent…',
  )
  expect(screen.getByTestId('an-working').getAttribute('title')).toMatch(
    /picks up your reply as soon as another ends/,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(45_000)
  })
  expect(screen.getByTestId('an-working').textContent).toBe(
    'No agent has picked up your reply. Check the Claude Code session watching.',
  )
  expect(screen.getByTestId('an-working').getAttribute('title')).toMatch(
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

  expect((await screen.findByTestId('an-working')).textContent).toBe('Sent…')
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
  expect((await screen.findByTestId('an-working')).textContent).toBe(
    'Claude has your comment, an agent is starting…',
  )
})

test('a sent comment says Claude has it once the server pushes the hand-over', async () => {
  const events = fakeEvents()
  const served = [comment()]
  fakeServer(served)
  openThread('c1')
  renderWidget()

  expect((await screen.findByTestId('an-working')).textContent).toBe('Sent…')
  served[0] = comment({ notifiedAt: new Date().toISOString() })
  events.send('changed')
  await waitFor(() =>
    expect(screen.getByTestId('an-working').textContent).toBe(
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

  await screen.findByTestId('an-working')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  expect(screen.getByTestId('an-working').textContent).toBe('Sent…')
})

test('an open comment handed over long ago says no agent has started at once', async () => {
  fakeServer([comment({ notifiedAt: '2020-01-01T10:00:00.000Z' })])
  openThread('c1')
  renderWidget()

  await waitFor(() =>
    expect(screen.getByTestId('an-working').textContent).toBe(
      'No agent has started. Check the Claude Code session watching.',
    ),
  )
})

test('an open comment says when no session watches', async () => {
  fakeServer([comment()], { reachable: false })
  openThread('c1', 'all')
  renderWidget()

  expect((await screen.findByTestId('an-unwatched')).textContent).toContain(
    'No Claude session is watching',
  )
  expect(screen.queryByTestId('an-working')).toBeNull()
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
  expect(screen.queryByTestId('an-working')).toBeNull()
  expect(screen.queryByTestId('an-cancel')).toBeNull()

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

  const stopped = await screen.findByTestId('an-cancelled')
  expect(stopped.textContent).toBe(
    'Claude was stopped. It had already changed src/App.tsx, src/title.css. ' +
      'Those changes are still in the working tree.',
  )
  expect(screen.queryByTestId('an-working')).toBeNull()

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

  expect((await screen.findByTestId('an-cancelled')).textContent).toBe(
    'Claude was stopped. It had looked around (3 steps) but changed no file.',
  )
})

test('a comment stopped before it started says so', async () => {
  fakeServer([comment({ state: 'stopped' })])
  openThread('c1')
  renderWidget()

  expect((await screen.findByTestId('an-cancelled')).textContent).toBe(
    'Claude was stopped. It had not started yet.',
  )
})

test('a comment its agent left unfinished says so, and sends again', async () => {
  fakeServer([
    comment({
      state: 'stopped',
      events: [
        { at: '2026-01-01T10:00:00.000Z', state: 'open', by: 'reader' },
        { at: '2026-01-01T10:01:00.000Z', state: 'working', by: 'agent', run: 'r1' },
        { at: '2026-01-01T10:02:00.000Z', state: 'stopped', by: 'agent', run: 'r1' },
      ],
      cancellation: { at: '2026-01-01T10:02:00.000Z', changed: [], steps: 3, run: 'r1' },
    }),
  ])
  openThread('c1')
  renderWidget()

  expect((await screen.findByTestId('an-cancelled')).textContent).toBe(
    'Claude stopped without finishing. It had looked around (3 steps) but changed no file.',
  )
  expect(screen.getByRole('button', { name: 'Send again' })).toBeTruthy()
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

  fireEvent.click(await screen.findByTestId('an-cancel'))
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
  expect(screen.queryByTestId('an-working')).toBeNull()
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

  const model = await screen.findByTestId('an-model')
  expect(model.textContent).toBe('haiku · trivial')
  expect(model.getAttribute('title')).toBe(
    'Claude works on claude-haiku-5-5: the comment was sorted trivial',
  )
  expect(shownStep()).toContain('Started on haiku')
})

test('a thread with no label names the model alone', async () => {
  fakeServer([routed()])
  openThread('c1')
  renderWidget()

  expect((await screen.findByTestId('an-model')).textContent).toBe('haiku')
})

test('a thread started before routing names no model', async () => {
  fakeServer([comment({ state: 'working' })])
  openThread('c1')
  renderWidget()

  await screen.findByTestId('an-progress')
  expect(screen.queryByTestId('an-model')).toBeNull()
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
  expect((await screen.findByTestId('an-model')).textContent).toBe('opus')
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
  await screen.findByTestId('an-progress')
  expect(screen.queryByTestId('an-model')).toBeNull()
})

test('a failed step reads its error aloud, which the line keeps in its title', async () => {
  fakeServer([
    comment({
      state: 'working',
      progress: [
        { at: 1, kind: 'bash', label: 'npm test', state: 'failed', error: 'Exit 1' },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  const progress = await screen.findByTestId('an-progress')
  expect(progress.querySelector('[aria-live]')?.textContent).toBe(
    'npm test failed: Exit 1',
  )
})

/** The thread's dates on screen: those shown, not those left to screen readers. */
const shownDates = () =>
  [...document.body.querySelectorAll('.an-message-time')].map((time) =>
    time.getAttribute('datetime'),
  )

test("a thread shows a message's date only once it is clicked, each on its own", async () => {
  const at = '2026-01-01T11:00:00.000Z'
  fakeServer([comment({ messages: [{ author: 'claude', body: 'Done.', at }] })])
  openThread('c1')
  renderWidget()

  const [first, second] = await screen.findAllByTestId('an-msg')
  // Screen readers still read every date.
  expect(first?.querySelector('time')?.className).toBe('an-visually-hidden')
  expect(shownDates()).toEqual([])

  fireEvent.click(first!)
  expect(shownDates()).toEqual(['2026-01-01T10:00:00.000Z'])
  // Another message's date shows too: the first one's stays.
  fireEvent.click(second!)
  expect(shownDates()).toEqual(['2026-01-01T10:00:00.000Z', at])
  fireEvent.click(first!)
  expect(shownDates()).toEqual([at])
})

test("a date shown in one thread stays out of another's message with the same id", async () => {
  fakeServer([
    comment({ id: 'c1', body: 'Make the title bigger' }),
    comment({ id: 'c2', body: 'Make the footer smaller' }),
  ])
  openThread('c1')
  renderWidget()

  fireEvent.click(await screen.findByTestId('an-msg'))
  expect(shownDates()).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Make the footer smaller' }))
  await screen.findByText('Make the footer smaller', { selector: '.an-bubble' })
  expect(shownDates()).toEqual([])
})

test("Enter or Space on a message shows its date, the keys of what it holds don't", async () => {
  fakeServer([
    comment({
      messages: [
        {
          author: 'claude',
          body: 'Which one?',
          at: '2026-01-01T11:00:00.000Z',
          question: true,
          options: [{ label: 'Red' }, { label: 'Blue' }],
        },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  const [first, question] = await screen.findAllByTestId('an-msg')
  fireEvent.keyDown(first!, { key: 'Enter' })
  expect(shownDates()).toEqual(['2026-01-01T10:00:00.000Z'])
  fireEvent.keyDown(first!, { key: ' ' })
  expect(shownDates()).toEqual([])

  const option = within(question!).getByRole('button', { name: 'Red' })
  fireEvent.keyDown(option, { key: 'Enter' })
  fireEvent.click(option)
  expect(shownDates()).toEqual([])
})

test('a click that ends a text selection leaves the date as it is', async () => {
  fakeServer([comment()])
  openThread('c1')
  renderWidget()

  const bubble = await screen.findByText('Make the title bigger')
  const selection = getSelection()!
  selection.selectAllChildren(bubble)
  onTestFinished(() => selection.removeAllRanges())
  fireEvent.click(bubble)
  expect(shownDates()).toEqual([])
})

test('a drag across a message leaves the date as it is, whatever the selection says', async () => {
  fakeServer([comment()])
  openThread('c1')
  renderWidget()

  const bubble = await screen.findByText('Make the title bigger')
  fireEvent.mouseDown(bubble, { clientX: 10, clientY: 10 })
  fireEvent.click(bubble, { clientX: 80, clientY: 12 })
  expect(shownDates()).toEqual([])
  fireEvent.mouseDown(bubble, { clientX: 10, clientY: 10 })
  fireEvent.click(bubble, { clientX: 11, clientY: 10 })
  expect(shownDates()).toEqual(['2026-01-01T10:00:00.000Z'])
})

test("a click on a message's image opens it, not the date", async () => {
  fakeServer([
    comment({
      messages: [
        {
          author: 'reader',
          body: 'Like this',
          at: '2026-01-01T11:00:00.000Z',
          images: ['shot.png'],
        },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  fireEvent.click(await screen.findByAltText('Attached image 1'))
  expect(shownDates()).toEqual([])
})

test('the list keeps each thread its date', async () => {
  fakeServer([comment()])
  openPanel()
  renderWidget()

  expect((await screen.findByTestId('an-summary')).querySelector('time')).not.toBeNull()
})
