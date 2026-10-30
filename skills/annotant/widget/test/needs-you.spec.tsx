import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { comment, fakeEvents, fakeServer, openPanel, openThread } from './server'
import ant from '../src/assets/ant.webp'
import { renderWidget } from './widget'

const asking = (id: string, route = '/other', createdAt = '2026-01-01T10:00:00.000Z') =>
  comment({
    id,
    route,
    createdAt,
    state: 'asking',
    body: `Question ${id}`,
    messages: [{ author: 'claude', body: 'Which colour?', at: createdAt }],
  })

test('Comments shows a badge while threads of any page need the reader, gone once answered', async () => {
  const events = fakeEvents()
  const threads = [asking('c1'), asking('c2', '/'), comment({ id: 'c3' })]
  fakeServer(threads)
  renderWidget()

  const tools = screen.getByRole('group', { name: 'Annotant tools' })
  const badge = await within(tools).findByRole('button', {
    name: 'Comments, 2 threads need you',
  })
  expect(badge.textContent).toBe('2')

  threads.splice(0, 2, { ...asking('c1'), state: 'answered' }, asking('c2', '/'))
  events.send('changed')
  await within(tools).findByRole('button', { name: 'Comments, 1 thread needs you' })

  threads.splice(1, 1, { ...asking('c2', '/'), state: 'resolved' })
  events.send('changed')
  await expect
    .poll(() => within(tools).queryByRole('button', { name: /need/ }))
    .toBeNull()
  expect(within(tools).getByRole('button', { name: 'Comments' }).textContent).toBe('')
})

test('Comments opens every comment filtered to the threads that need the reader', async () => {
  fakeServer([
    asking('c1', '/other', '2026-01-01T10:00:00.000Z'),
    asking('c2', '/', '2026-01-02T10:00:00.000Z'),
    comment({ id: 'c3', body: 'Still open' }),
    comment({ id: 'c4', body: 'Done', state: 'resolved' }),
  ])
  renderWidget()

  fireEvent.click(
    await screen.findByRole('button', { name: 'Comments, 2 threads need you' }),
  )

  const panel = await screen.findByTestId('annotant-panel')
  expect(within(panel).getByRole('heading', { name: 'All comments' })).toBeTruthy()
  expect(
    within(panel).getByRole('radio', { name: 'Needs you' }).getAttribute('aria-checked'),
  ).toBe('true')
  await within(panel).findByText('Question c2')
  const shown = [...panel.querySelectorAll('article')].map((card) => card.textContent)
  expect(shown).toHaveLength(2)
  expect(shown[0]).toContain('Question c2')
  expect(shown[1]).toContain('Question c1')
  expect(within(panel).queryByText('Still open')).toBeNull()
  expect(within(panel).queryByText('Done')).toBeNull()
})

test('Comments leaves the thread the panel was closed on for the threads that need the reader', async () => {
  fakeServer([
    asking('c1'),
    asking('c3', '/other', '2026-01-02T10:00:00.000Z'),
    comment({ id: 'c2', route: '/', body: 'Still open' }),
  ])
  openThread('c2')
  renderWidget()
  fireEvent.click(await screen.findByRole('button', { name: 'Close' }))

  fireEvent.click(
    await screen.findByRole('button', { name: 'Comments, 2 threads need you' }),
  )

  const panel = await screen.findByTestId('annotant-panel')
  expect(within(panel).getByRole('heading', { name: 'All comments' })).toBeTruthy()
  await within(panel).findByText('Question c1')
  expect(within(panel).queryByText('Still open')).toBeNull()
})

test('the badge, gone with the strip, gives the focus to the panel', async () => {
  fakeServer([asking('c1'), asking('c2')])
  renderWidget()

  const badge = await screen.findByRole('button', {
    name: 'Comments, 2 threads need you',
  })
  badge.focus()
  fireEvent.click(badge)

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'All comments' }),
    ),
  )
})

test('Comments opens the only thread that needs the reader, the filtered list behind it', async () => {
  fakeServer([asking('c1'), comment({ id: 'c2', route: '/', body: 'Still open' })])
  renderWidget()

  fireEvent.click(
    await screen.findByRole('button', { name: 'Comments, 1 thread needs you' }),
  )

  const panel = await screen.findByTestId('annotant-panel')
  await within(panel).findByText('Which colour?')
  fireEvent.click(within(panel).getByRole('button', { name: 'Back to the list' }))
  expect(within(panel).getByRole('heading', { name: 'All comments' })).toBeTruthy()
  expect(
    within(panel).getByRole('radio', { name: 'Needs you' }).getAttribute('aria-checked'),
  ).toBe('true')
  expect(within(panel).queryByText('Still open')).toBeNull()
})

