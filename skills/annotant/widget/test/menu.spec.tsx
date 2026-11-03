import { act, fireEvent, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { fakeServer, openPanel } from './server'
import { renderWidget } from './widget'

function openMenu() {
  fakeServer([])
  openPanel()
  renderWidget()
  const button = screen.getByRole('button', { name: 'More actions' })
  fireEvent.click(button)
  return { button, menu: screen.getByRole('menu', { name: 'More actions' }) }
}

const items = () => screen.getAllByRole('menuitem')

/** A key pressed where the focus is, as a browser sends it. */
function press(key: string) {
  if (document.activeElement) fireEvent.keyDown(document.activeElement, { key })
}

test("the panel's header keeps its most used buttons, the others in its menu", () => {
  const { button } = openMenu()
  expect(button.getAttribute('aria-expanded')).toBe('true')
  expect(items().map((item) => item.textContent)).toEqual([
    'Widen panel to half the page',
    'Move to the left',
    'Settings',
  ])
  expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
})

test('the arrow keys go through the items, round and round', () => {
  openMenu()
  const [first, second, last] = items()
  expect(document.activeElement).toBe(first)

  press('ArrowDown')
  expect(document.activeElement).toBe(second)
  press('End')
  expect(document.activeElement).toBe(last)
  press('ArrowDown')
  expect(document.activeElement).toBe(first)
  press('ArrowUp')
  expect(document.activeElement).toBe(last)
})

test('Escape closes the menu, not the panel, and gives the focus back to its button', () => {
  const { button } = openMenu()
  const [first] = items()
  if (!first) throw new Error('No item')
  fireEvent.keyDown(first, { key: 'Escape' })

  expect(screen.queryByRole('menu')).toBeNull()
  expect(screen.getByTestId('annotant-panel').hasAttribute('data-closing')).toBe(false)
  expect(document.activeElement).toBe(button)
  expect(button.getAttribute('aria-expanded')).toBe('false')
})

test('the focus leaving the menu closes it: a click outside, or Tab', () => {
  openMenu()
  const outside = document.createElement('button')
  document.body.append(outside)
  act(() => outside.focus())
  expect(screen.queryByRole('menu')).toBeNull()
  outside.remove()
})

test('an item chosen closes the menu', () => {
  openMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move to the left' }))
  expect(screen.queryByRole('menu')).toBeNull()
  expect(screen.getByTestId('annotant-panel').dataset['side']).toBe('left')
})
