import { fireEvent, screen } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { fakeServer, openPanel } from './server'
import { renderWidget } from './widget'

const LAYOUT_KEY = 'annotant:layout'

const stored = () => JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as unknown

function renderOpen(layout: object = {}) {
  fakeServer([])
  localStorage.setItem(LAYOUT_KEY, JSON.stringify({ width: 380, ...layout }))
  openPanel()
  // An idle animation: happy-dom's own reject an unhandled promise once cancelled.
  const animate = vi
    .spyOn(document.documentElement, 'animate')
    .mockImplementation(() => new Animation())
  onTestFinished(() => animate.mockRestore())
  const view = renderWidget()
  return { ...view, panel: () => screen.getByTestId('annotant-panel') }
}

test('the panel moves to the left and back, kept for the next tabs', () => {
  const first = renderOpen()
  expect(first.panel().dataset['side']).toBe('right')

  fireEvent.click(screen.getByRole('button', { name: 'Move to the left' }))
  expect(first.panel().dataset['side']).toBe('left')
  expect(stored()).toMatchObject({ side: 'left' })
  first.unmount()

  const again = renderOpen({ side: 'left' })
  expect(again.panel().dataset['side']).toBe('left')
  fireEvent.click(screen.getByRole('button', { name: 'Move to the right' }))
  expect(again.panel().dataset['side']).toBe('right')
  expect(stored()).not.toHaveProperty('side')
})

test('the docked panel squeezes the page on its own side', () => {
  renderOpen({ docked: true, width: 500, side: 'left' })
  const html = document.documentElement
  expect(html.style.paddingLeft).toBe('500px')
  expect(html.style.paddingRight).toBe('')

  fireEvent.click(screen.getByRole('button', { name: 'Move to the right' }))
  expect(html.style.paddingLeft).toBe('')
  expect(html.style.paddingRight).toBe('500px')

  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(html.style.paddingRight).toBe('')
})

test('on the left, the panel widens as its right edge is dragged to the right', () => {
  const { panel } = renderOpen({ side: 'left' })
  const handle = panel().querySelector('.an-resize')
  if (!handle) throw new Error('No resize handle')
  fireEvent.mouseDown(handle)
  fireEvent.mouseMove(document, { clientX: 500 })
  fireEvent.mouseUp(document)
  expect(panel().style.width).toBe('500px')
})

test('the strip goes along, to the same place on the other side', () => {
  localStorage.setItem(
    LAYOUT_KEY,
    JSON.stringify({ strip: { corner: 'top-right', x: 40, y: 80 } }),
  )
  fakeServer([])
  renderWidget()
  fireEvent.click(screen.getByRole('button', { name: 'Comments' }))
  fireEvent.click(screen.getByRole('button', { name: 'Move to the left' }))
  expect(stored()).toMatchObject({
    side: 'left',
    strip: { corner: 'top-left', x: 40, y: 80 },
  })

  fireEvent.click(screen.getByRole('button', { name: 'Move to the right' }))
  expect(stored()).toMatchObject({ strip: { corner: 'top-right', x: 40, y: 80 } })
})

test("the strip left in its own place sits on the widget's side", () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify({ side: 'left' }))
  fakeServer([])
  renderWidget()
  const tools = screen.getByRole('group', { name: 'Annotant tools' })
  expect(tools.dataset['side']).toBe('left')
  expect(tools.getAttribute('style')).toBeNull()
})

test('a side kept wrong is left out', () => {
  const { panel } = renderOpen({ side: 'middle' })
  expect(panel().dataset['side']).toBe('right')
})
