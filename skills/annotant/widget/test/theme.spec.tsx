import { act, waitFor } from '@testing-library/react'
import { afterEach, expect, onTestFinished, test, vi } from 'vitest'
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
  document.body.removeAttribute('class')
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

test("switches with a class on body, Chakra's", async () => {
  fakeServer([], { theme: { on: 'body', attribute: 'class', dark: 'chakra-ui-dark' } })
  renderWidget()
  document.body.classList.add('chakra-ui-dark')
  await waitFor(() => expect(theme()).toBe('dark'))
  document.body.classList.remove('chakra-ui-dark')
  await waitFor(() => expect(theme()).toBe('light'))
})

test('stays dark for a dark-only app, whatever the page', async () => {
  fakeServer([], { theme: 'dark' })
  renderWidget()
  await waitFor(() => expect(theme()).toBe('dark'))
})

test("warns of a setting it cannot read, and picks the page's background", async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  fakeServer([], { theme: { on: 'root', attribute: 'class', dark: 'dark' } })
  document.body.style.backgroundColor = 'rgb(20, 20, 30)'
  renderWidget()
  await waitFor(() => expect(warn).toHaveBeenCalled())
  expect(theme()).toBe('dark')
  warn.mockRestore()
})

test('reads the background again once it has eased to its new colour', async () => {
  fakeServer([])
  renderWidget()
  await waitFor(() => expect(theme()).toBe('light'))

  // A colour that lands with no change of attribute, as at the end of a transition.
  const sheet = document.createElement('style')
  sheet.textContent = 'body { background-color: rgb(20, 20, 30); }'
  document.head.append(sheet)
  onTestFinished(() => sheet.remove())
  act(() => {
    document.body.dispatchEvent(new Event('transitionend', { bubbles: true }))
  })
  expect(theme()).toBe('dark')
})
