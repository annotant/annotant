import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest'
import { comment, fakeServer, openPanel, openThread } from './server'
import { renderWidget } from './widget'

// The pages of earlier tests stay behind their widgets: the title is this one's.
beforeEach(() => document.body.replaceChildren())

/** What the widget POSTed last, as the server reads it. */
function posted(server: ReturnType<typeof fakeServer>): unknown {
  const call = server.fetch.mock.calls.findLast(([, init]) => init?.method === 'POST')
  const body = call?.[1]?.body
  return typeof body === 'string' ? JSON.parse(body) : undefined
}

/** Starts a comment on the page's title, as the reader would point at it. */
async function draftOnTitle() {
  const title = document.querySelector('main h1')
  if (!title) throw new Error('no title')
  const pointed = vi.spyOn(document, 'elementFromPoint').mockReturnValue(title)
  onTestFinished(() => pointed.mockRestore())
  fireEvent.click(await screen.findByRole('button', { name: 'Point at element' }))
  fireEvent.click(title, { clientX: 50, clientY: 20 })
  return screen.findByRole('textbox', { name: 'What should change?' })
}

test('a new comment asks for a change by default', async () => {
  const server = fakeServer([])
  renderWidget()
  const box = await draftOnTitle()
  expect(screen.getByRole('radio', { name: 'Change' }).getAttribute('aria-checked')).toBe(
    'true',
  )
  fireEvent.change(box, { target: { value: 'Bigger' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(posted(server)).toMatchObject({ capability: 'edit' }))
})

test('a new comment set to Ask only asks', async () => {
  const server = fakeServer([])
  renderWidget()
  const box = await draftOnTitle()
  fireEvent.click(screen.getByRole('radio', { name: 'Ask' }))
  fireEvent.change(box, { target: { value: 'Why is it this big?' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() =>
    expect(posted(server)).toMatchObject({
      body: 'Why is it this big?',
      capability: 'reply',
    }),
  )
})

test('a comment that only asks shows it on its card', async () => {
  fakeServer([
    comment({ body: 'Why grey?', capability: 'reply' }),
    comment({ id: 'c2', body: 'Make it red' }),
  ])
  openPanel()
  renderWidget()
  const [asked, changed] = await screen.findAllByTestId('cb-summary')
  expect(asked?.textContent).toContain('Ask')
  expect(changed?.textContent).not.toContain('Ask')
})

test('a follow-up keeps the comment Ask, or switches it to Change', async () => {
  const server = fakeServer([
    comment({
      capability: 'reply',
      state: 'resolved',
      messages: [
        { author: 'claude', body: 'It waits for the form.', at: '2026-01-01T10:01:00Z' },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()
  const box = await screen.findByPlaceholderText('Follow up, clarify, ask for a change…')
  expect(screen.getByRole('radio', { name: 'Ask' }).getAttribute('aria-checked')).toBe(
    'true',
  )
  fireEvent.click(screen.getByRole('radio', { name: 'Change' }))
  fireEvent.change(box, { target: { value: 'Say why next to it' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() =>
    expect(server.patches).toEqual([
      { id: 'c1', patch: { capability: 'edit', followUp: 'Say why next to it' } },
    ]),
  )
})

test('a follow-up left as it was sends no capability: the comment keeps its own', async () => {
  const server = fakeServer([
    comment({
      capability: 'reply',
      state: 'resolved',
      messages: [{ author: 'claude', body: 'It waits.', at: '2026-01-01T10:01:00Z' }],
    }),
  ])
  openThread('c1')
  renderWidget()
  const box = await screen.findByPlaceholderText('Follow up, clarify, ask for a change…')
  fireEvent.change(box, { target: { value: 'For what?' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() =>
    expect(server.patches).toEqual([{ id: 'c1', patch: { followUp: 'For what?' } }]),
  )
})

test('an option clicked alone goes with the capability switched for it', async () => {
  const server = fakeServer([
    comment({
      capability: 'reply',
      state: 'asking',
      messages: [
        {
          author: 'claude',
          body: 'Which colour?',
          at: '2026-01-01T10:01:00Z',
          question: true,
          options: [{ label: 'Red' }, { label: 'Blue' }],
        },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()
  await screen.findByPlaceholderText('Or answer in your own words…')
  fireEvent.click(screen.getByRole('radio', { name: 'Change' }))
  fireEvent.click(screen.getByRole('button', { name: /Blue/ }))
  await waitFor(() =>
    expect(server.patches).toEqual([
      { id: 'c1', patch: { capability: 'edit', choices: ['Blue'] } },
    ]),
  )
})
