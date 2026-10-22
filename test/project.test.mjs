import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appOrigins } from '../skills/code-buddy/scripts/lib/project.mjs'

test("lists the dev app's origins: devUrl's, then devOrigins", () => {
  assert.deepEqual(
    appOrigins({
      devUrl: 'http://localhost:5173/app/',
      devOrigins: ['https://web.test'],
    }),
    ['http://localhost:5173', 'https://web.test'],
  )
  assert.deepEqual(appOrigins({}), [])
})

test('skips a devUrl with no origin instead of failing', () => {
  for (const devUrl of ['3000', 'localhost:3000', ''])
    assert.deepEqual(appOrigins({ devUrl, devOrigins: ['http://app.localhost'] }), [
      'http://app.localhost',
    ])
})
