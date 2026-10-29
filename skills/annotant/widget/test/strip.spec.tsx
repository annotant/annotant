import { act, fireEvent, screen } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { fitPlace, placeOf, viewport } from '../src/layout'
import { fakeServer } from './server'
import { renderWidget, resizes } from './widget'

const WIDTH = 130
const HEIGHT = 36
const LAYOUT_KEY = 'annotant:layout'

const isDock = (element: Element) => element.classList.contains('an-dock')
const px = (value: string) => (value && value !== 'auto' ? parseFloat(value) : undefined)

/** happy-dom lays nothing out: the tools take `size`, where their inline style puts them. */
const size = { width: WIDTH }

function layOut() {
  size.width = WIDTH
  const width = vi
    .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return isDock(this) ? size.width : 0
    })
  const height = vi
    .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return isDock(this) ? HEIGHT : 0
    })
  const box = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      if (!(this instanceof HTMLElement) || !isDock(this)) return new DOMRect()
      const { style } = this
      const bounds = viewport()
      const left = px(style.left) ?? bounds.width - (px(style.right) ?? 16) - size.width
      const top = px(style.top) ?? bounds.height - (px(style.bottom) ?? 16) - HEIGHT
      return new DOMRect(left, top, size.width, HEIGHT)
    })
  onTestFinished(() => {
    width.mockRestore()
    height.mockRestore()
    box.mockRestore()
  })
}

function renderClosed() {
  fakeServer([])
  layOut()
  renderWidget()
  const tools = screen.getByRole('group', { name: 'Annotant tools' })
  const grip = screen.getByRole('button', { name: 'Move Annotant tools' })
  return { tools, grip }
}

const stored = () => JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as unknown

test('the strip takes the corner nearest to it, and stays fully in the window', () => {
  const bounds = { width: 1000, height: 800 }
  expect(placeOf({ left: 20, top: 30, width: WIDTH, height: HEIGHT }, bounds)).toEqual({
    corner: 'top-left',
    x: 20,
    y: 30,
  })
  expect(placeOf({ left: 800, top: 700, width: WIDTH, height: HEIGHT }, bounds)).toEqual({
    corner: 'bottom-right',
    x: 70,
    y: 64,
  })
  expect(
    fitPlace(
      { corner: 'bottom-right', x: 900, y: -10 },
      { width: WIDTH, height: HEIGHT },
      bounds,
    ),
  ).toEqual({ corner: 'bottom-right', x: 870, y: 0 })
})

test('the strip dragged by its grip lands where it is dropped, kept for every tab', () => {
  const { tools, grip } = renderClosed()
  const start = tools.getBoundingClientRect()
  // Grabbed 5px into the strip.
  fireEvent.mouseDown(grip, {
    button: 0,
    clientX: start.left + 5,
    clientY: start.top + 5,
  })
  fireEvent.mouseMove(document, { clientX: 45, clientY: 55 })
  expect([tools.style.left, tools.style.top]).toEqual(['40px', '50px'])
  fireEvent.mouseUp(document)

  expect(stored()).toMatchObject({ strip: { corner: 'top-left', x: 40, y: 50 } })
  expect([tools.style.left, tools.style.top, tools.style.right]).toEqual([
    '40px',
    '50px',
    'auto',
  ])
  // The drag ends with a click on the grip: no tool started.
  fireEvent.click(grip)
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
})

test('a click on the grip, or a drag with another button, leaves the strip in place', () => {
  const { tools, grip } = renderClosed()
  fireEvent.mouseDown(grip, { button: 0 })
  fireEvent.mouseUp(document)
  fireEvent.click(grip)
  fireEvent.mouseDown(grip, { button: 2 })
  fireEvent.mouseMove(document, { clientX: 45, clientY: 55 })
  fireEvent.mouseUp(document)

  expect(tools.getAttribute('style')).toBeNull()
  expect(stored()).not.toHaveProperty('strip')
})

