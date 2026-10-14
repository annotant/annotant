import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'
import { comment, fakeServer, openPanel, openThread } from './server'
import { renderWidget } from './widget'

/** A PNG file's first bytes: the widget sends what it reads. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_BASE64 = 'iVBORw0KGgo='

const png = (name = 'shot.png') => new File([PNG], name, { type: 'image/png' })
const gif = new File(['GIF89a'], 'b.gif', { type: 'image/gif' })

/** Pastes `files` in `box`, as Cmd+V or Ctrl+V does with an image copied. */
function paste(box: HTMLElement, files: File[]) {
  return fireEvent.paste(box, { clipboardData: { files, types: ['Files'] } })
}

/** What the widget POSTed or PATCHed last, as the server reads it. */
function sent(server: ReturnType<typeof fakeServer>, method: string): unknown {
  const call = server.fetch.mock.calls.findLast(([, init]) => init?.method === method)
  const body = call?.[1]?.body
  return typeof body === 'string' ? JSON.parse(body) : undefined
}

async function newComment() {
  renderWidget()
  fireEvent.click(await screen.findByRole('button', { name: 'Comment' }))
  return screen.getByRole('textbox', { name: 'What should change?' })
}

test('an image pasted in a new comment shows as a thumbnail, and goes with it', async () => {
  const server = fakeServer([])
  const box = await newComment()

  expect(paste(box, [png()])).toBe(false)
  const thumbnail = await screen.findByRole<HTMLImageElement>('img', {
    name: 'Attached image 1',
  })
  expect(thumbnail.src).toBe(`data:image/png;base64,${PNG_BASE64}`)

  fireEvent.change(box, { target: { value: 'Like this' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() =>
    expect(sent(server, 'POST')).toMatchObject({
      body: 'Like this',
      images: [{ type: 'image/png', data: PNG_BASE64 }],
    }),
  )
})

test('an image dropped in the box is attached, and can be removed before sending', async () => {
  const server = fakeServer([])
  const box = await newComment()
  const form = box.closest('form')
  if (!form) throw new Error('no form')

  fireEvent.drop(form, {
    dataTransfer: { files: [png('a.png'), gif], types: ['Files'] },
  })
  await screen.findByRole('img', { name: 'Attached image 2' })
  fireEvent.click(screen.getByRole('button', { name: 'Remove image 1' }))
  await waitFor(() =>
    expect(screen.queryByRole('img', { name: 'Attached image 2' })).toBeNull(),
  )

  fireEvent.change(box, { target: { value: 'Only one' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() =>
    expect(sent(server, 'POST')).toMatchObject({
      images: [{ type: 'image/gif', data: 'R0lGODlh' }],
    }),
  )
})

test('pastes in quick succession count each other against the limit', async () => {
  fakeServer([])
  const box = await newComment()
  paste(box, [png(), png(), png()])
  await screen.findByRole('img', { name: 'Attached image 3' })
  // Both before either is read: the second finds no room.
  paste(box, [png()])
  paste(box, [png()])
  expect(await screen.findByText('At most 4 images per message.')).toBeTruthy()
  await screen.findByRole('img', { name: 'Attached image 4' })
})

test("the server's refusal of an image shows in its words", async () => {
  const server = fakeServer([])
  const serve = server.fetch.getMockImplementation()
  server.fetch.mockImplementation(async (input: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? Response.json({ error: 'not a image/png image' }, { status: 422 })
      : (serve?.(input, init) ?? Response.json([])),
  )
  const box = await newComment()
  paste(box, [png()])
  await screen.findByRole('img', { name: 'Attached image 1' })
  fireEvent.change(box, { target: { value: 'Like this' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  expect(await screen.findByText('not a image/png image')).toBeTruthy()
})

test('a paste with no image is left to the text box', async () => {
  fakeServer([])
  const box = await newComment()
  expect(paste(box, [])).toBe(true)
  expect(screen.queryByTestId('cb-attachments')).toBeNull()
})

test('an image the server would not take is refused, saying why', async () => {
  fakeServer([])
  const box = await newComment()
  paste(box, [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })])
  expect(
    await screen.findByText('Only PNG, JPEG, GIF and WebP images can be attached.'),
  ).toBeTruthy()
  expect(screen.queryByTestId('cb-attachments')).toBeNull()
})

test("the reader's images show in their bubble, and go with a follow-up", async () => {
  const server = fakeServer([
    comment({
      state: 'resolved',
      messages: [
        { author: 'claude', body: 'Done.', at: '2026-01-01T10:01:00.000Z', run: 'r1' },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()
  const box = await screen.findByPlaceholderText('Follow up, clarify, ask for a change…')

  paste(box, [png()])
  await screen.findByRole('img', { name: 'Attached image 1' })
  fireEvent.change(box, { target: { value: 'More like this' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() =>
    expect(server.patches).toEqual([
      {
        id: 'c1',
        patch: {
          followUp: 'More like this',
          images: [{ type: 'image/png', data: PNG_BASE64 }],
        },
      },
    ]),
  )
  expect(screen.queryByTestId('cb-attachments')).toBeNull()
})

test('an image filed with a message shows in its bubble, from the server', async () => {
  const filed = comment()
  filed.messages = filed.messages.map((message) => ({ ...message, images: ['m1-1.png'] }))
  fakeServer([filed])
  openThread('c1')
  renderWidget()

  const image = await screen.findByRole<HTMLImageElement>('img', {
    name: 'Attached image 1',
  })
  expect(image.src).toMatch(/\/api\/images\/c1\/m1-1\.png$/)
  expect(image.closest('a')?.getAttribute('target')).toBe('_blank')
})

test('an image alone is a new comment', async () => {
  const server = fakeServer([])
  const box = await newComment()
  const save = screen.getByRole('button', { name: 'Save' })
  expect(save).toHaveProperty('disabled', true)
  paste(box, [png()])
  await screen.findByRole('img', { name: 'Attached image 1' })
  expect(save).toHaveProperty('disabled', false)
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() =>
    expect(sent(server, 'POST')).toMatchObject({
      body: '',
      images: [{ type: 'image/png', data: PNG_BASE64 }],
    }),
  )
})

test('a follow-up of an image alone sends the image only', async () => {
  const server = fakeServer([
    comment({
      state: 'resolved',
      messages: [
        { author: 'claude', body: 'Done.', at: '2026-01-01T10:01:00.000Z', run: 'r1' },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()
  const box = await screen.findByPlaceholderText('Follow up, clarify, ask for a change…')
  paste(box, [png()])
  await screen.findByRole('img', { name: 'Attached image 1' })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() =>
    expect(server.patches).toEqual([
      { id: 'c1', patch: { images: [{ type: 'image/png', data: PNG_BASE64 }] } },
    ]),
  )
})

test('a comment of an image alone reads as one, with no empty bubble', async () => {
  const filed = comment()
  filed.messages = filed.messages.map((message) => ({
    ...message,
    body: '',
    images: ['m1-1.png', 'm1-2.png'],
  }))
  fakeServer([filed])
  openPanel()
  renderWidget()
  const summary = await screen.findByTestId('cb-summary')
  expect(summary.textContent).toContain('2 images')

  fireEvent.click(summary)
  await screen.findByRole('img', { name: 'Attached image 2' })
  expect(document.querySelector('.cb-bubble--reader')).toBeNull()
})
