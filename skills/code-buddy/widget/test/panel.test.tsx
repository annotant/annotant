import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import type { ReviewComment } from '../src/domain'
import { comment, fakeServer, openPanel } from './server'
import { renderWidget } from './widget'

function renderOpenPanel() {
  fakeServer([])
  sessionStorage.setItem(
    'code-buddy:ui',
    JSON.stringify({ open: true, docked: false, width: 380, view: 'page' }),
  )
  // An idle animation: happy-dom's own reject an unhandled promise once cancelled, as browsers' do not.
  const animate = vi
    .spyOn(document.body, 'animate')
    .mockImplementation(() => new Animation())
  onTestFinished(() => animate.mockRestore())
  renderWidget()
  return { animate, panel: screen.getByTestId('code-buddy-panel') }
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
  expect(screen.getByRole('button', { name: 'Comment' })).toBeTruthy()

  await waitFor(() => expect(screen.queryByTestId('code-buddy-panel')).toBeNull())
})

test('the panel reopened while it leaves stays', async () => {
  const { panel } = renderOpenPanel()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }))

  expect(panel.hasAttribute('data-closing')).toBe(false)
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(screen.getByTestId('code-buddy-panel')).toBe(panel)
})

test('the page makes room for the widened panel in step with it', () => {
  const { animate } = renderOpenPanel()
  const from = getComputedStyle(document.body).paddingRight

  fireEvent.click(screen.getByRole('button', { name: 'Widen panel to half the page' }))
  expect(document.body.style.paddingRight).toBe(`${window.innerWidth / 2}px`)
  expect(animate).toHaveBeenCalledOnce()
  expect(animate.mock.calls[0]?.[0]).toEqual([{ paddingRight: from, offset: 0 }])

  fireEvent.click(screen.getByRole('button', { name: 'Narrow panel' }))
  expect(document.body.style.paddingRight).toBe('')
  expect(animate).toHaveBeenCalledTimes(2)
  expect(animate.mock.calls[1]?.[0]).toEqual([
    { paddingRight: `${window.innerWidth / 2}px`, offset: 0 },
  ])
})

test('the page follows a dragged panel at once', () => {
  const { animate, panel } = renderOpenPanel()
  fireEvent.click(screen.getByRole('button', { name: 'Widen panel to half the page' }))
  animate.mockClear()

  const handle = panel.querySelector('.cb-resize')
  if (!handle) throw new Error('No resize handle')
  fireEvent.mouseDown(handle)
  fireEvent.mouseMove(document, { clientX: window.innerWidth - 500 })
  fireEvent.mouseUp(document)

  expect(document.body.style.paddingRight).toBe('500px')
  expect(animate).not.toHaveBeenCalled()
})

test('the page makes room at once when motion is reduced', () => {
  reduceMotion()
  const { animate } = renderOpenPanel()

  fireEvent.click(screen.getByRole('button', { name: 'Widen panel to half the page' }))
  expect(document.body.style.paddingRight).toBe(`${window.innerWidth / 2}px`)
  expect(animate).not.toHaveBeenCalled()
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

test('a comment that cannot be shown leaves the rest of the panel working', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // No thread at all: not a comment the server writes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a comment broken on purpose
  fakeServer([{ ...comment(), messages: undefined } as unknown as ReviewComment])
  openPanel('all')
  renderWidget()

  expect((await screen.findByTestId('code-buddy-error')).textContent).toContain(
    'could not be shown',
  )
  fireEvent.click(screen.getByRole('button', { name: 'New comment' }))
  expect(screen.queryByTestId('code-buddy-error')).toBeNull()
  expect(screen.getByRole('heading', { name: 'New comment' }).isConnected).toBe(true)
})
