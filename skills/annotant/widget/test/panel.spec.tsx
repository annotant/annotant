import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import type { ReviewComment } from '../src/domain'
import { comment, fakeEvents, fakeServer, openPanel } from './server'
import { renderWidget } from './widget'

function renderOpenPanel(ui: { docked?: boolean; width?: number } = {}) {
  fakeServer([])
  sessionStorage.setItem(
    'annotant:ui',
    JSON.stringify({ open: true, docked: false, width: 380, view: 'page', ...ui }),
  )
  // An idle animation: happy-dom's own reject an unhandled promise once cancelled, as browsers' do not.
  const animate = vi
    .spyOn(document.documentElement, 'animate')
    .mockImplementation(() => new Animation())
  onTestFinished(() => animate.mockRestore())
  renderWidget()
  return { animate, panel: screen.getByTestId('annotant-panel') }
}

function reduceMotion() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
  }))
}

test('the panel stays on screen while it leaves', async () => {
  const { panel } = renderOpenPanel()
  expect(panel.hasAttribute('data-closing')).toBe(false)

  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(panel.hasAttribute('data-closing')).toBe(true)
  expect(screen.getByRole('button', { name: 'Comments' })).toBeTruthy()

  await waitFor(() => expect(screen.queryByTestId('annotant-panel')).toBeNull())
})

test('the panel restored open after a reload does not slide in, but slides in once reopened', async () => {
  const { panel } = renderOpenPanel()
  expect(panel.hasAttribute('data-restored')).toBe(true)

  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByTestId('annotant-panel')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Comments' }))
  expect(screen.getByTestId('annotant-panel').hasAttribute('data-restored')).toBe(false)
})

test('the panel reopened while it leaves stays', async () => {
  const { panel } = renderOpenPanel()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  fireEvent.click(screen.getByRole('button', { name: 'Comments' }))

  expect(panel.hasAttribute('data-closing')).toBe(false)
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(screen.getByTestId('annotant-panel')).toBe(panel)
})

test('the page makes room for the widened panel in step with it', () => {
  const { animate } = renderOpenPanel()
  const from = getComputedStyle(document.documentElement).paddingRight

  fireEvent.click(screen.getByRole('button', { name: 'Widen panel to half the page' }))
  expect(document.documentElement.style.paddingRight).toBe(`${window.innerWidth / 2}px`)
  expect(animate).toHaveBeenCalledOnce()
  expect(animate.mock.calls[0]?.[0]).toEqual([{ paddingRight: from, offset: 0 }])

  fireEvent.click(screen.getByRole('button', { name: 'Narrow panel' }))
  expect(document.documentElement.style.paddingRight).toBe('')
  expect(animate).toHaveBeenCalledTimes(2)
  expect(animate.mock.calls[1]?.[0]).toEqual([
    { paddingRight: `${window.innerWidth / 2}px`, offset: 0 },
  ])
})

test('the page follows a dragged panel at once', () => {
  const { animate, panel } = renderOpenPanel()
  fireEvent.click(screen.getByRole('button', { name: 'Widen panel to half the page' }))
  animate.mockClear()

  const handle = panel.querySelector('.an-resize')
  if (!handle) throw new Error('No resize handle')
  fireEvent.mouseDown(handle)
  fireEvent.mouseMove(document, { clientX: window.innerWidth - 500 })
  fireEvent.mouseUp(document)

  expect(document.documentElement.style.paddingRight).toBe('500px')
  expect(animate).not.toHaveBeenCalled()
})

test('the page makes room at once when motion is reduced', () => {
  reduceMotion()
  const { animate } = renderOpenPanel()

  fireEvent.click(screen.getByRole('button', { name: 'Widen panel to half the page' }))
  expect(document.documentElement.style.paddingRight).toBe(`${window.innerWidth / 2}px`)
  expect(animate).not.toHaveBeenCalled()
})

test('a width restored from a wider window fits this one', () => {
  renderOpenPanel({ docked: true, width: window.innerWidth + 200 })

  expect(document.documentElement.style.paddingRight).toBe(
    `${Math.round(window.innerWidth * 0.8)}px`,
  )
})

test('the panel narrows with the window, and widens back with it', () => {
  const wide = window.innerWidth
  onTestFinished(() => {
    window.innerWidth = wide
  })
  renderOpenPanel({ docked: true, width: Math.round(wide * 0.8) })

  window.innerWidth = 900
  fireEvent(window, new Event('resize'))
  expect(document.documentElement.style.paddingRight).toBe('720px')

  window.innerWidth = wide
  fireEvent(window, new Event('resize'))
  expect(document.documentElement.style.paddingRight).toBe(`${Math.round(wide * 0.8)}px`)
})

/** Inline styles the host page set itself, taken off again after the test. */
function hostStyles(element: HTMLElement, style: string) {
  element.setAttribute('style', style)
  onTestFinished(() => element.removeAttribute('style'))
}

test("the docked panel leaves the host's inline styles as it found them", async () => {
  // A modal of the host's makes up for the scrollbar it hides.
  hostStyles(document.body, 'padding-right: 15px')
  hostStyles(document.documentElement, 'padding-right: 8px')
  const { panel } = renderOpenPanel()

  fireEvent.click(screen.getByRole('button', { name: 'Widen panel to half the page' }))
  expect(document.body.style.paddingRight).toBe('15px')
  expect(document.documentElement.style.paddingRight).toBe(`${window.innerWidth / 2}px`)

  const handle = panel.querySelector('.an-resize')
  if (!handle) throw new Error('No resize handle')
  fireEvent.mouseDown(handle)
  fireEvent.mouseMove(document, { clientX: window.innerWidth - 500 })
  fireEvent.mouseUp(document)
  expect(document.documentElement.style.paddingRight).toBe('500px')

  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(document.body.style.paddingRight).toBe('15px')
  expect(document.documentElement.style.paddingRight).toBe('8px')
  await waitFor(() => expect(screen.queryByTestId('annotant-panel')).toBeNull())
})

