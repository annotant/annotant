import { act, screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { comment, fakeServer, openPanel, openThread } from './server'
import { renderWidget } from './widget'

test('the panel names the branch the agents write to, its worktree on hover', async () => {
  fakeServer([], { git: { branch: 'feature/blue', worktree: '/home/me/shop-blue' } })
  openPanel()
  renderWidget()

  const label = await screen.findByTestId('an-git')
  // The branch alone: the worktree, often named after it, would say it again.
  expect(label.textContent).toBe('feature/blue')
  expect(label.title).toBe(
    'Claude writes on feature/blue, in the worktree /home/me/shop-blue',
  )
  expect(label.className).not.toContain('an-git--default')
})

test('the default branch is a hint, not a block', async () => {
  fakeServer([], { git: { branch: 'main', default: true } })
  openPanel()
  renderWidget()

  const label = await screen.findByTestId('an-git')
  expect(label.className).toContain('an-git--default')
  expect(label.title).toBe('Claude writes on main, the default branch')
  expect(within(label).getByText('(default branch)')).toBeTruthy()
})

test('a detached HEAD shows its short commit', async () => {
  fakeServer([], { git: { commit: 'abc1234' } })
  openPanel()
  renderWidget()

  expect((await screen.findByTestId('an-git')).textContent).toBe('abc1234')
})

test('the branch is read again when the reader comes back to the page', async () => {
  const git = { branch: 'feature/blue' }
  fakeServer([], { git })
  openPanel()
  renderWidget()
  expect((await screen.findByTestId('an-git')).textContent).toBe('feature/blue')

  // Switched in a terminal.
  git.branch = 'main'
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
  await waitFor(() => expect(screen.getByTestId('an-git').textContent).toBe('main'))
})

test('a slow answer never shows over a later one', async () => {
  const server = fakeServer([], { git: { branch: 'feature/blue' } })
  openPanel()
  renderWidget()
  expect((await screen.findByTestId('an-git')).textContent).toBe('feature/blue')

  // The next read hangs until the one after it answered.
  let release: ((response: Response) => void) | undefined
  const original = server.fetch.getMockImplementation()
  server.fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve
      }),
  )
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
  server.fetch.mockImplementation(async (input: string, init?: RequestInit) =>
    new URL(input).pathname.endsWith('/api/git')
      ? Response.json({ branch: 'main' })
      : (original?.(input, init) ?? Response.json([])),
  )
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
  await waitFor(() => expect(screen.getByTestId('an-git').textContent).toBe('main'))
  await act(async () => {
    release?.(Response.json({ branch: 'feature/old' }))
    await Promise.resolve()
  })
  expect(screen.getByTestId('an-git').textContent).toBe('main')
})

test('nothing shows with an older server, which has no /api/git', async () => {
  fakeServer([comment({ state: 'resolved' })])
  openPanel()
  renderWidget()
  await screen.findByTestId('an-summary')
  expect(screen.queryByTestId('an-git')).toBeNull()
})

test('nothing shows outside a git repository', async () => {
  fakeServer([comment({ state: 'resolved' })], { git: {} })
  openPanel()
  renderWidget()
  await screen.findByTestId('an-summary')
  expect(screen.queryByTestId('an-git')).toBeNull()
})

const answeredOn = (fields: Parameters<typeof comment>[0]) =>
  comment({
    state: 'resolved',
    messages: [
      { author: 'claude', run: 'r1', body: 'Done.', at: '2026-01-01T10:05:00.000Z' },
    ],
    ...fields,
  })

test("Claude's answer says the branch its run changed files on, kept on the comment", async () => {
  fakeServer(
    [
      answeredOn({
        events: [
          { at: '2026-01-01T10:00:00.000Z', state: 'open', by: 'reader' },
          {
            at: '2026-01-01T10:01:00.000Z',
            state: 'working',
            by: 'agent',
            run: 'r1',
            git: { branch: 'feature/blue', worktree: '/home/me/shop-blue' },
          },
          { at: '2026-01-01T10:05:00.000Z', state: 'resolved', by: 'agent', run: 'r1' },
        ],
        writes: [
          {
            run: 'r1',
            at: '2026-01-01T10:02:00.000Z',
            branch: 'feature/blue',
            worktree: '/home/me/shop-blue',
          },
        ],
      }),
    ],
    // The project has moved on since: the thread keeps where the run wrote.
    { git: { branch: 'main', default: true } },
  )
  openThread('c1')
  renderWidget()

  const written = await screen.findByTestId('an-written')
  // The branch alone: the worktree, named after it, would say it again.
  expect(written.textContent).toBe('Changed files on feature/blue')
  expect(within(written).getByText('feature/blue').title).toBe(
    'In the worktree /home/me/shop-blue',
  )
  expect(written.className).not.toContain('an-written--moved')
})

