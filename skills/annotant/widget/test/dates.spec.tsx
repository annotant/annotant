import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { DateTime, dateFormat } from '../src/ui'
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
})

test('the list and the thread show their dates in French when the reader prefers it', async () => {
  // The first date this file shows: the formatter is built on it.
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'en-US'])
  const createdAt = '2026-10-28T23:37:00.000Z'
  const french = new Date(createdAt).toLocaleString('fr-FR', options)
  fakeServer([comment({ createdAt })])

  openPanel()
  const list = renderWidget()
  expect((await screen.findByText(french)).tagName).toBe('TIME')
  list.unmount()

  openThread('c1')
  renderWidget()
  fireEvent.click(await screen.findByTestId('an-msg'))
  expect(screen.getByText(french).className).toBe('an-message-time')
})
