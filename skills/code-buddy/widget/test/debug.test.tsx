import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import {
  agentsOf,
  lineBefore,
  timelineOf,
  toggleDebug,
  withSeparators,
} from '../src/debug'
import { comment, fakeServer, openPanel, openThread } from './server'
import { renderWidget } from './widget'

const conversation = comment({
  state: 'asking',
  events: [
    { at: '2026-01-01T10:00:00.000Z', state: 'open', by: 'reader' },
    { at: '2026-01-01T10:00:01.000Z', state: 'working', by: 'agent', run: 'r1' },
    { at: '2026-01-01T10:00:05.000Z', state: 'asking', by: 'agent', run: 'r1' },
  ],
  messages: [
    {
      run: 'r1',
      author: 'claude',
      body: 'Which size?',
      at: '2026-01-01T10:00:05.000Z',
      question: true,
      options: [{ label: '32px', description: 'Like the hero' }, { label: '40px' }],
    },
  ],
  progress: [
    {
      at: Date.parse('2026-01-01T10:00:02.000Z'),
      kind: 'read',
      label: 'App.tsx',
      id: 't1',
      state: 'done',
      run: 'r1',
    },
    {
      at: Date.parse('2026-01-01T10:00:03.000Z'),
      kind: 'bash',
      label: 'npm test',
      id: 't2',
      state: 'failed',
      error: 'exit 1',
      run: 'r1',
    },
  ],
})

// The panel's switch lives in the module: each test starts with it off.
afterEach(() => toggleDebug(false))

const label = (event: ReturnType<typeof timelineOf>[number]) =>
  event.kind === 'status'
    ? event.label
    : event.kind === 'message'
      ? `${event.message.author}: ${event.message.body}`
      : `${event.step.kind} ${event.step.state}`

test('the timeline puts status changes, messages and steps in order', () => {
  expect(timelineOf(conversation).map(label)).toEqual([
    'open',
    'reader: Make the title bigger',
    'working',
    'read done',
    'bash failed',
    'asking',
    'claude: Which size?',
  ])
})

test('a thread that asked twice shows both questions, and each run alone', () => {
  const twice = comment({
    state: 'asking',
    events: [
      { at: '2026-01-01T10:00:00.000Z', state: 'open', by: 'reader' },
      { at: '2026-01-01T10:00:01.000Z', state: 'working', by: 'agent', run: 'r1' },
      { at: '2026-01-01T10:00:02.000Z', state: 'asking', by: 'agent', run: 'r1' },
      { at: '2026-01-01T10:00:03.000Z', state: 'open', by: 'reader' },
      { at: '2026-01-01T10:00:04.000Z', state: 'working', by: 'agent', run: 'r2' },
      { at: '2026-01-01T10:00:06.000Z', state: 'asking', by: 'agent', run: 'r2' },
    ],
    history: [
      {
        at: Date.parse('2026-01-01T10:00:01.500Z'),
        kind: 'read',
        label: 'a',
        state: 'done',
        run: 'r1',
      },
      {
        at: Date.parse('2026-01-01T10:00:05.000Z'),
        kind: 'edit',
        label: 'b',
        state: 'done',
        run: 'r2',
      },
    ],
  })
  expect(
    timelineOf(twice)
      .map(label)
      .filter((entry) => entry === 'asking'),
  ).toHaveLength(2)
  expect(timelineOf(twice, 'r2').map(label)).toEqual(['working', 'edit done', 'asking'])
})

test('the timeline keeps its order around a time that does not parse', () => {
  const cancelled = comment({
    state: 'resolved',
    messages: [
      { author: 'claude', body: 'Done', at: 'not a date' },
      { author: 'reader', body: 'Thanks', at: '2026-01-01T10:00:09.000Z' },
    ],
    events: [
      { at: '2026-01-01T10:00:00.000Z', state: 'open', by: 'reader' },
      { at: '2026-01-01T10:00:01.000Z', state: 'working', by: 'agent', run: 'r1' },
      { at: '2026-01-01T10:00:04.000Z', state: 'stopped', by: 'reader', run: 'r1' },
      { at: '2026-01-01T10:00:08.000Z', state: 'resolved', by: 'reader' },
    ],
    cancellation: {
      at: '2026-01-01T10:00:04.000Z',
      changed: ['src/App.tsx'],
      steps: 3,
      run: 'r1',
    },
  })
  const events = timelineOf(cancelled)
  expect(events.map(label)).toEqual([
    'open',
    'reader: Make the title bigger',
    'working',
    'stopped',
    'run cancelled',
    'resolved',
    'reader: Thanks',
    'claude: Done',
  ])
  expect(events[4]).toMatchObject({ detail: '3 steps, changed: src/App.tsx', run: 'r1' })
})

