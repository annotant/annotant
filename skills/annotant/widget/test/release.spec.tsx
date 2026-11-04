import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { isNewer } from '../src/api'
import { fakeServer, openPanel } from './server'
import { renderWidget } from './widget'

// The tests' widget is 0.0.0-test (vitest.config.ts).
const RELEASE = {
  version: '0.6.0',
  url: 'https://github.com/annotant/annotant/releases/tag/v0.6.0',
}

const menuButton = () => screen.getByRole('button', { name: 'More actions' })
const dot = () => document.querySelector('.an-menu-dot')

function showPanel(release?: unknown) {
  fakeServer([], { release })
  openPanel()
  renderWidget()
}

test('compares versions part by part', () => {
  expect(isNewer('0.6.0', '0.5.9')).toBe(true)
  expect(isNewer('0.10.0', '0.9.0')).toBe(true)
  expect(isNewer('1.0.0', '0.99.99')).toBe(true)
  expect(isNewer('0.5.0', '0.5.0')).toBe(false)
  expect(isNewer('0.4.2', '0.5.0')).toBe(false)
})

test("a newer release: a dot on the menu's button, and an item that opens its notes", async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  showPanel(RELEASE)
  await waitFor(() => expect(dot()).toBeTruthy())
  expect(menuButton().getAttribute('aria-description')).toBe('Annotant 0.6.0 is out')

  fireEvent.click(menuButton())
  const item = screen.getByRole('menuitem', { name: /Annotant 0\.6\.0 is out/ })
  expect(item.textContent).toContain('claude plugin marketplace update annotant')
  // Seen: the dot goes once the menu opens.
  expect(dot()).toBeNull()

  fireEvent.click(item)
  expect(open).toHaveBeenCalledWith(RELEASE.url, '_blank', 'noopener')
})

test('the dot, once seen, stays gone for that version; the item stays', async () => {
  showPanel(RELEASE)
  await waitFor(() => expect(dot()).toBeTruthy())
  fireEvent.click(menuButton())
  cleanup()

  showPanel(RELEASE)
  fireEvent.click(menuButton())
  await screen.findByRole('menuitem', { name: /Annotant 0\.6\.0 is out/ })
  expect(dot()).toBeNull()
})

test.each([
  ['the same version', { version: '0.0.0', url: RELEASE.url }],
  ['an older server', undefined],
  ['notes elsewhere', { version: '0.6.0', url: 'https://evil.example/' }],
  ['no version', { version: 'latest', url: RELEASE.url }],
])('nothing for %s', async (_, release) => {
  showPanel(release)
  // Time for the answer to arrive, and be refused.
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
  fireEvent.click(menuButton())
  expect(screen.queryByRole('menuitem', { name: /is out/ })).toBeNull()
  expect(dot()).toBeNull()
})
