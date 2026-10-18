import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { ReviewMessage } from '../src/domain'
import { comment, fakeEvents, fakeServer, openThread } from './server'
import { renderWidget } from './widget'

type Message = Omit<ReviewMessage, 'id'>

const question = (fields: Partial<Message> = {}): Message => ({
  author: 'claude',
  body: 'Which colour?',
  at: '2026-01-01T10:01:00.000Z',
  question: true,
  options: [{ label: 'Red' }, { label: 'Blue', description: 'Calmer' }],
  ...fields,
})

// The question's own button; the composer's below is labelled "Send" too.
const SEND_CHOICES = { selector: '.cb-ask button' }
const sendChoices = () => screen.getByText('Send', SEND_CHOICES)

/** Claude waits on the reader's answer to `asked`. */
const asking = (asked: Message) => comment({ state: 'asking', messages: [asked] })

test('a single choice answers at once, without the draft in the box', async () => {
  const server = fakeServer([asking(question())])
  openThread('c1')
  renderWidget()

  const box = await screen.findByPlaceholderText('Or answer in your own words…')
  fireEvent.change(box, { target: { value: 'still writing' } })
  fireEvent.click(screen.getByRole('button', { name: /Blue/ }))

  await waitFor(() =>
    expect(server.patches).toEqual([{ id: 'c1', patch: { choices: ['Blue'] } }]),
  )
  expect(box).toHaveProperty('value', 'still writing')
})

test('a multiple choice ticks the options, then sends them', async () => {
  const server = fakeServer([asking(question({ multiple: true }))])
  openThread('c1')
  renderWidget()

  const red = await screen.findByRole('checkbox', { name: /Red/ })
  const blue = screen.getByRole('checkbox', { name: /Blue/ })
  const send = sendChoices()
  expect(send).toHaveProperty('disabled', true)

  fireEvent.click(red)
  fireEvent.click(blue)
  fireEvent.click(red)
  expect(red.getAttribute('aria-checked')).toBe('false')
  expect(blue.getAttribute('aria-checked')).toBe('true')
  expect(server.patches).toEqual([])

  fireEvent.click(send)
  await waitFor(() =>
    expect(server.patches).toEqual([{ id: 'c1', patch: { choices: ['Blue'] } }]),
  )
})

test('two quick clicks tick both options', async () => {
  fakeServer([asking(question({ multiple: true }))])
  openThread('c1')
  renderWidget()

  const red = await screen.findByRole('checkbox', { name: /Red/ })
  const blue = screen.getByRole('checkbox', { name: /Blue/ })
  // Both before React renders again, as two clicks in a row can land.
  act(() => {
    red.click()
    blue.click()
  })
  expect(red.getAttribute('aria-checked')).toBe('true')
  expect(blue.getAttribute('aria-checked')).toBe('true')
})

test('the typed text goes with the ticked options', async () => {
  const server = fakeServer([asking(question({ multiple: true }))])
  openThread('c1')
  renderWidget()

  fireEvent.click(await screen.findByRole('checkbox', { name: /Red/ }))
  const box = screen.getByPlaceholderText('Or answer in your own words…')
  fireEvent.change(box, { target: { value: '  and a darker shade  ' } })
  fireEvent.click(sendChoices())

  await waitFor(() =>
    expect(server.patches).toEqual([
      { id: 'c1', patch: { choices: ['Red'], followUp: 'and a darker shade' } },
    ]),
  )
  await waitFor(() => expect(box).toHaveProperty('value', ''))
})

test('the composer sends the ticked options with its text', async () => {
  const server = fakeServer([asking(question({ multiple: true }))])
  openThread('c1')
  renderWidget()

  fireEvent.click(await screen.findByRole('checkbox', { name: /Blue/ }))
  const box = screen.getByPlaceholderText('Or answer in your own words…')
  fireEvent.change(box, { target: { value: 'please' } })
  fireEvent.keyDown(box, { key: 'Enter' })

  await waitFor(() =>
    expect(server.patches).toEqual([
      { id: 'c1', patch: { choices: ['Blue'], followUp: 'please' } },
    ]),
  )
})

