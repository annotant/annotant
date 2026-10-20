import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { MAC, onMac, shortcutLabel, shortcutOf } from '../src/shortcuts'
import { comment, fakeServer, openPanel } from './server'
import { renderWidget } from './widget'

/** The platform's modifier and Shift, as a shortcut needs them. */
const MOD = MAC ? { metaKey: true, shiftKey: true } : { ctrlKey: true, shiftKey: true }

/** The reader presses `code` with the platform's modifier and Shift, on `target`. */
const press = (code: string, target: Element = document.body) =>
  fireEvent.keyDown(target, { code, key: code, ...MOD })

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init)

/** A handler of the page's that takes every key. */
const taken = (event: Event) => event.preventDefault()

/** The reader's message in the thread open. */
const opened = () => document.querySelector('.cb-bubble--reader')?.textContent

const hint = () => document.querySelector('.cb-hint')?.textContent

test('the platform is a Mac by its user agent data, else by navigator.platform', () => {
  expect(onMac({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe(true)
  expect(onMac({ userAgentData: { platform: '' }, platform: 'MacIntel' })).toBe(true)
  expect(onMac({ platform: 'iPad' })).toBe(true)
  expect(onMac({ userAgentData: { platform: 'Windows' } })).toBe(false)
  expect(onMac({ platform: 'Linux x86_64' })).toBe(false)
  expect(onMac({})).toBe(false)
})

test("the shortcuts read with the platform's modifier", () => {
  expect(shortcutLabel('comment', true)).toBe('⌘⇧,')
  expect(shortcutLabel('comment', false)).toBe('Ctrl+Shift+,')
  expect(shortcutLabel('panel', true)).toBe('⌘⇧↩')
  expect(shortcutLabel('panel', false)).toBe('Ctrl+Shift+Enter')
  expect(shortcutLabel('next', false)).toBe('Ctrl+Shift+↓')
})

test("a shortcut takes the platform's modifier and Shift, and nothing else", () => {
  expect(shortcutOf(key({ code: 'Period', metaKey: true, shiftKey: true }), true)).toBe(
    'pick',
  )
  expect(shortcutOf(key({ code: 'Period', ctrlKey: true, shiftKey: true }), false)).toBe(
    'pick',
  )
  // The other platform's modifier, both, or Alt on top: not a shortcut.
  expect(shortcutOf(key({ code: 'Period', ctrlKey: true, shiftKey: true }), true)).toBe(
    undefined,
  )
  expect(
    shortcutOf(
      key({ code: 'Period', ctrlKey: true, metaKey: true, shiftKey: true }),
      false,
    ),
  ).toBe(undefined)
  expect(
    shortcutOf(
      key({ code: 'Period', ctrlKey: true, altKey: true, shiftKey: true }),
      false,
    ),
  ).toBe(undefined)
  expect(shortcutOf(key({ code: 'Period', ctrlKey: true }), false)).toBe(undefined)
  // By where the key is, whatever it types: `;` on an AZERTY keyboard.
  expect(
    shortcutOf(key({ code: 'Comma', key: ';', ctrlKey: true, shiftKey: true }), false),
  ).toBe('comment')
  expect(
    shortcutOf(key({ code: 'NumpadEnter', ctrlKey: true, shiftKey: true }), false),
  ).toBe('panel')
})

test('the shortcut starts pointing at an element, and stops it', async () => {
  fakeServer([])
  renderWidget()
  await screen.findByRole('button', { name: 'Point at element' })

  press('Period')
  await waitFor(() => expect(hint()).toContain('Click an element to comment on it'))
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()

  press('Period')
  await waitFor(() => expect(hint()).toBeUndefined())
})

test('the shortcut opens the panel on its title, and closes it', async () => {
  fakeServer([])
  renderWidget()
  await screen.findByRole('button', { name: 'Point at element' })

  press('Enter')
  const title = await screen.findByRole('heading', { name: 'Comments' })
  await waitFor(() => expect(document.activeElement).toBe(title))

  press('Enter', title)
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'Comments' })).toBeNull(),
  )
})