test('what the host writes while the panel is docked stays once it closes', () => {
  hostStyles(document.documentElement, '')
  renderOpenPanel()
  fireEvent.click(screen.getByRole('button', { name: 'Widen panel to half the page' }))

  document.documentElement.style.paddingRight = '20px'
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(document.documentElement.style.paddingRight).toBe('20px')
})

test("resizing the panel puts the host's cursor and selection back", () => {
  hostStyles(document.documentElement, 'cursor: wait; user-select: text')
  const { panel } = renderOpenPanel()

  const handle = panel.querySelector('.an-resize')
  if (!handle) throw new Error('No resize handle')
  fireEvent.mouseDown(handle)
  expect(document.documentElement.style.cursor).toBe('col-resize')
  expect(document.documentElement.style.userSelect).toBe('none')
  fireEvent.mouseUp(document)

  expect(document.documentElement.style.cursor).toBe('wait')
  expect(document.documentElement.style.userSelect).toBe('text')
})

test('a comment with an invalid url shows its route, in the list and its thread', async () => {
  fakeServer([comment({ url: 'x' })])
  openPanel('all')
  renderWidget()

  const page = await screen.findByRole('link', { name: '/' })
  expect(page.getAttribute('href')).toBe('/')
  fireEvent.click(screen.getByText('Make the title bigger'))
  expect((await screen.findByText('Whole page · /')).isConnected).toBe(true)
})

test('a comment that cannot be shown leaves the others, until the server sends it anew', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const events = fakeEvents()
  const good = comment({ id: 'c2', body: 'Fix the footer' })
  const comments = [
    // No thread at all: not a comment the server writes. Stopped, so it can be deleted.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a comment broken on purpose
    { ...comment({ state: 'stopped' }), messages: undefined } as unknown as ReviewComment,
    good,
  ]
  fakeServer(comments)
  openPanel('all')
  renderWidget()

  const broken = await screen.findByTestId('annotant-error')
  expect(broken.textContent).toContain('could not be shown')
  expect(broken.querySelector('[data-testid="an-delete"]')).toBeTruthy()
  expect(screen.getByText('Fix the footer').isConnected).toBe(true)
  expect(screen.getByRole('radiogroup').isConnected).toBe(true)

  comments[0] = comment()
  events.send('changed')
  expect((await screen.findByText('Make the title bigger')).isConnected).toBe(true)
  expect(screen.queryByTestId('annotant-error')).toBeNull()
})

test('the list names the model each comment was worked on with', async () => {
  fakeServer([
    comment({
      state: 'working',
      events: [
        { at: '2026-01-01T10:00:00.000Z', state: 'open', by: 'reader' },
        {
          at: '2026-01-01T10:00:05.000Z',
          state: 'working',
          by: 'agent',
          run: 'r1',
          model: 'claude-opus-5-5',
          complexity: 'hard',
        },
      ],
    }),
  ])
  openPanel('all')
  renderWidget()

  expect((await screen.findByTestId('an-model')).textContent).toBe('opus · hard')
})

/** The chip of the one comment listed. */
const summaryChip = async () =>
  (await screen.findByTestId('an-summary')).querySelector('.an-chip')?.textContent

test('a stopped comment shows a Stopped chip, in the page list and in all comments', async () => {
  fakeServer([comment({ state: 'stopped' })])
  openPanel()
  renderWidget()

  expect(await summaryChip()).toBe('Stopped')
  fireEvent.click(screen.getByRole('button', { name: 'All comments' }))
  // Only All comments links each comment's page.
  await screen.findByRole('link', { name: '/' })
  expect(await summaryChip()).toBe('Stopped')
})

test('the closed panel leaves icons only, and a tool in progress its Cancel', async () => {
  fakeServer([])
  renderWidget()

  const tools = await screen.findByRole('group', { name: 'Annotant tools' })
  expect(tools.textContent).toBe('')
  // In this order: the page's tools, then Comments.
  expect(
    within(tools)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label')),
  ).toEqual(['Move Annotant tools', 'Draw area', 'Draw', 'Point at element', 'Comments'])

  for (const name of ['Draw area', 'Draw', 'Point at element']) {
    const tool = screen.getByRole('button', { name })
    const icon = tool.innerHTML
    fireEvent.click(tool)
    // Its icon stays, before its Cancel.
    expect(tools.textContent).toBe('Cancel')
    expect(tool.innerHTML).toBe(`${icon}Cancel`)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(tools.textContent).toBe('')
  }
})

test('a tool keeps the focus as it turns into its Cancel, and back', async () => {
  fakeServer([])
  renderWidget()

  const draw = await screen.findByRole('button', { name: 'Draw area' })
  draw.focus()
  fireEvent.click(draw)
  expect(screen.getByRole('button', { name: 'Cancel' })).toBe(draw)
  expect(draw.matches(':focus')).toBe(true)

  fireEvent.click(draw)
  expect(screen.getByRole('button', { name: 'Draw area' })).toBe(draw)
  expect(draw.matches(':focus')).toBe(true)
})
