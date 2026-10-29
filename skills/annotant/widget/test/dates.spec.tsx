import { expect, test } from 'vitest'
import { dateFormat } from '../src/ui'

const at = new Date('2026-10-28T23:37:00')

test("dates follow the reader's preferred languages", () => {
  expect(dateFormat(['fr-FR', 'en-US']).format(at)).toBe('28/10/2026 23:37')
  expect(dateFormat(['en-US', 'fr-FR']).format(at)).toBe('10/28/26, 11:37 PM')
})

test('dates fall back to the default locale with no preferred languages', () => {
  expect(dateFormat([]).format(at)).toBe(
    at.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }),
  )
})
