import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest'
import { comment, fakeServer, openThread } from './server'
import { renderWidget } from './widget'

/** A PNG file's first bytes: the widget sends what it reads. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const TITLE = {
  selector: 'h1',
  tag: 'h1',
  text: 'Playground',
  html: '<h1>Playground</h1>',
  route: '/',
}

// The pages of earlier tests stay behind their widgets: the title is this one's.
beforeEach(() => document.body.replaceChildren())

const resolved = () =>
  comment({
    state: 'resolved',
    messages: [{ author: 'claude', body: 'Done.', at: '2026-01-01T10:01:00.000Z' }],
  })

/** The pointer points at the page's title, as the picker reads it. */
function pointAtTitle() {
  const title = document.querySelector('main h1')
  if (!title) throw new Error('no title')
  const pointed = vi.spyOn(document, 'elementFromPoint').mockReturnValue(title)
  onTestFinished(() => pointed.mockRestore())
  return title
}

test('an element picked in the page goes with the reply, the thread still open', async () => {
  const server = fakeServer([resolved()])
  openThread('c1')
  renderWidget()
  const box = await screen.findByPlaceholderText('Follow up, clarify, ask for a change…')
  const title = pointAtTitle()

  fireEvent.click(screen.getByRole('button', { name: 'Pick an element in the page' }))
  expect(screen.getByText(/Click an element to add it to your message/)).toBeTruthy()
  fireEvent.click(title, { clientX: 50, clientY: 20 })

  // Picked once: the picker stops, and the element waits above the text.
  expect(screen.queryByText(/Click an element to add it/)).toBeNull()
  expect(screen.getByTestId('code-buddy-panel')).toBeTruthy()
  expect(screen.getByTestId('cb-picked').textContent).toContain('Playground')

  fireEvent.change(box, { target: { value: 'Same size as this' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() =>
    expect(server.patches).toEqual([
      { id: 'c1', patch: { followUp: 'Same size as this', elements: [TITLE] } },
    ]),
  )
})

test('an element alone is a reply, and the reader may remove it before sending', async () => {
  const server = fakeServer([resolved()])
  openThread('c1')
  renderWidget()
  await screen.findByPlaceholderText('Follow up, clarify, ask for a change…')
  const title = pointAtTitle()
  const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Send' })
  expect(send.disabled).toBe(true)

  for (const _ of [1, 2]) {
    fireEvent.click(screen.getByRole('button', { name: 'Pick an element in the page' }))
    fireEvent.click(title, { clientX: 50, clientY: 20 })
  }
  // The same element twice is one.
  expect(screen.getAllByRole('button', { name: /Remove the element/ })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Remove the element <h1>' }))
  expect(screen.queryByTestId('cb-picked')).toBeNull()
  expect(send.disabled).toBe(true)

  fireEvent.click(screen.getByRole('button', { name: 'Pick an element in the page' }))
  fireEvent.click(title, { clientX: 50, clientY: 20 })
  expect(send.disabled).toBe(false)
  fireEvent.click(send)
  await waitFor(() =>
    expect(server.patches).toEqual([{ id: 'c1', patch: { elements: [TITLE] } }]),
  )
})

test('Escape stops picking, and leaves the page as it was', async () => {
  fakeServer([resolved()])
  openThread('c1')
  renderWidget()
  await screen.findByPlaceholderText('Follow up, clarify, ask for a change…')

  fireEvent.click(screen.getByRole('button', { name: 'Pick an element in the page' }))
  fireEvent.keyDown(document, { key: 'Escape' })

  await waitFor(() => expect(screen.queryByText(/Click an element to add it/)).toBeNull())
  expect(screen.queryByTestId('cb-picked')).toBeNull()
})

test("the reader's message shows its elements: a click scrolls to one", async () => {
  const scroll = vi
    .spyOn(Element.prototype, 'scrollIntoView')
    .mockImplementation(() => {})
  onTestFinished(() => scroll.mockRestore())
  fakeServer([
    comment({
      state: 'open',
      messages: [
        { author: 'claude', body: 'Done.', at: '2026-01-01T10:01:00.000Z' },
        {
          author: 'reader',
          body: 'This one too',
          at: '2026-01-01T10:02:00.000Z',
          elements: [TITLE],
        },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  const shown = await screen.findByTestId('cb-msg-elements')
  fireEvent.click(within(shown).getByRole('button', { name: /<h1>\s*Playground/ }))

  expect(scroll.mock.contexts).toContain(document.querySelector('main h1'))
})

/** Picks the page's title for the reply `times` times. */
function pickTitle(title: Element, times = 1) {
  for (let left = times; left > 0; left -= 1) {
    fireEvent.click(screen.getByRole('button', { name: 'Pick an element in the page' }))
    fireEvent.click(title, { clientX: 50, clientY: 20 })
  }
}

test('an image attached after an element keeps the element', async () => {
  const server = fakeServer([resolved()])
  openThread('c1')
  renderWidget()
  const box = await screen.findByPlaceholderText('Follow up, clarify, ask for a change…')
  pickTitle(pointAtTitle())

  fireEvent.paste(box, {
    clipboardData: {
      files: [new File([PNG], 'shot.png', { type: 'image/png' })],
      types: ['Files'],
    },
  })
  await screen.findByTestId('cb-attachments')
  expect(screen.getByTestId('cb-picked')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(server.patches[0]?.patch.elements).toEqual([TITLE]))
  expect(server.patches[0]?.patch.images).toHaveLength(1)
})

test('an element is recorded with the page it was picked on', async () => {
  history.pushState(null, '', '/other')
  onTestFinished(() => history.pushState(null, '', '/'))
  const server = fakeServer([resolved()])
  openThread('c1')
  renderWidget()
  await screen.findByPlaceholderText('Follow up, clarify, ask for a change…')
  pickTitle(pointAtTitle())

  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() =>
    expect(server.patches).toEqual([
      { id: 'c1', patch: { elements: [{ ...TITLE, route: '/other' }] } },
    ]),
  )
})

test('a message holds up to 5 elements', async () => {
  fakeServer([resolved()])
  openThread('c1')
  renderWidget()
  await screen.findByPlaceholderText('Follow up, clarify, ask for a change…')
  const page = document.querySelector('main')
  if (!page) throw new Error('no page')
  page.innerHTML = Array.from({ length: 6 }, (_, i) => `<p id="p${i}">P${i}</p>`).join('')
  const pointed = vi.spyOn(document, 'elementFromPoint')
  onTestFinished(() => pointed.mockRestore())
  for (const paragraph of page.querySelectorAll('p')) {
    pointed.mockReturnValue(paragraph)
    fireEvent.click(screen.getByRole('button', { name: 'Pick an element in the page' }))
    fireEvent.click(paragraph, { clientX: 5, clientY: 5 })
  }

  expect(screen.getAllByRole('button', { name: /Remove the element/ })).toHaveLength(5)
  expect(await screen.findByText('A message holds up to 5 elements.')).toBeTruthy()
})

test('a stopped reply of elements alone goes again without words', async () => {
  const server = fakeServer([
    comment({
      state: 'stopped',
      messages: [
        { author: 'claude', body: 'Done.', at: '2026-01-01T10:01:00.000Z' },
        { author: 'reader', body: '', at: '2026-01-01T10:02:00.000Z', elements: [TITLE] },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  fireEvent.click(await screen.findByRole('button', { name: 'Send again' }))
  await waitFor(() =>
    expect(server.patches).toEqual([{ id: 'c1', patch: { text: '', cancelled: false } }]),
  )
})

/** What the widget POSTed last, as the server reads it. */
function posted(server: ReturnType<typeof fakeServer>): unknown {
  const call = server.fetch.mock.calls.findLast(([, init]) => init?.method === 'POST')
  const body = call?.[1]?.body
  return typeof body === 'string' ? JSON.parse(body) : undefined
}

test('pointing at an element starts a comment whose message box holds it', async () => {
  const server = fakeServer([])
  renderWidget()
  const title = pointAtTitle()

  fireEvent.click(await screen.findByRole('button', { name: 'Point at element' }))
  fireEvent.click(title, { clientX: 50, clientY: 20 })

  // A comment about the page, as one started otherwise: the element is in the box.
  const box = await screen.findByRole('textbox', { name: 'What should change?' })
  expect(screen.getByTestId('cb-picked').textContent).toContain('Playground')
  expect(screen.getByRole('checkbox')).toBeTruthy()
  fireEvent.change(box, { target: { value: 'Bigger' } })
  fireEvent.keyDown(box, { key: 'Enter' })

  await waitFor(() =>
    expect(posted(server)).toMatchObject({
      anchor: { quote: '', section: '', occurrence: 0 },
      body: 'Bigger',
      elements: [TITLE],
    }),
  )
  expect(posted(server)).not.toHaveProperty('anchor.element')
  // Its first message shows the element, as a reply's would.
  expect((await screen.findByTestId('cb-msg-elements')).textContent).toContain(
    'Playground',
  )
})

test('a new comment picks elements in the page from its message box, and may hold them alone', async () => {
  const server = fakeServer([])
  renderWidget()
  fireEvent.click(await screen.findByRole('button', { name: 'Comment' }))
  await screen.findByRole('textbox', { name: 'What should change?' })
  const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' })
  expect(save.disabled).toBe(true)

  pickTitle(pointAtTitle(), 2)
  expect(screen.getAllByRole('button', { name: /Remove the element/ })).toHaveLength(1)
  expect(screen.getByTestId('code-buddy-panel')).toBeTruthy()

  fireEvent.click(save)
  await waitFor(() =>
    expect(posted(server)).toMatchObject({ body: '', elements: [TITLE] }),
  )
})

test('pointing at an element with a comment under way adds it to that comment', async () => {
  const server = fakeServer([])
  renderWidget()
  fireEvent.click(await screen.findByRole('button', { name: 'Comment' }))
  fireEvent.change(await screen.findByRole('textbox', { name: 'What should change?' }), {
    target: { value: 'Same size' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  const title = pointAtTitle()

  fireEvent.click(await screen.findByRole('button', { name: 'Point at element' }))
  fireEvent.click(title, { clientX: 50, clientY: 20 })

  const box = await screen.findByRole<HTMLTextAreaElement>('textbox', {
    name: 'What should change?',
  })
  expect(box.value).toBe('Same size')
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() =>
    expect(posted(server)).toMatchObject({ body: 'Same size', elements: [TITLE] }),
  )
})
