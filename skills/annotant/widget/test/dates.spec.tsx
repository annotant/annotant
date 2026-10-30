import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, onTestFinished, test, vi } from 'vitest'
import { DateTime, dateFormat, relativeDate } from '../src/ui'
import { comment, fakeServer, openPanel, openThread } from './server'
import { renderWidget } from './widget'

const options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' }
const at = new Date('2026-10-28T23:37:00')

test("dates follow the reader's preferred languages", () => {
  expect(dateFormat(['fr-FR', 'en-US']).format(at)).toBe('28/10/2026 23:37')
  expect(dateFormat(['en-US', 'fr-FR']).format(at)).toBe(
    at.toLocaleString('en-US', options),
  )
})

test('dates fall back to the default locale with no languages, or none Intl takes', () => {
  const today = at.toLocaleString(undefined, options)
  expect(dateFormat([]).format(at)).toBe(today)
  expect(dateFormat(undefined).format(at)).toBe(today)
  expect(dateFormat(['en_US']).format(at)).toBe(today)
})

test('a date that does not parse shows as it is written', () => {
  render(<DateTime at="yesterday" />)
  expect(screen.getByText('yesterday').tagName).toBe('TIME')
  render(<DateTime at="last week" now={Date.now()} />)
  expect(screen.getByText('last week').tagName).toBe('TIME')
})

test('a relative date goes from now to minutes, hours, yesterday, days, then the date alone', () => {
  const now = at.getTime()
  const ago = (ms: number) => relativeDate(new Date(now - ms), now, ['en-US'])
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  expect(ago(-5 * minute)).toBe('now')
  expect(ago(0)).toBe('now')
  expect(ago(minute - 1)).toBe('now')
  expect(ago(minute)).toBe('1 min. ago')
  expect(ago(6 * minute - 1)).toBe('5 min. ago')
  expect(ago(hour - 1)).toBe('59 min. ago')
  expect(ago(hour)).toBe('1 hr. ago')
  expect(ago(day - 1)).toBe('23 hr. ago')
  expect(ago(day)).toBe('yesterday')
  expect(ago(2 * day)).toBe('2 days ago')
  expect(ago(7 * day - 1)).toBe('6 days ago')
  expect(ago(7 * day)).toBe(
    new Date(now - 7 * day).toLocaleDateString('en-US', { dateStyle: 'short' }),
  )
  expect(relativeDate(new Date(now - 5 * minute), now, ['fr-FR'])).toBe(
    'il y a 5\u00a0min',
  )
  expect(relativeDate(new Date(now - day), now, ['fr-FR'])).toBe('hier')
  expect(relativeDate(new Date(now - 8 * day), now, ['fr-FR'])).toBe(
    new Date(now - 8 * day).toLocaleDateString('fr-FR', { dateStyle: 'short' }),
  )
  // A list Intl rejects → the default locale, as for the full date.
  expect(relativeDate(new Date(now - 5 * minute), now, ['en_US'])).toBe(
    relativeDate(new Date(now - 5 * minute), now, []),
  )
})

test('the list and the thread show their dates in French when the reader prefers it', async () => {
  // The first date this file shows: the formatter is built on it.
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'en-US'])
  // Older than a week: the card shows the date alone.
  const createdAt = '2020-10-28T12:37:00.000Z'
  const french = new Date(createdAt).toLocaleString('fr-FR', options)
  fakeServer([comment({ createdAt })])

  openPanel()
  const list = renderWidget()
  const card = await screen.findByText(
    new Date(createdAt).toLocaleDateString('fr-FR', { dateStyle: 'short' }),
  )
  expect(card.tagName).toBe('TIME')
  expect(card.title).toBe(french)
  list.unmount()

  openThread('c1')
  renderWidget()
  fireEvent.click(await screen.findByTestId('an-msg'))
  expect(screen.getByText(french).className).toBe('an-message-time')
})

test('a card shows how long ago its comment was made, moving on while the panel is open', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'en-US'])
  const createdAt = new Date(Date.now() - 5 * 60_000 - 1000).toISOString()
  fakeServer([comment({ createdAt })])

  openPanel()
  renderWidget()
  const time = await screen.findByText(/^il y a 5\smin$/)
  expect(time.tagName).toBe('TIME')
  expect(time.getAttribute('dateTime')).toBe(createdAt)
  expect(time.title).toBe(dateFormat(['fr-FR']).format(new Date(createdAt)))

  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  expect(time.textContent).toBe('il y a 6\u00a0min')
})

test('a card shows the time gone by while the panel was closed as soon as it opens again', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'en-US'])
  fakeServer([comment({ createdAt: new Date(Date.now() - 5 * 60_000).toISOString() })])
  openPanel()
  renderWidget()
  await screen.findByText(/^il y a 5\smin$/)

  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60 * 60_000)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Comments' }))
  fireEvent.keyDown(screen.getByPlaceholderText('What should change?'), { key: 'Escape' })
  expect((await screen.findByText(/^il y a 1\sh$/)).tagName).toBe('TIME')
})