test("the shortcuts leave the page's own fields alone", async () => {
  fakeServer([])
  renderWidget()
  await screen.findByRole('button', { name: 'Point at element' })
  const field = document.createElement('input')
  document.body.append(field)
  onTestFinished(() => field.remove())
  field.focus()

  const event = press('Period', field)

  expect(event).toBe(true)
  expect(hint()).toBeUndefined()
})

test("a shortcut the page took first is the page's", async () => {
  fakeServer([])
  renderWidget()
  await screen.findByRole('button', { name: 'Point at element' })
  document.body.addEventListener('keydown', taken)
  onTestFinished(() => document.body.removeEventListener('keydown', taken))

  press('Period')

  expect(hint()).toBeUndefined()
})

test('the shortcut starts a comment on the page, and keeps one being written', async () => {
  fakeServer([])
  renderWidget()
  await screen.findByRole('button', { name: 'Point at element' })

  press('Comma')
  const box = await screen.findByRole('textbox', { name: 'What should change?' })
  fireEvent.change(box, { target: { value: 'Bigger' } })
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())

  press('Comma')

  const again = await screen.findByRole<HTMLTextAreaElement>('textbox', {
    name: 'What should change?',
  })
  expect(again.value).toBe('Bigger')
})

test("the shortcut comments on the selected text, as the selection's button does", async () => {
  const scroll = vi
    .spyOn(Element.prototype, 'scrollIntoView')
    .mockImplementation(() => {})
  onTestFinished(() => scroll.mockRestore())
  document.body.replaceChildren()
  fakeServer([])
  renderWidget()
  const heading = document.querySelector('main h1')?.firstChild
  if (!heading) throw new Error('no title')
  const range = document.createRange()
  range.selectNodeContents(heading)
  getSelection()?.removeAllRanges()
  getSelection()?.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  const button = await screen.findByTestId('cb-selection')
  expect(button.title).toBe(`Comment on the selected text (${shortcutLabel('comment')})`)

  press('Comma')

  await screen.findByRole('textbox', { name: 'What should change?' })
  expect(document.querySelector('.cb-quote')?.textContent).toBe('Playground')
})

test("the shortcuts move through the page's comments, newest first, around", async () => {
  fakeServer([
    comment({ id: 'c1', body: 'Older', createdAt: '2026-01-01T10:00:00.000Z' }),
    comment({ id: 'c2', body: 'Newer', createdAt: '2026-01-02T10:00:00.000Z' }),
  ])
  renderWidget()
  await screen.findByRole('button', { name: 'Point at element' })

  press('ArrowDown')
  await waitFor(() => expect(opened()).toBe('Newer'))
  press('ArrowDown')
  await waitFor(() => expect(opened()).toBe('Older'))
  press('ArrowDown')
  await waitFor(() => expect(opened()).toBe('Newer'))
  press('ArrowUp')
  await waitFor(() => expect(opened()).toBe('Older'))
})

test('the arrows of the shortcuts are left to the message box', async () => {
  fakeServer([comment()])
  openPanel()
  renderWidget()
  fireEvent.click(await screen.findByRole('button', { name: 'New comment' }))
  const box = await screen.findByRole('textbox', { name: 'What should change?' })

  const event = press('ArrowDown', box)

  expect(event).toBe(true)
  expect(screen.getByRole('textbox', { name: 'What should change?' })).toBe(box)
})

test('? lists the shortcuts in the panel, and Escape hides the list first', async () => {
  fakeServer([])
  openPanel()
  renderWidget()
  const title = await screen.findByRole('heading', { name: 'Comments' })

  fireEvent.keyDown(title, { key: '?' })
  const list = await screen.findByRole('region', { name: 'Keyboard shortcuts' })
  expect(list.textContent).toContain(shortcutLabel('pick'))
  expect(list.textContent).toContain('Point at an element')

  fireEvent.keyDown(title, { key: 'Escape' })
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Keyboard shortcuts' })).toBeNull(),
  )
  expect(screen.getByRole('heading', { name: 'Comments' })).toBe(title)
})

test('the buttons say their shortcut', async () => {
  fakeServer([])
  renderWidget()

  expect((await screen.findByRole('button', { name: 'Point at element' })).title).toBe(
    `Point at an element (${shortcutLabel('pick')})`,
  )
  expect(screen.getByRole('button', { name: 'Comment' }).title).toBe(
    `Comment on the page (${shortcutLabel('comment')})`,
  )
})