test.each(['Point at element', 'Draw area', 'Draw'])(
  'Comments stops %s, in use, for the threads that need the reader',
  async (tool) => {
    fakeServer([asking('c1'), asking('c2')])
    renderWidget()
    await screen.findByRole('button', { name: 'Comments, 2 threads need you' })

    fireEvent.click(screen.getByRole('button', { name: tool }))
    fireEvent.click(screen.getByRole('button', { name: 'Comments, 2 threads need you' }))

    const panel = await screen.findByTestId('annotant-panel')
    expect(panel.hasAttribute('inert')).toBe(false)
    expect(screen.queryByTestId('an-draw')).toBeNull()
    expect(screen.queryByTestId('an-sketch')).toBeNull()
    expect(within(panel).getByRole('heading', { name: 'All comments' })).toBeTruthy()
  },
)

test.each(['Point at element', 'Draw area', 'Draw'])(
  'Comments stops %s with no thread that needs the reader, the tool idle once closed',
  async (tool) => {
    fakeServer([])
    renderWidget()

    fireEvent.click(await screen.findByRole('button', { name: tool }))
    fireEvent.click(screen.getByRole('button', { name: 'Comments' }))
    expect((await screen.findByTestId('annotant-panel')).hasAttribute('inert')).toBe(
      false,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(await screen.findByRole('button', { name: tool })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  },
)

test('Comments, with no thread that needs the reader, opens the panel as it was', async () => {
  fakeServer([comment({ id: 'c1', body: 'Still open' })])
  renderWidget()

  fireEvent.click(await screen.findByRole('button', { name: 'Comments' }))

  const panel = await screen.findByTestId('annotant-panel')
  expect(within(panel).getByRole('heading', { name: 'Comments' })).toBeTruthy()
  await within(panel).findByText('Still open')
})

test('once the panel opens on the page, the list of every comment no longer says an agent works', async () => {
  const events = fakeEvents()
  const threads = [comment({ id: 'c1', route: '/other', state: 'working' }), asking('c2')]
  fakeServer(threads)
  renderWidget()
  await screen.findByRole('button', { name: 'Comments, 1 thread needs you' })

  fireEvent.click(screen.getByRole('button', { name: 'Comments, 1 thread needs you' }))
  fireEvent.click(await screen.findByRole('button', { name: 'New comment' }))
  threads[0] = comment({ id: 'c1', route: '/other', state: 'resolved' })
  events.send('changed')

  const panel = await screen.findByTestId('annotant-panel')
  await expect
    .poll(() => panel.querySelector('.an-composer-brand img')?.getAttribute('src'))
    .toBe(ant)
})

test('on the page, the pin of a thread that needs the reader is a question mark', async () => {
  const box = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockReturnValue(DOMRect.fromRect({ x: 40, y: 100, width: 200, height: 30 }))
  onTestFinished(() => box.mockRestore())
  document.body.replaceChildren()
  const element = {
    selector: 'h1',
    tag: 'h1',
    text: 'Playground',
    html: '<h1>Playground</h1>',
  }
  const events = fakeEvents()
  const question = [
    { author: 'claude' as const, body: 'Which colour?', at: '2026-01-01T10:00:00.000Z' },
  ]
  const threads = [comment({ id: 'c1', element, state: 'asking', messages: question })]
  fakeServer(threads)
  renderWidget()

  const pin = await screen.findByRole('button', { name: 'Open the comment on <h1>' })
  expect(pin.textContent).toBe('?')

  threads[0] = comment({ id: 'c1', element, state: 'answered', messages: question })
  events.send('changed')
  await waitFor(() => expect(pin.textContent).toBe(''))
})

/** The cards of the panel's list, top to bottom. */
const listed = (panel: HTMLElement) =>
  [...panel.querySelectorAll('article')].map((card) => card.textContent)

const inProgress = () =>
  comment({
    id: 'c2',
    route: '/',
    state: 'working',
    body: 'Being worked on',
    createdAt: '2026-01-02T10:00:00.000Z',
  })

test.each(['page', 'all'] as const)(
  'the list (%s) shows the threads that need the reader first, back by date once answered',
  async (view) => {
    const events = fakeEvents()
    const threads = [asking('c1', '/'), inProgress()]
    fakeServer(threads)
    openPanel(view)
    renderWidget()

    const panel = await screen.findByTestId('annotant-panel')
    await within(panel).findByText('Being worked on')
    await waitFor(() => expect(listed(panel)[0]).toContain('Question c1'))

    threads[0] = { ...asking('c1', '/'), state: 'answered' }
    events.send('changed')
    await waitFor(() => expect(listed(panel)[0]).toContain('Being worked on'))
  },
)

test.each(['page', 'all'] as const)(
  'the list (%s) keeps the newest first between two threads that need the reader',
  async (view) => {
    fakeServer([
      asking('c1', '/', '2026-01-01T10:00:00.000Z'),
      inProgress(),
      asking('c3', '/', '2026-01-03T10:00:00.000Z'),
    ])
    openPanel(view)
    renderWidget()

    const panel = await screen.findByTestId('annotant-panel')
    await within(panel).findByText('Being worked on')
    const shown = listed(panel)
    expect(shown).toHaveLength(3)
    expect(shown[0]).toContain('Question c3')
    expect(shown[1]).toContain('Question c1')
    expect(shown[2]).toContain('Being worked on')
  },
)