test('the chosen options stay marked once answered', async () => {
  const asked = question({ multiple: true })
  fakeServer([
    comment({
      state: 'resolved',
      messages: [
        asked,
        {
          author: 'reader',
          body: 'Red, Blue',
          at: '2026-01-01T10:02:00.000Z',
          choices: ['Blue'],
        },
        { author: 'claude', body: 'Done.', at: '2026-01-01T10:03:00.000Z' },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  const red = await screen.findByRole('checkbox', { name: /Red/ })
  const blue = screen.getByRole('checkbox', { name: /Blue/ })
  expect(red.getAttribute('aria-checked')).toBe('false')
  expect(blue.getAttribute('aria-checked')).toBe('true')
  expect(red).toHaveProperty('disabled', true)
  expect(blue).toHaveProperty('disabled', true)
  expect(screen.queryByText('Send', SEND_CHOICES)).toBeNull()
})

test('the chosen single answer stays marked once answered', async () => {
  fakeServer([
    comment({
      state: 'resolved',
      messages: [
        question(),
        {
          author: 'reader',
          body: 'Red',
          at: '2026-01-01T10:02:00.000Z',
          choices: ['Red'],
        },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  const red = await screen.findByRole('button', { name: /Red/ })
  const blue = screen.getByRole('button', { name: /Blue/ })
  expect(red.className).toContain('cb-option--on')
  expect(blue.className).not.toContain('cb-option--on')
  expect(red).toHaveProperty('disabled', true)
})

test('the answer shows at once, before the slow reload lands', async () => {
  const asked = question()
  const answeredWith = comment({
    messages: [asked, { author: 'reader', body: 'Red', at: asked.at }],
  })
  const server = fakeServer([asking(asked)])
  // The server takes the answer; its lists, slow, come back after the test.
  const served = server.fetch.getMockImplementation()
  server.fetch.mockImplementation(async (input: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      await served?.(input, init)
      return Response.json(answeredWith)
    }
    if (server.patches.length) return new Promise<Response>(() => undefined)
    return served ? served(input, init) : Response.error()
  })
  openThread('c1')
  renderWidget()

  fireEvent.click(await screen.findByRole('button', { name: /Red/ }))

  expect((await screen.findByTestId('cb-working')).textContent).toBe('Sent…')
  // Answered: no second answer goes out while the reload is on its way.
  fireEvent.click(screen.getByRole('button', { name: /Blue/ }))
  expect(server.patches).toHaveLength(1)
})

test('a reload asked for before the answer does not bring the question back', async () => {
  const events = fakeEvents()
  const asked = question()
  const before = asking(asked)
  const after = comment({
    messages: [asked, { author: 'reader', body: 'Red', at: asked.at }],
  })
  const server = fakeServer([before])
  const served = server.fetch.getMockImplementation()
  // The reload asked for before the answer, held until the answer is in.
  let release: (() => void) | undefined
  server.fetch.mockImplementation(async (input: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      await served?.(input, init)
      return Response.json(after)
    }
    if (server.patches.length) return new Promise<Response>(() => undefined)
    if (screen.queryByRole('button', { name: /Red/ }) && !release) {
      return new Promise<Response>((resolve) => {
        release = () => resolve(Response.json([before]))
      })
    }
    return served ? served(input, init) : Response.error()
  })
  openThread('c1')
  renderWidget()

  const red = await screen.findByRole('button', { name: /Red/ })
  events.send('changed')
  await waitFor(() => expect(release).toBeDefined())
  fireEvent.click(red)
  expect((await screen.findByTestId('cb-working')).textContent).toBe('Sent…')
  await act(async () => {
    release?.()
    await Promise.resolve()
  })

  expect(screen.getByTestId('cb-working').textContent).toBe('Sent…')
  expect(screen.getByRole('button', { name: /Blue/ })).toHaveProperty('disabled', true)
})

test('the options ticked for a question do not carry over to the next one', async () => {
  const events = fakeEvents()
  const asked = question({ multiple: true })
  const comments = [asking(asked)]
  fakeServer(comments)
  openThread('c1')
  renderWidget()

  fireEvent.click(await screen.findByRole('checkbox', { name: /Red/ }))
  // Resolved without an answer, then followed up from another tab: Claude asks again.
  comments[0] = comment({
    state: 'asking',
    messages: [
      asked,
      { author: 'reader', body: 'Later, then.', at: '2026-01-01T10:02:00.000Z' },
      question({ multiple: true, body: 'Which shade?', at: '2026-01-01T10:03:00.000Z' }),
    ],
  })
  events.send('changed')

  await screen.findByText('Which shade?')
  const red = screen
    .getAllByRole('checkbox', { name: /Red/ })
    .find((box) => !box.hasAttribute('disabled'))
  expect(red?.getAttribute('aria-checked')).toBe('false')
  expect(sendChoices()).toHaveProperty('disabled', true)
})
