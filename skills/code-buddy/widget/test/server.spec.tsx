import { expect, test } from 'vitest'
import { serverOf } from '../src/server'

const BUNDLE = 'http://127.0.0.1:4599/widget.js'

test('takes the server the extension found', () => {
  expect(serverOf('http://127.0.0.1:4590/', BUNDLE)).toBe('http://127.0.0.1:4590/')
})

test('else the one next to its bundle, whatever else the page set', () => {
  for (const found of [
    undefined,
    42,
    'https://evil.example/',
    'http://127.0.0.1.evil.example:80/',
  ])
    expect(serverOf(found, BUNDLE)).toBe('http://127.0.0.1:4599/')
})