test('Alt+Shift+D shows the selected comment as the widget holds it', async () => {
  fakeServer([conversation])
  openThread('c1')
  renderWidget()
  await screen.findByText('Which size?')
  expect(screen.queryByTestId('cb-debug')).toBeNull()

  fireEvent.keyDown(window, { code: 'KeyD', key: 'Î', altKey: true, shiftKey: true })
  const panel = within(await screen.findByTestId('cb-debug'))
  expect(panel.getByText('asking', { selector: 'dd .cb-chip' })).toBeTruthy()
  // Each move as the widget's badge, smaller: "working" is its "In progress" tone.
  expect(
    panel.getByText('working', { selector: '.cb-debug-timeline .cb-chip' }).className,
  ).toBe('cb-chip cb-chip--claimed cb-chip--small')
  expect(panel.getByText('options: 32px (Like the hero) | 40px')).toBeTruthy()
  expect(panel.getByText('error: exit 1')).toBeTruthy()
  expect(panel.getByText(/"state": "asking"/)).toBeTruthy()
  const file = panel.getByRole('link', { name: /c1\.history\.jsonl/ })
  expect(file.getAttribute('href')).toMatch(/\/api\/debug\/steps\/c1$/)
  expect(file.getAttribute('target')).toBe('_blank')

  // Claude's message leads to its run: the timeline shows that run alone.
  const runs = within(panel.getByRole('group', { name: 'Runs' }))
  const message = panel.getByText('Which size?', {
    selector: '.cb-debug p',
  }).parentElement
  if (!message) throw new Error("no message for Claude's question")
  fireEvent.click(within(message).getByRole('button', { name: 'r1' }))
  expect(runs.getByRole('button', { name: 'r1' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  expect(panel.queryByText('Make the title bigger')).toBeNull()
  expect(panel.getByText('error: exit 1')).toBeTruthy()

  fireEvent.click(panel.getByRole('button', { name: 'Close the debug panel' }))
  expect(screen.queryByTestId('cb-debug')).toBeNull()
})

test('the header toggle lists the comments of other pages too', async () => {
  fakeServer([comment(), comment({ id: 'c2', route: '/about', body: 'Elsewhere' })])
  openPanel()
  renderWidget()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Debug panel (Alt+Shift+D)' }),
  )

  const panel = within(await screen.findByTestId('cb-debug'))
  await waitFor(() => expect(panel.getByRole('button', { name: 'c2' })).toBeTruthy())
  fireEvent.click(panel.getByRole('button', { name: 'c2' }))
  expect(panel.getByText('/about', { selector: 'dd' })).toBeTruthy()
})

test('the open panel follows the comments as they change', async () => {
  const comments = [comment()]
  fakeServer(comments)
  openThread('c1')
  renderWidget()
  toggleDebug(true)
  const panel = within(await screen.findByTestId('cb-debug'))
  expect(panel.queryByText('working', { selector: 'dd .cb-chip' })).toBeNull()

  comments[0] = comment({ state: 'working' })
  window.dispatchEvent(new Event('code-buddy:changed'))
  expect(await panel.findByText('working', { selector: 'dd .cb-chip' })).toBeTruthy()
})

test('the shortcut leaves fields and other modifiers alone', async () => {
  fakeServer([comment()])
  openPanel()
  renderWidget()
  await screen.findAllByTestId('cb-summary')
  const shortcut = { code: 'KeyD', altKey: true, shiftKey: true }

  fireEvent.keyDown(window, { ...shortcut, metaKey: true })
  fireEvent.keyDown(window, { ...shortcut, ctrlKey: true })
  fireEvent.keyDown(window, { ...shortcut, repeat: true })
  const field = document.createElement('input')
  document.body.append(field)
  fireEvent.keyDown(field, shortcut)
  field.remove()
  expect(screen.queryByTestId('cb-debug')).toBeNull()

  fireEvent.keyDown(document.body, shortcut)
  expect(await screen.findByTestId('cb-debug')).toBeTruthy()
})

test('a reload keeps the panel open, and its raw JSON as it was', async () => {
  fakeServer([conversation])
  openThread('c1')
  const first = renderWidget()
  fireEvent.keyDown(window, { code: 'KeyD', altKey: true, shiftKey: true })
  const panel = within(await screen.findByTestId('cb-debug'))
  fireEvent.click(panel.getByText('Raw ReviewComment'))
  first.unmount()

  // A reload starts the widget's modules over; the session stays.
  vi.resetModules()
  const { default: App } = await import('../src/App')
  const page = document.createElement('main')
  document.body.append(page)
  render(<App root={page} />)
  const raw = (await screen.findByTestId('cb-debug')).querySelector('details')
  expect(raw?.open).toBe(true)
  ;(await import('../src/debug')).toggleDebug(false)
  page.remove()
})

test('a finished run keeps its tool calls, with their ids', async () => {
  const resolved = comment({
    state: 'resolved',
    history: [
      {
        at: Date.parse('2026-01-01T10:00:02.000Z'),
        kind: 'edit',
        label: 'src/App.tsx',
        id: 'toolu_01',
        state: 'done',
      },
    ],
  })
  const { fetch } = fakeServer([resolved])
  openPanel()
  renderWidget()
  toggleDebug(true)

  const panel = within(await screen.findByTestId('cb-debug'))
  expect(await panel.findByText('toolu_01')).toBeTruthy()
  expect(fetch.mock.calls.some(([url]) => /[?&]history=1/.test(url))).toBe(true)
})

test('the live run updates a step of the history', () => {
  const step = { at: 1, kind: 'bash', label: 'npm test', id: 't9' }
  const events = timelineOf(
    comment({
      state: 'working',
      history: [
        { at: 0, kind: 'read', label: 'a.ts', id: 't8', state: 'done' },
        { ...step, state: 'running' },
      ],
      progress: [{ ...step, state: 'done' }],
    }),
  )
  expect(
    events.flatMap((event) =>
      event.kind === 'step' ? [`${event.step.id} ${event.step.state}`] : [],
    ),
  ).toEqual(['t8 done', 't9 done'])
})

test("a tool call's id unfolds what the agent sent and got back", async () => {
  const server = fakeServer([conversation]).fetch
  const comments = server.getMockImplementation()
  server.mockImplementation(async (input, init) =>
    input.endsWith('/api/debug/tool/t2')
      ? Response.json({
          transcript: '/home/u/.claude/projects/-repo/s/subagents/agent-a1.jsonl',
          name: 'Bash',
          input: { command: 'npm test' },
          result: 'exit 1',
          error: true,
        })
      : (comments?.(input, init) ?? new Response(null, { status: 500 })),
  )
  openThread('c1')
  renderWidget()
  toggleDebug(true)

  const panel = within(await screen.findByTestId('cb-debug'))
  const id = panel.getByRole('button', { name: 't2' })
  fireEvent.click(id)
  expect(id.getAttribute('aria-expanded')).toBe('true')
  expect(await panel.findByText(/"command": "npm test"/)).toBeTruthy()
  expect(panel.getByText('exit 1')).toBeTruthy()
  expect(panel.getByText(/agent-a1\.jsonl/)).toBeTruthy()

  fireEvent.click(id)
  expect(panel.queryByText('exit 1')).toBeNull()
})

test('a line marks each run, a bolder one where the agent changes', async () => {
  const runs = comment({
    state: 'working',
    events: [
      { at: '2026-01-01T10:00:00.000Z', state: 'open', by: 'reader' },
      {
        at: '2026-01-01T10:00:01.000Z',
        state: 'working',
        by: 'agent',
        run: 'r1',
        agent: 'a1aaaaaaaa',
      },
      { at: '2026-01-01T10:00:02.000Z', state: 'asking', by: 'agent', run: 'r1' },
      { at: '2026-01-01T10:00:03.000Z', state: 'open', by: 'reader' },
      {
        at: '2026-01-01T10:00:04.000Z',
        state: 'working',
        by: 'agent',
        run: 'r2',
        agent: 'a1aaaaaaaa',
      },
      { at: '2026-01-01T10:00:05.000Z', state: 'asking', by: 'agent', run: 'r2' },
      { at: '2026-01-01T10:00:06.000Z', state: 'open', by: 'reader' },
      { at: '2026-01-01T10:00:07.000Z', state: 'working', by: 'agent', run: 'r3' },
    ],
    // A run whose claim named no agent: its steps do.
    history: [
      {
        at: Date.parse('2026-01-01T10:00:08.000Z'),
        kind: 'read',
        label: 'a',
        run: 'r3',
        agent: 'b2bbbbbbbb',
      },
    ],
  })
  expect(
    withSeparators(timelineOf(runs), agentsOf(runs)).flatMap((row) =>
      row.kind === 'separator' ? [`${row.run} ${row.agent} ${row.newAgent}`] : [],
    ),
  ).toEqual(['r1 a1aaaaaaaa true', 'r2 a1aaaaaaaa false', 'r3 b2bbbbbbbb true'])

  fakeServer([runs])
  openThread('c1')
  renderWidget()
  toggleDebug(true)
  const panel = within(await screen.findByTestId('cb-debug'))
  expect(panel.getByText('Agent a1aaaaaa · run r1')).toBeTruthy()
  expect(panel.getByText('Run r2')).toBeTruthy()
  expect(panel.getByText('Agent b2bbbbbb · run r3')).toBeTruthy()
})

const NEW_LINE = 'NEW c1 route=/ page-level body="Make the title bigger"'
const FOLLOWUP_LINE = 'FOLLOWUP c1 route=/ page-level followup="40px" messages=3'

const twoAgents = comment({
  state: 'working',
  events: [
    { at: '2026-01-01T10:00:00.000Z', state: 'open', by: 'reader' },
    {
      at: '2026-01-01T10:00:02.000Z',
      state: 'working',
      by: 'agent',
      run: 'r1',
      agent: 'a1aaaaaaaa',
    },
    { at: '2026-01-01T10:00:03.000Z', state: 'asking', by: 'agent', run: 'r1' },
    { at: '2026-01-01T10:00:04.000Z', state: 'open', by: 'reader' },
    {
      at: '2026-01-01T10:00:06.000Z',
      state: 'working',
      by: 'agent',
      run: 'r2',
      agent: 'b2bbbbbbbb',
    },
  ],
  lines: [
    { at: '2026-01-01T10:00:01.000Z', line: NEW_LINE },
    { at: '2026-01-01T10:00:03.500Z', line: 'ASKED c1' },
    { at: '2026-01-01T10:00:05.000Z', line: FOLLOWUP_LINE },
  ],
})

test('the timeline shows the lines the server printed, and which one started each run', () => {
  expect(
    timelineOf(twoAgents).flatMap((event) =>
      event.kind === 'status' ? [event.detail ?? event.label] : [],
    ),
  ).toEqual([
    'by reader',
    NEW_LINE,
    'by agent',
    'by agent',
    'ASKED c1',
    'by reader',
    FOLLOWUP_LINE,
    'by agent',
  ])
  expect(lineBefore(twoAgents, 'r1')).toBe(NEW_LINE)
  expect(lineBefore(twoAgents, 'r2')).toBe(FOLLOWUP_LINE)
  expect(lineBefore(comment(), 'r1')).toBeUndefined()
})

/** The server's answer for an agent started with `line` in its prompt. */
const prompt = (agent: string, line: string) =>
  Response.json({
    transcript: `/home/u/.claude/projects/-repo/s/subagents/agent-${agent}.jsonl`,
    prompt: `c1\n${line}\nSKILL=/skill\nPROJECT=/repo`,
  })

test("a new agent's first message unfolds, compared with the line that started it", async () => {
  const server = fakeServer([twoAgents]).fetch
  const comments = server.getMockImplementation()
  server.mockImplementation(async (input, init) =>
    input.endsWith('/api/debug/agent/a1aaaaaaaa')
      ? prompt('a1aaaaaaaa', NEW_LINE)
      : input.endsWith('/api/debug/agent/b2bbbbbbbb')
        ? prompt('b2bbbbbbbb', 'FOLLOWUP c1 rewritten by the manager')
        : (comments?.(input, init) ?? new Response(null, { status: 500 })),
  )
  openThread('c1')
  renderWidget()
  toggleDebug(true)

  const panel = within(await screen.findByTestId('cb-debug'))
  const [first, second] = panel.getAllByRole('button', { name: 'First message' })
  fireEvent.click(first!)
  expect(await panel.findByText(/SKILL=\/skill/)).toBeTruthy()
  expect(panel.getByText('agent-a1aaaaaaaa.jsonl')).toBeTruthy()
  expect(panel.getByText('Holds the server line as printed.')).toBeTruthy()

  fireEvent.click(first!)
  fireEvent.click(second!)
  expect(await panel.findByText(/rewritten by the manager/)).toBeTruthy()
  expect(panel.getByText('Does not hold the server line as printed:')).toBeTruthy()
})
