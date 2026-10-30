import { act, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { fakeServer } from './server'
import { renderWidget } from './widget'

/** The widget's palette, as its root says. */
const theme = () => document.querySelector('.an')?.getAttribute('data-theme')

/** The OS setting, switched by the test. */
function fakeOs(dark: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    get matches() {
      return dark
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }
  vi.stubGlobal('matchMedia', (media: string) =>
    media === '(prefers-color-scheme: dark)' ? query : { ...query, matches: false },
  )
  return {
    switch(to: boolean) {
      dark = to
      act(() => listeners.forEach((listener) => listener()))
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('class')
  document.documentElement.removeAttribute('data-theme')
  document.body.removeAttribute('style')
})

test("switches with the app's class, at once", async () => {
  fakeServer([], { theme: { on: 'html', attribute: 'class', dark: 'dark' } })
  renderWidget()
  await waitFor(() => expect(theme()).toBe('light'))

  document.documentElement.classList.add('dark')
  await waitFor(() => expect(theme()).toBe('dark'))
  document.documentElement.classList.remove('dark')
  await waitFor(() => expect(theme()).toBe('light'))
})

test('follows the OS for an app that does', async () => {
  // Dark from the start: the page's background, until the server answers, is light.
  const os = fakeOs(true)
  fakeServer([], { theme: 'media' })
  renderWidget()
  await waitFor(() => expect(theme()).toBe('dark'))

  os.switch(false)
  expect(theme()).toBe('light')
})

test("follows the OS until the app's attribute picks a theme", async () => {
  const os = fakeOs(true)
  fakeServer([], {
    theme: { on: 'html', attribute: 'data-theme', dark: 'dark', light: 'light' },
  })
  renderWidget()
  await waitFor(() => expect(theme()).toBe('dark'))

  document.documentElement.setAttribute('data-theme', 'light')
  await waitFor(() => expect(theme()).toBe('light'))
  os.switch(false)
  document.documentElement.setAttribute('data-theme', 'dark')
  await waitFor(() => expect(theme()).toBe('dark'))
})

test("without a setting, picks the page's background", async () => {
  fakeServer([])
  document.body.style.backgroundColor = 'rgb(20, 20, 30)'
  renderWidget()
  await waitFor(() => expect(theme()).toBe('dark'))

  document.body.style.backgroundColor = 'rgb(250, 250, 250)'
  await waitFor(() => expect(theme()).toBe('light'))
})