test('a run that started on one branch and wrote on another is flagged', async () => {
  fakeServer([
    answeredOn({
      events: [
        { at: '2026-01-01T10:00:00.000Z', state: 'open', by: 'reader' },
        {
          at: '2026-01-01T10:01:00.000Z',
          state: 'working',
          by: 'agent',
          run: 'r1',
          git: { branch: 'feature/blue' },
        },
        { at: '2026-01-01T10:05:00.000Z', state: 'resolved', by: 'agent', run: 'r1' },
      ],
      writes: [
        {
          run: 'r1',
          at: '2026-01-01T10:02:00.000Z',
          branch: 'main',
          switched: { commit: 'abc1234' },
        },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  const written = await screen.findByTestId('an-written')
  expect(written.textContent).toBe(
    'Started on feature/blue, changed files on main, and also on abc1234',
  )
  expect(written.className).toContain('an-written--moved')
})

test('a run that moved to another worktree on the same branch still says so', async () => {
  fakeServer([
    answeredOn({
      events: [
        { at: '2026-01-01T10:00:00.000Z', state: 'open', by: 'reader' },
        {
          at: '2026-01-01T10:01:00.000Z',
          state: 'working',
          by: 'agent',
          run: 'r1',
          git: { branch: 'feature/blue', worktree: '/home/me/shop' },
        },
        { at: '2026-01-01T10:05:00.000Z', state: 'resolved', by: 'agent', run: 'r1' },
      ],
      writes: [
        {
          run: 'r1',
          at: '2026-01-01T10:02:00.000Z',
          branch: 'feature/blue',
          worktree: '/home/me/shop-blue',
          switched: { branch: 'feature/blue', worktree: '/home/me/shop-green' },
        },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  const written = await screen.findByTestId('an-written')
  expect(written.textContent).toBe(
    'Started on feature/blue in another worktree, changed files on feature/blue, and also on feature/blue in another worktree',
  )
  expect(written.className).toContain('an-written--moved')
  expect(
    within(written)
      .getAllByText('feature/blue')
      .map((name) => name.title),
  ).toEqual([
    'In the worktree /home/me/shop',
    'In the worktree /home/me/shop-blue',
    'In the worktree /home/me/shop-green',
  ])
})

test('a run that recorded no write says no branch', async () => {
  fakeServer([answeredOn({})])
  openThread('c1')
  renderWidget()

  await screen.findByText('Done.')
  expect(screen.queryByTestId('an-written')).toBeNull()
})

const RUN = [
  { at: '2026-01-01T10:00:00.000Z', state: 'open', by: 'reader' },
  {
    at: '2026-01-01T10:01:00.000Z',
    state: 'working',
    by: 'agent',
    run: 'r1',
    git: { branch: 'main' },
  },
] as const
const WROTE = [{ run: 'r1', at: '2026-01-01T10:02:00.000Z', branch: 'feature/blue' }]

test('a run at work says where it is changing files, flagged when it moved', async () => {
  fakeServer([comment({ state: 'working', events: [...RUN], writes: WROTE })])
  openThread('c1')
  renderWidget()

  const written = await screen.findByTestId('an-written')
  expect(written.textContent).toBe('Started on main, changed files on feature/blue')
  expect(written.className).toContain('an-written--moved')
})

test('a stopped run says where the files it left changed are', async () => {
  fakeServer([
    comment({
      state: 'stopped',
      events: [
        ...RUN,
        { at: '2026-01-01T10:03:00.000Z', state: 'stopped', by: 'reader', run: 'r1' },
      ],
      writes: WROTE,
      cancellation: {
        at: '2026-01-01T10:03:00.000Z',
        changed: ['src/App.tsx'],
        steps: 2,
        run: 'r1',
      },
    }),
  ])
  openThread('c1')
  renderWidget()

  const stopped = await screen.findByTestId('an-cancelled')
  expect(within(stopped).getByTestId('an-written').textContent).toBe(
    'Started on main, changed files on feature/blue',
  )
})

test('a hand-edited `writes` that is no list shows no branch, and the thread', async () => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a broken file, on purpose
  fakeServer([answeredOn({ writes: {} as unknown as [] })])
  openThread('c1')
  renderWidget()

  await screen.findByText('Done.')
  expect(screen.queryByTestId('an-written')).toBeNull()
})
