import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import App from '../src/App'
import {
  MAC,
  ariaShortcut,
  onMac,
  readKeyboard,
  shortcutLabel,
  shortcutOf,
} from '../src/shortcuts'
import { comment, fakeServer, openPanel, openThread } from './server'
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
const opened = () => document.querySelector('.an-bubble--reader')?.textContent

/** The toasts saying `text`: an earlier test's may still be up. */
const toasted = (text: string) => screen.queryAllByText(text).length

/** Once the page's comments have loaded, the next shortcut toasts `text`. */
async function said(text: string) {
  const before = toasted(text)
  await waitFor(() => {
    press('ArrowDown')
    expect(toasted(text)).toBeGreaterThan(before)
  })
}

const hint = () => document.querySelector('.an-hint')?.textContent

test('the platform is a Mac by its user agent data, else by navigator.platform', () => {
  expect(onMac({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe(true)
  expect(onMac({ userAgentData: { platform: '' }, platform: 'MacIntel' })).toBe(true)
  expect(onMac({ platform: 'iPad' })).toBe(true)
  expect(onMac({ userAgentData: { platform: 'Windows' } })).toBe(false)
  expect(onMac({ platform: 'Linux x86_64' })).toBe(false)
  expect(onMac({})).toBe(false)
})

test("the shortcuts read with the platform's modifier", () => {
  expect(shortcutLabel('comment', { mac: true })).toBe('⌘⇧,')
  expect(shortcutLabel('comment', { mac: false })).toBe('Ctrl+Shift+,')
  expect(shortcutLabel('panel', { mac: true })).toBe('⌘⇧↩')
  expect(shortcutLabel('panel', { mac: false })).toBe('Ctrl+Shift+Enter')
  expect(shortcutLabel('next', { mac: false })).toBe('Ctrl+Shift+↓')
})

/** A French AZERTY keyboard, as the Keyboard Map API tells it. */
const AZERTY = new Map([
  ['Comma', ';'],
  ['Period', ':'],
  ['KeyM', ','],
])

/** A broken stand-in for the API. */
const broken = async () => {
  throw new TypeError('not a function')
}

/** The browser's answer in a frame not allowed the keyboard's map. */
const refused = async () => {
  throw new DOMException('Not allowed in a frame', 'SecurityError')
}

test("the labels name what the keys type on the reader's keyboard", () => {
  const keyboard = AZERTY
  expect(shortcutLabel('comment', { mac: true, keyboard })).toBe('⌘⇧;')
  expect(shortcutLabel('pick', { mac: false, keyboard })).toBe('Ctrl+Shift+:')
  expect(shortcutLabel('panel', { mac: true, keyboard })).toBe('⌘⇧↩')
  expect(ariaShortcut('comment', { mac: true, keyboard })).toBe('Meta+Shift+;')
  expect(ariaShortcut('next', { mac: false, keyboard })).toBe('Control+Shift+ArrowDown')
  // A letter reads as on the key, and goes to ARIA as typed: Dvorak's `w`.
  const dvorak = new Map([['Comma', 'w']])
  expect(shortcutLabel('comment', { mac: false, keyboard: dvorak })).toBe('Ctrl+Shift+W')
  expect(ariaShortcut('comment', { mac: false, keyboard: dvorak })).toBe(
    'Control+Shift+w',
  )
  // Unknown, a US keyboard's.
  expect(shortcutLabel('comment', { mac: true })).toBe('⌘⇧,')
})

test('the keyboard is read where the browser tells it, and only there', async () => {
  expect(await readKeyboard({ keyboard: { getLayoutMap: async () => AZERTY } })).toBe(
    AZERTY,
  )
  expect(await readKeyboard({})).toBeUndefined()
  expect(await readKeyboard({ keyboard: { getLayoutMap: refused } })).toBeUndefined()
  // A stand-in of the page's failing is no error in the page.
  expect(await readKeyboard({ keyboard: { getLayoutMap: broken } })).toBeUndefined()
})

test("the buttons name the keys as the reader's keyboard types them, once it is read", async () => {
  let tell: ((keyboard: Map<string, string>) => void) | undefined
  Object.defineProperty(navigator, 'keyboard', {
    configurable: true,
    value: {
      getLayoutMap: () =>
        new Promise<Map<string, string>>((resolve) => {
          tell = resolve
        }),
    },
  })
  onTestFinished(() => void Reflect.deleteProperty(navigator, 'keyboard'))
  fakeServer([])
  renderWidget()
  const button = await screen.findByRole('button', { name: 'Comment' })
  // The comments are in: nothing else draws the widget again.
  await said('No comments on this page')
  expect(button.title).toBe(`Comment on the page (${shortcutLabel('comment')})`)

  act(() => tell?.(AZERTY))

  await waitFor(() =>
    expect(button.title).toBe(`Comment on the page (${MAC ? '⌘⇧;' : 'Ctrl+Shift+;'})`),
  )
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
  // Composing text with an input method: the keys are its own.
  expect(
    shortcutOf(
      key({ code: 'Period', ctrlKey: true, shiftKey: true, isComposing: true }),
      false,
    ),
  ).toBe(undefined)
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
  const button = await screen.findByTestId('an-selection')
  expect(button.title).toBe(`Comment on the selected text (${shortcutLabel('comment')})`)

  press('Comma')

  await screen.findByRole('textbox', { name: 'What should change?' })
  expect(document.querySelector('.an-quote')?.textContent).toBe('Playground')
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

  // ? again hides it too.
  fireEvent.keyDown(title, { key: '?' })
  await screen.findByRole('region', { name: 'Keyboard shortcuts' })
  fireEvent.keyDown(title, { key: '?' })
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Keyboard shortcuts' })).toBeNull(),
  )
})

test("Escape in the message box hides the shortcuts' list first", async () => {
  fakeServer([])
  openPanel()
  renderWidget()
  const title = await screen.findByRole('heading', { name: 'Comments' })
  fireEvent.keyDown(title, { key: '?' })
  await screen.findByRole('region', { name: 'Keyboard shortcuts' })
  fireEvent.click(screen.getByRole('button', { name: 'New comment' }))
  const box = await screen.findByRole('textbox', { name: 'What should change?' })

  fireEvent.keyDown(box, { key: 'Escape' })

  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Keyboard shortcuts' })).toBeNull(),
  )
  expect(screen.getByRole('textbox', { name: 'What should change?' })).toBe(box)
})

test('Escape while pointing stops pointing, and only that', async () => {
  fakeServer([])
  openPanel()
  renderWidget()
  const title = await screen.findByRole('heading', { name: 'Comments' })
  fireEvent.keyDown(title, { key: '?' })
  await screen.findByRole('region', { name: 'Keyboard shortcuts' })
  press('Period', title)
  await waitFor(() => expect(hint()).toContain('Click an element to comment on it'))

  fireEvent.keyDown(title, { key: 'Escape' })

  await waitFor(() => expect(hint()).toBeUndefined())
  expect(screen.getByRole('region', { name: 'Keyboard shortcuts' })).toBeTruthy()
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

test('in the message box, the shortcut picks an element for the message', async () => {
  fakeServer([])
  openPanel()
  renderWidget()
  fireEvent.click(await screen.findByRole('button', { name: 'New comment' }))
  const box = await screen.findByRole('textbox', { name: 'What should change?' })

  expect(press('Period', box)).toBe(false)

  await waitFor(() =>
    expect(hint()).toBe('Click an element to add it to your message. Escape cancels.'),
  )
  expect(
    screen.getByRole('button', { name: 'Stop picking' }).getAttribute('aria-pressed'),
  ).toBe('true')

  // Again, it stops.
  press('Period', box)
  await waitFor(() => expect(hint()).toBeUndefined())
  expect(
    screen
      .getByRole('button', { name: 'Pick an element in the page' })
      .getAttribute('aria-pressed'),
  ).toBe('false')
})

test('in the message box, the shortcut closes the panel, and the comment one brings it back', async () => {
  fakeServer([])
  openPanel()
  renderWidget()
  fireEvent.click(await screen.findByRole('button', { name: 'New comment' }))
  const box = await screen.findByRole('textbox', { name: 'What should change?' })
  fireEvent.change(box, { target: { value: 'Bigger' } })

  expect(press('Enter', box)).toBe(false)

  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
  press('Comma')
  const again = await screen.findByRole<HTMLTextAreaElement>('textbox', {
    name: 'What should change?',
  })
  expect(again.value).toBe('Bigger')
})

test('from a comment being written, the next one shows it again', async () => {
  fakeServer([comment({ body: 'Older' })])
  renderWidget()
  await screen.findByRole('button', { name: 'Point at element' })
  press('Comma')
  const box = await screen.findByRole('textbox', { name: 'What should change?' })
  fireEvent.change(box, { target: { value: 'Bigger' } })
  press('Enter', box)
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())

  press('ArrowDown')

  const again = await screen.findByRole<HTMLTextAreaElement>('textbox', {
    name: 'What should change?',
  })
  expect(again.value).toBe('Bigger')
  expect(opened()).toBeUndefined()
})

test('a comment being written, shown again by the shortcut, stops a drawing', async () => {
  fakeServer([])
  renderWidget()
  await screen.findByRole('button', { name: 'Point at element' })
  press('Comma')
  const box = await screen.findByRole('textbox', { name: 'What should change?' })
  fireEvent.change(box, { target: { value: 'Bigger' } })
  press('Enter', box)
  fireEvent.click(await screen.findByRole('button', { name: 'Draw area' }))
  await screen.findByRole('button', { name: 'Cancel' })

  press('Comma')

  await waitFor(() =>
    expect(screen.getByTestId('annotant-panel').hasAttribute('inert')).toBe(false),
  )
  expect(screen.getByTestId('annotant-panel').dataset['drawing']).toBeUndefined()
})

test('? typed in the message box is a character, not the list', async () => {
  fakeServer([])
  openPanel()
  renderWidget()
  fireEvent.click(await screen.findByRole('button', { name: 'New comment' }))
  const box = await screen.findByRole('textbox', { name: 'What should change?' })

  expect(fireEvent.keyDown(box, { key: '?' })).toBe(true)

  expect(screen.queryByRole('region', { name: 'Keyboard shortcuts' })).toBeNull()
})

test('a shortcut held down acts once', async () => {
  fakeServer([])
  renderWidget()
  await screen.findByRole('button', { name: 'Point at element' })

  press('Period')
  fireEvent.keyDown(document.body, { code: 'Period', repeat: true, ...MOD })

  await waitFor(() => expect(hint()).toContain('Click an element to comment on it'))
})

test('from a new comment, the next comment is the newest', async () => {
  fakeServer([
    comment({ id: 'c1', body: 'Older', createdAt: '2026-01-01T10:00:00.000Z' }),
    comment({ id: 'c2', body: 'Newer', createdAt: '2026-01-02T10:00:00.000Z' }),
  ])
  openThread('c1')
  renderWidget()
  fireEvent.click(await screen.findByRole('button', { name: 'New comment' }))
  await screen.findByRole('textbox', { name: 'What should change?' })

  press('ArrowDown')

  await waitFor(() => expect(opened()).toBe('Newer'))
})

test("with no session watching, the shortcut says so, not that there's no comment", async () => {
  fakeServer([], { reachable: false })
  renderWidget()
  await screen.findByRole('button', { name: 'Point at element' })
  const before = toasted('No comments on this page')

  await said('No Claude session is watching. Run /annotant:annotant.')

  expect(toasted('No comments on this page')).toBe(before)
})

test('with no comment on the page, the shortcut says so', async () => {
  fakeServer([])
  renderWidget()
  await screen.findByRole('button', { name: 'Point at element' })

  await said('No comments on this page')
})

test('aria-keyshortcuts names the keys the ARIA way', () => {
  expect(ariaShortcut('pick', { mac: true })).toBe('Meta+Shift+.')
  expect(ariaShortcut('next', { mac: false })).toBe('Control+Shift+ArrowDown')
})

test('inside its shadow root, as on a page, the widget tells its own fields and buttons', async () => {
  fakeServer([])
  openPanel()
  const host = document.createElement('annotant-widget')
  host.setAttribute('data-annotant', '')
  document.body.append(host)
  const container = document.createElement('div')
  host.attachShadow({ mode: 'open' }).append(container)
  const page = document.createElement('main')
  page.innerHTML = '<h1>Playground</h1>'
  document.body.append(page)
  const view = render(<App root={page} />, { container })
  onTestFinished(() => {
    view.unmount()
    host.remove()
    page.remove()
  })
  const panel = within(container)
  fireEvent.click(await panel.findByRole('button', { name: 'New comment' }))
  const box = await panel.findByRole('textbox', { name: 'What should change?' })

  // The arrows select text in the message box; the pick shortcut picks for it.
  expect(press('ArrowDown', box)).toBe(true)
  expect(press('Period', box)).toBe(false)
  await waitFor(() => expect(container.querySelector('.an-hint')).toBeTruthy())
  // Enter on the button that stops picking is the button's.
  const stop = panel.getByRole('button', { name: 'Stop picking' })
  expect(fireEvent.keyDown(stop, { key: 'Enter' })).toBe(true)
})

test('with text selected, the shortcut still shows the comment being written', async () => {
  const scroll = vi
    .spyOn(Element.prototype, 'scrollIntoView')
    .mockImplementation(() => {})
  onTestFinished(() => scroll.mockRestore())
  document.body.replaceChildren()
  fakeServer([])
  renderWidget()
  await screen.findByRole('button', { name: 'Point at element' })
  press('Comma')
  const box = await screen.findByRole('textbox', { name: 'What should change?' })
  fireEvent.change(box, { target: { value: 'Bigger' } })
  press('Enter', box)
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
  const heading = document.querySelector('main h1')?.firstChild
  if (!heading) throw new Error('no title')
  const range = document.createRange()
  range.selectNodeContents(heading)
  getSelection()?.removeAllRanges()
  getSelection()?.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  await screen.findByTestId('an-selection')

  press('Comma')

  const again = await screen.findByRole<HTMLTextAreaElement>('textbox', {
    name: 'What should change?',
  })
  expect(again.value).toBe('Bigger')
  expect(document.querySelector('.an-quote')).toBeNull()
})

test('Escape in the message box picking for it stops picking, and keeps the comment', async () => {
  fakeServer([])
  openPanel()
  renderWidget()
  const title = await screen.findByRole('heading', { name: 'Comments' })
  fireEvent.keyDown(title, { key: '?' })
  fireEvent.click(await screen.findByRole('button', { name: 'New comment' }))
  const box = await screen.findByRole('textbox', { name: 'What should change?' })
  press('Period', box)
  await waitFor(() => expect(hint()).toContain('add it to your message'))

  fireEvent.keyDown(box, { key: 'Escape' })

  await waitFor(() => expect(hint()).toBeUndefined())
  expect(screen.getByRole('textbox', { name: 'What should change?' })).toBe(box)
  // The list of shortcuts goes after the picker.
  expect(screen.getByRole('region', { name: 'Keyboard shortcuts' })).toBeTruthy()
})

test('picking for the message being written stops a drawing', async () => {
  fakeServer([])
  openPanel()
  renderWidget()
  fireEvent.click(await screen.findByRole('button', { name: 'New comment' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Draw an area' }))
  const panel = screen.getByTestId('annotant-panel')
  await waitFor(() => expect(panel.hasAttribute('inert')).toBe(true))

  press('Period')

  await waitFor(() => expect(panel.hasAttribute('inert')).toBe(false))
  expect(panel.dataset['drawing']).toBeUndefined()
  expect(hint()).toContain('add it to your message')
})

test('from no comment open, the previous one is the oldest', async () => {
  fakeServer([
    comment({ id: 'c1', body: 'Older', createdAt: '2026-01-01T10:00:00.000Z' }),
    comment({ id: 'c2', body: 'Newer', createdAt: '2026-01-02T10:00:00.000Z' }),
  ])
  renderWidget()
  await screen.findByRole('button', { name: 'Point at element' })

  await waitFor(() => {
    press('ArrowUp')
    expect(opened()).toBe('Older')
  })
})
