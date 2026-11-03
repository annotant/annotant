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

test('each answer lists the files its own run changed, folded into a count past one', async () => {
  const at = '2026-01-01T10:00:00.000Z'
  fakeServer([
    comment({
      state: 'answered',
      messages: [
        {
          author: 'claude',
          body: 'The title is bigger.',
          at,
          run: 'r1',
          changed: ['src/data.ts', 'src/pages/Home.tsx'],
        },
        { author: 'reader', body: 'And the footer, everywhere', at },
        {
          author: 'claude',
          body: 'Done.',
          at,
          run: 'r2',
          changed: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
        },
        { author: 'reader', body: 'Why?', at },
        { author: 'claude', body: 'It reads better.', at, run: 'r3' },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  const lists = await screen.findAllByTestId('an-changed')
  // The answer that changed nothing shows nothing.
  expect(lists).toHaveLength(2)
  const [first, second] = lists
  if (!first || !second) throw new Error('two lists expected')
  fireEvent.click(within(first).getByRole('button', { name: '2 files changed' }))
  expect(
    within(first)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(['src/data.ts', 'src/pages/Home.tsx'])
  const toggle = within(second).getByRole('button', { name: '4 files changed' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(within(second).queryByRole('listitem')).toBeNull()
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(
    within(second)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
})

test('a question lists the file its run changed by name', async () => {
  const at = '2026-01-01T10:00:00.000Z'
  fakeServer([
    comment({
      state: 'asking',
      messages: [
        {
          author: 'claude',
          body: 'Which blue?',
          at,
          run: 'r1',
          question: true,
          changed: ['a.ts'],
        },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  const list = await screen.findByRole('list', { name: '1 file changed' })
  expect(
    within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(['a.ts'])
  expect(
    within(screen.getByTestId('an-changed')).queryByRole('button', {
      name: /files? changed/,
    }),
  ).toBeNull()
})

test("a changed file's name shows its run's own diff; Open opens it at the first line it changed", async () => {
  const at = '2026-01-01T10:00:00.000Z'
  const { fetch } = fakeServer(
    [
      comment({
        state: 'answered',
        messages: [
          {
            author: 'claude',
            body: 'Done.',
            at,
            run: 'r1',
            changed: ['src/data.ts', 'src/gone.ts', 'src/big.json'],
            deleted: ['src/gone.ts'],
            firstLines: { 'src/data.ts': 12 },
          },
          { author: 'reader', body: 'Again', at },
          {
            author: 'claude',
            body: 'Done again.',
            at,
            run: 'r2',
            changed: ['src/data.ts'],
          },
        ],
      }),
    ],
    {
      project: '/work/shop',
      diffs: {
        'c1/r1/src/data.ts': {
          hunks: [
            {
              oldStart: 11,
              oldLines: 2,
              newStart: 11,
              newLines: 2,
              lines: [
                { kind: 'context', text: 'const a = 1' },
                { kind: 'removed', text: 'const b = 2' },
                { kind: 'added', text: 'const b = 3' },
              ],
            },
          ],
        },
        'c1/r1/src/big.json': { skipped: 'large' },
        'c1/r2/src/data.ts': { missing: true },
      },
    },
  )
  openThread('c1')
  renderWidget()

  const [first, second] = await screen.findAllByTestId('an-changed')
  if (!first || !second) throw new Error('two lists expected')
  // The first list, folded, loads none; the second, one file shown, its own.
  const diffsAsked = () =>
    fetch.mock.calls.filter(([url]) => url.includes('/diff')).length
  expect(diffsAsked()).toBe(1)
  fireEvent.click(within(first).getByRole('button', { name: '3 files changed' }))
  expect(
    (
      await within(first).findByRole('link', { name: 'Open src/data.ts in VS Code' })
    ).getAttribute('href'),
  ).toBe('vscode://file/work/shop/src/data.ts:12')
  // Unfolded, each file's row counts the lines the run added and removed,
  // before the reader opens its diff.
  expect((await within(first).findByLabelText('1 added, 1 removed')).textContent).toBe(
    '+1−1',
  )
  const show = within(first).getByRole('button', { name: 'src/data.ts' })
  expect(show.getAttribute('aria-expanded')).toBe('false')
  expect(diffsAsked()).toBe(4)

  fireEvent.click(show)
  expect(show.getAttribute('aria-expanded')).toBe('true')
  const diff = await within(first).findByTestId('an-diff')
  expect(diff.textContent).toContain('@@ -11,2 +11,2 @@')
  const kinds = [...diff.querySelectorAll('.an-diff-line')].map(
    (line) =>
      `${line.className.split('--')[1]}:${line.querySelector('.an-diff-text')?.textContent}`,
  )
  expect(kinds).toEqual([
    'context:const a = 1',
    'removed:const b = 2',
    'added:const b = 3',
  ])
  // Each line's number before and after the run.
  expect(
    [...diff.querySelectorAll('.an-diff-line')].map((line) =>
      [...line.querySelectorAll('.an-diff-num')].map((cell) => cell.textContent),
    ),
  ).toEqual([
    ['11', '11'],
    ['12', ''],
    ['', '12'],
  ])
  // Opening it loads nothing more.
  expect(diffsAsked()).toBe(4)
  // No count where no diff was kept, or none could be loaded.
  expect(within(first).getAllByLabelText(/ added, /)).toHaveLength(1)

  fireEvent.click(within(first).getByRole('button', { name: 'src/big.json' }))
  expect(await within(first).findByText('Too large to show.')).toBeTruthy()
  // A deleted file: no link. A server without the route: said, not "none kept".
  expect(within(first).queryByRole('link', { name: /src\/gone\.ts/ })).toBeNull()
  fireEvent.click(within(first).getByRole('button', { name: 'src/gone.ts' }))
  expect((await within(first).findByRole('alert')).textContent).toBe(
    'The diff could not be loaded: Request failed (404)',
  )

  // The second run kept none: it says so, and its link opens at line 1.
  fireEvent.click(within(second).getByRole('button', { name: 'src/data.ts' }))
  expect(await within(second).findByText('No diff was kept for this file.')).toBeTruthy()
  expect(
    within(second)
      .getByRole('link', { name: 'Open src/data.ts in VS Code' })
      .getAttribute('href'),
  ).toBe('vscode://file/work/shop/src/data.ts:1')

  expect(show.getAttribute('title')).toBe('Hide the diff')
  fireEvent.click(show)
  expect(within(first).queryByTestId('an-diff')).toBeNull()

  // One more call in all, for src/gone.ts, opened after its diff failed;
  // folding the list and unfolding it again loads nothing.
  expect(diffsAsked()).toBe(5)
  const toggle = within(first).getByRole('button', { name: '3 files changed' })
  fireEvent.click(toggle)
  fireEvent.click(toggle)
  expect(diffsAsked()).toBe(5)
})

test("each changed file opens in the project's editor", async () => {
  const at = '2026-01-01T10:00:00.000Z'
  fakeServer(
    [
      comment({
        state: 'resolved',
        messages: [
          { author: 'claude', body: 'Done.', at, run: 'r1', changed: ['src/App.tsx'] },
        ],
      }),
    ],
    { project: '/work/shop', editor: 'cursor' },
  )
  openThread('c1')
  renderWidget()

  const link = await screen.findByRole('link', { name: 'Open src/App.tsx in Cursor' })
  expect(link.textContent).toBe('Open')
  expect(link.getAttribute('href')).toBe('cursor://file/work/shop/src/App.tsx:1')
  expect(link.getAttribute('title')).toBe('Open in Cursor')
})

test('a changed file is no link when the project turned the editor off', async () => {
  const at = '2026-01-01T10:00:00.000Z'
  fakeServer(
    [
      comment({
        state: 'resolved',
        messages: [
          { author: 'claude', body: 'Done.', at, run: 'r1', changed: ['src/App.tsx'] },
        ],
      }),
    ],
    { project: '/work/shop', editor: false },
  )
  openThread('c1')
  renderWidget()

  await screen.findByRole('button', { name: 'src/App.tsx' })
  expect(screen.queryByRole('link', { name: /^Open / })).toBeNull()
  expect(screen.queryByText('Open')).toBeNull()
})

test('a changed file says how to name another editor than the assumed VS Code', async () => {
  const at = '2026-01-01T10:00:00.000Z'
  fakeServer(
    [
      comment({
        state: 'resolved',
        messages: [
          { author: 'claude', body: 'Done.', at, run: 'r1', changed: ['src/App.tsx'] },
        ],
      }),
    ],
    { project: '/work/shop' },
  )
  openThread('c1')
  renderWidget()

  const link = await screen.findByRole('link', { name: 'Open src/App.tsx in VS Code' })
  expect(link.getAttribute('title')).toBe(
    'Open in VS Code (another editor: "editor" in .annotant.json)',
  )
})

test('a changed file says the editor setting names nothing it can open', async () => {
  const at = '2026-01-01T10:00:00.000Z'
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  onTestFinished(() => warn.mockRestore())
  fakeServer(
    [
      comment({
        state: 'resolved',
        messages: [
          { author: 'claude', body: 'Done.', at, run: 'r1', changed: ['src/App.tsx'] },
        ],
      }),
    ],
    { project: '/work/shop', editor: 'webstorm' },
  )
  openThread('c1')
  renderWidget()

  expect(
    await screen.findByTitle(
      '"editor" in .annotant.json names no editor Annotant can open',
    ),
  ).toBeTruthy()
  expect(screen.queryByRole('link', { name: /^Open / })).toBeNull()
})

test('a file out of the project is marked external, its path shown on hover', async () => {
  const at = '2026-01-01T10:00:00.000Z'
  fakeServer(
    [
      comment({
        state: 'resolved',
        messages: [
          {
            author: 'claude',
            body: 'Done.',
            at,
            run: 'r1',
            changed: ['src/App.tsx', '/tmp/plan/notes.md'],
          },
        ],
      }),
    ],
    { project: '/work/shop' },
  )
  openThread('c1')
  renderWidget()

  fireEvent.click(await screen.findByRole('button', { name: '2 files changed' }))
  const notes = screen.getByRole('link', { name: 'Open notes.md in VS Code' })
  expect(notes.getAttribute('href')).toBe('vscode://file/tmp/plan/notes.md:1')
  const items = screen.getAllByRole('listitem')
  expect(within(items[0]!).queryByText('external')).toBeNull()
  expect(within(items[1]!).getByText('external').getAttribute('title')).toBe(
    '/tmp/plan/notes.md',
  )
})

test('each changed file says whether the run added, modified or deleted it', async () => {
  const at = '2026-01-01T10:00:00.000Z'
  fakeServer(
    [
      comment({
        state: 'resolved',
        messages: [
          {
            author: 'claude',
            body: 'Done.',
            at,
            run: 'r1',
            changed: ['src/new.ts', 'src/App.tsx', 'src/old.ts'],
            added: ['src/new.ts'],
            deleted: ['src/old.ts'],
          },
        ],
      }),
    ],
    { project: '/work/shop' },
  )
  openThread('c1')
  renderWidget()

  fireEvent.click(await screen.findByRole('button', { name: '3 files changed' }))
  const list = within(screen.getByTestId('an-changed')).getByRole('list')
  expect(
    within(list)
      .getAllByRole('img')
      .map((icon) => icon.getAttribute('aria-label')),
  ).toEqual(['Added', 'Modified', 'Deleted'])
  // A deleted file has nothing left to open.
  expect(
    within(list)
      .getAllByRole('link')
      .map((link) => link.getAttribute('aria-label')),
  ).toEqual(['Open src/new.ts in VS Code', 'Open src/App.tsx in VS Code'])
})

test('each changed file copies its path in the project', async () => {
  const at = '2026-01-01T10:00:00.000Z'
  const writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  onTestFinished(() => {
    Reflect.deleteProperty(navigator, 'clipboard')
  })
  fakeServer(
    [
      comment({
        state: 'resolved',
        messages: [
          {
            author: 'claude',
            body: 'Done.',
            at,
            run: 'r1',
            changed: ['src/App.tsx', '/tmp/plan/notes.md'],
          },
        ],
      }),
    ],
    { project: '/work/shop' },
  )
  openThread('c1')
  renderWidget()

  fireEvent.click(await screen.findByRole('button', { name: '2 files changed' }))
  const copy = screen.getByRole('button', { name: 'Copy the path of src/App.tsx' })
  fireEvent.click(copy)
  expect(writeText).toHaveBeenCalledWith('src/App.tsx')
  await waitFor(() => expect(copy.getAttribute('title')).toBe('Copied'))
  // Out of the project: the path it has, whole.
  fireEvent.click(screen.getByRole('button', { name: 'Copy the path of notes.md' }))
  expect(writeText).toHaveBeenLastCalledWith('/tmp/plan/notes.md')
})

test('a path that cannot be copied says why on its button', async () => {
  const at = '2026-01-01T10:00:00.000Z'
  // Out of a secure context, the browser has no clipboard.
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  onTestFinished(() => {
    Reflect.deleteProperty(navigator, 'clipboard')
  })
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  fakeServer(
    [
      comment({
        state: 'resolved',
        messages: [
          { author: 'claude', body: 'Done.', at, run: 'r1', changed: ['src/App.tsx'] },
        ],
      }),
    ],
    { project: '/work/shop' },
  )
  openThread('c1')
  renderWidget()

  const copy = await screen.findByRole('button', { name: 'Copy the path of src/App.tsx' })
  fireEvent.click(copy)
  await waitFor(() =>
    expect(copy.getAttribute('title')).toBe(
      'Could not copy: the browser allows it only on https or localhost',
    ),
  )
})

test('each file counts the lines it changed, none for a folder or a file with none', async () => {
  const at = '2026-01-01T10:00:00.000Z'
  const { fetch } = fakeServer(
    [
      comment({
        state: 'resolved',
        messages: [
          {
            author: 'claude',
            body: 'Done.',
            at,
            run: 'r1',
            changed: ['src/new.ts', 'src/crlf.ts', 'src/old/'],
            added: ['src/new.ts'],
            deleted: ['src/old/'],
          },
        ],
      }),
    ],
    {
      project: '/work/shop',
      diffs: {
        'c1/r1/src/new.ts': {
          hunks: [
            {
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: 2,
              lines: [
                { kind: 'added', text: 'a' },
                { kind: 'added', text: 'b' },
              ],
            },
          ],
        },
        // Line endings aside, no line changed.
        'c1/r1/src/crlf.ts': { hunks: [] },
      },
    },
  )
  openThread('c1')
  renderWidget()

  fireEvent.click(await screen.findByRole('button', { name: '3 files changed' }))
  // Added lines only: no "−0".
  expect((await screen.findByLabelText('2 added, 0 removed')).textContent).toBe('+2')
  await waitFor(() =>
    expect(fetch.mock.calls.filter(([url]) => url.includes('/diff'))).toHaveLength(2),
  )
  expect(screen.getAllByLabelText(/ added, /)).toHaveLength(1)
  // A deleted folder: no diff asked for, no button to show one.
  expect(fetch.mock.calls.some(([url]) => url.includes('src%2Fold'))).toBe(false)
  expect(screen.queryByRole('button', { name: 'src/old/' })).toBeNull()
})

test('opening a diff that failed loads it again', async () => {
  const at = '2026-01-01T10:00:00.000Z'
  const diffs: Record<string, unknown> = {}
  fakeServer(
    [
      comment({
        state: 'resolved',
        messages: [
          { author: 'claude', body: 'Done.', at, run: 'r1', changed: ['src/a.ts'] },
        ],
      }),
    ],
    { project: '/work/shop', diffs },
  )
  openThread('c1')
  renderWidget()

  const show = await screen.findByRole('button', { name: 'src/a.ts' })
  fireEvent.click(show)
  expect(
    await screen.findByText('The diff could not be loaded: Request failed (404)'),
  ).toBeTruthy()
  // The server has it now: closing and opening again asks once more.
  diffs['c1/r1/src/a.ts'] = { missing: true }
  fireEvent.click(show)
  fireEvent.click(show)
  expect(await screen.findByText('No diff was kept for this file.')).toBeTruthy()
})

const AT = '2026-01-01T10:00:00.000Z'
/** Run r1 at work on the comment. */
const WORKING = [
  { at: AT, state: 'open', by: 'reader' },
  { at: AT, state: 'working', by: 'agent', run: 'r1' },
] as const

test.each(['open', 'working'] as const)(
  'the reader writes to Claude while the comment is %s',
  async (state) => {
    const server = fakeServer([
      comment(state === 'working' ? { state, events: [...WORKING] } : { state }),
    ])
    openThread('c1')
    renderWidget()

    const box = await screen.findByPlaceholderText('Add a detail for Claude…')
    // Still cancellable: the message does not end the run.
    expect(screen.getByTestId('an-cancel')).toBeTruthy()
    fireEvent.change(box, { target: { value: 'Keep the icon' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() =>
      expect(server.patches).toEqual([
        { id: 'c1', patch: { followUp: 'Keep the icon' } },
      ]),
    )
  },
)

test('a message sent during a run says whether its agent read it', async () => {
  fakeServer([
    comment({
      state: 'working',
      events: [...WORKING],
      messages: [
        { author: 'reader', body: 'Keep the icon', at: AT, during: 'r1', readAt: AT },
        { author: 'reader', body: 'And on mobile', at: AT, during: 'r1' },
        { author: 'reader', body: 'Blue, not navy', at: AT, during: 'r1', queued: true },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  await screen.findByText('And on mobile')
  expect(screen.getAllByTestId('an-delivery').map((label) => label.textContent)).toEqual([
    'Read',
    'Sent to the agent at work',
    'Queued for the next agent',
  ])
})

test('a message added while no agent had the comment waits for the next one', async () => {
  fakeServer([
    comment({
      messages: [{ author: 'reader', body: 'Keep the icon', at: AT, queued: true }],
      notifiedAt: AT,
    }),
  ])
  openThread('c1')
  renderWidget()

  expect((await screen.findByTestId('an-delivery')).textContent).toBe(
    'Queued for the next agent',
  )
  // Still about the comment: no reply waits on the hooks.
  expect(screen.getByTestId('an-working').textContent).not.toBe('Sent…')
})