test('the strip grown by a Cancel stays on screen', () => {
  const resize = resizes()
  const bounds = viewport()
  localStorage.setItem(
    LAYOUT_KEY,
    JSON.stringify({ strip: { corner: 'top-left', x: bounds.width - WIDTH, y: 10 } }),
  )
  const { tools } = renderClosed()
  expect(tools.style.left).toBe(`${bounds.width - WIDTH}px`)

  fireEvent.click(screen.getByRole('button', { name: 'Draw area' }))
  size.width = 200
  act(() => resize(tools))
  expect(tools.style.left).toBe(`${bounds.width - 200}px`)
})

test('a tab changes only what was changed in it, not what another tab changed since', () => {
  const { grip } = renderClosed()
  // Another tab docks the panel meanwhile.
  localStorage.setItem(LAYOUT_KEY, JSON.stringify({ docked: true, width: 500 }))
  fireEvent.keyDown(grip, { key: 'ArrowLeft' })
  expect(stored()).toMatchObject({ docked: true, width: 500, strip: { x: 26 } })
})

test('the strip still moves where storage is blocked', () => {
  const blocked = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('Blocked', 'SecurityError')
  })
  try {
    const { tools, grip } = renderClosed()
    fireEvent.keyDown(grip, { key: 'ArrowLeft' })
    expect(tools.style.right).toBe('26px')
  } finally {
    // Before the storage is cleared after the test.
    blocked.mockRestore()
  }
})

test('the arrow keys move the strip, further with Shift', () => {
  const { tools, grip } = renderClosed()
  fireEvent.keyDown(grip, { key: 'ArrowLeft' })
  expect(tools.style.right).toBe('26px')
  fireEvent.keyDown(grip, { key: 'ArrowUp', shiftKey: true })
  expect(tools.style.bottom).toBe('66px')
  expect(stored()).toMatchObject({ strip: { corner: 'bottom-right', x: 26, y: 66 } })
})

test('the strip comes back where it was in a new tab', () => {
  localStorage.setItem(
    LAYOUT_KEY,
    JSON.stringify({ strip: { corner: 'top-left', x: 100, y: 80 } }),
  )
  const { tools } = renderClosed()
  expect(tools.style.left).toBe('100px')
  expect(tools.style.top).toBe('80px')
})

test('a strip kept from a larger window stays on screen, and as the window narrows', () => {
  const bounds = viewport()
  localStorage.setItem(
    LAYOUT_KEY,
    JSON.stringify({ strip: { corner: 'top-left', x: bounds.width - 100, y: 10 } }),
  )
  const { tools } = renderClosed()
  expect(tools.style.left).toBe(`${bounds.width - WIDTH}px`)

  const wide = window.innerWidth
  onTestFinished(() => {
    window.innerWidth = wide
  })
  window.innerWidth = 600
  fireEvent(window, new Event('resize'))
  expect(tools.style.left).toBe(`${600 - WIDTH}px`)
  // The place chosen is kept as is.
  expect(stored()).toMatchObject({ strip: { x: bounds.width - 100 } })
})

test('a double-click on the grip puts the strip back in the bottom right corner', () => {
  localStorage.setItem(
    LAYOUT_KEY,
    JSON.stringify({ strip: { corner: 'top-left', x: 100, y: 80 } }),
  )
  const { tools, grip } = renderClosed()
  fireEvent.doubleClick(grip)
  expect(tools.getAttribute('style')).toBeNull()
  expect(stored()).not.toHaveProperty('strip')
})

test('a strip kept wrong is left out', () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify({ strip: { corner: 'middle', x: 1 } }))
  const { tools } = renderClosed()
  expect(tools.getAttribute('style')).toBeNull()
})

test('the panel docked in another tab opens docked', () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify({ docked: true, width: 500 }))
  sessionStorage.setItem('annotant:ui', JSON.stringify({ open: true, view: 'page' }))
  fakeServer([])
  const animate = vi
    .spyOn(document.documentElement, 'animate')
    .mockImplementation(() => new Animation())
  onTestFinished(() => animate.mockRestore())
  renderWidget()

  expect(screen.getByTestId('annotant-panel').classList).toContain('an-panel--docked')
  fireEvent.click(screen.getByRole('button', { name: 'Narrow panel' }))
  expect(stored()).toMatchObject({ docked: false, width: 380 })
})
