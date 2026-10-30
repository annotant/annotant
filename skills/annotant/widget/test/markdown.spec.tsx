import { screen, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { blocks } from '../src/markdown'
import { comment, fakeServer, openThread } from './server'
import { renderWidget } from './widget'

describe('blocks', () => {
  test('cuts paragraphs on blank lines, and keeps their line breaks', () => {
    expect(blocks('One\ntwo\n\nThree')).toEqual([
      { kind: 'paragraph', text: 'One\ntwo' },
      { kind: 'paragraph', text: 'Three' },
    ])
  })

  test('reads `-` and `1.` lists, a line after an item going on with it', () => {
    expect(blocks('Changed:\n- a\n  more\n- b\n\n3. c\n4. d')).toEqual([
      { kind: 'paragraph', text: 'Changed:' },
      { kind: 'list', ordered: false, start: 1, items: ['a\nmore', 'b'] },
      { kind: 'list', ordered: true, start: 3, items: ['c', 'd'] },
    ])
  })

  test('keeps a fenced block as written, up to its fence or the end', () => {
    expect(blocks('```ts\nconst a = 1\n\n- not a list\n```\nAfter\n```\nopen')).toEqual([
      { kind: 'code', text: 'const a = 1\n\n- not a list' },
      { kind: 'paragraph', text: 'After' },
      { kind: 'code', text: 'open' },
    ])
  })

  test('leaves headings and tables as text', () => {
    expect(blocks('# Title\n| a | b |')).toEqual([
      { kind: 'paragraph', text: '# Title\n| a | b |' },
    ])
  })
})

/** The thread of one comment Claude answered with `body`, on GitHub. */
function answered(body: string) {
  fakeServer(
    [
      comment({
        state: 'answered',
        messages: [
          { author: 'reader', body: 'Make it `bigger`', at: '2026-01-01T10:00:00.000Z' },
          { author: 'claude', body, at: '2026-01-01T10:01:00.000Z' },
        ],
      }),
    ],
    { repository: { kind: 'github', url: 'https://github.com/acme/shop' } },
  )
  openThread('c1')
  renderWidget()
}

/** Claude's bubble, once shown. */
function claudeBubble() {
  return waitFor(() => {
    const bubble = document.querySelector('.an-bubble--claude')
    if (!bubble) throw new Error('No answer from Claude yet')
    return bubble
  })
}

test("formats Claude's answer", async () => {
  answered(
    [
      'Set `src/Hero.tsx` to **160px**, *as asked* (#12):',
      '- the title',
      '- the [docs](https://example.com/docs)',
      '',
      '```',
      'h1 { font-size: 160px }',
      '```',
    ].join('\n'),
  )
  const bubble = await claudeBubble()

  expect(bubble.querySelector('p code')?.textContent).toBe('src/Hero.tsx')
  expect(bubble.querySelector('strong')?.textContent).toBe('160px')
  expect(bubble.querySelector('em')?.textContent).toBe('as asked')
  expect([...bubble.querySelectorAll('ul li')].map((item) => item.textContent)).toEqual([
    'the title',
    'the docs',
  ])
  expect(bubble.querySelector('pre code')?.textContent).toBe('h1 { font-size: 160px }')
  const docs = screen.getByRole('link', { name: 'docs' })
  expect(docs.getAttribute('href')).toBe('https://example.com/docs')
  expect(docs.getAttribute('target')).toBe('_blank')
  expect(docs.getAttribute('rel')).toBe('noopener noreferrer')
  // The issues of #249 are still linked.
  expect(screen.getByRole('link', { name: '#12' }).getAttribute('href')).toBe(
    'https://github.com/acme/shop/issues/12',
  )
  // The reader's own message stays as typed.
  const reader = [...document.querySelectorAll('.an-bubble--reader')].map(
    (it) => it.textContent,
  )
  expect(reader).toContain('Make it `bigger`')
})

test('shows markup, images and headings as their text', async () => {
  const body =
    '# Done\n<script>alert(1)</script> <img src="x" onerror="alert(1)"> ![logo](logo.png)'
  answered(body)
  const bubble = await claudeBubble()

  expect(bubble.textContent).toBe(body)
  expect(bubble.querySelector('script, img, h1')).toBeNull()
})

test('links only http(s) addresses', async () => {
  answered('[a](javascript:alert) [b](data:text/html,x) [c](http://example.com)')
  const bubble = await claudeBubble()

  expect(
    [...bubble.querySelectorAll('a')].map((link) => link.getAttribute('href')),
  ).toEqual(['http://example.com'])
  expect(bubble.textContent).toBe('[a](javascript:alert) [b](data:text/html,x) c')
})

test("formats Claude's question", async () => {
  fakeServer([
    comment({
      state: 'asking',
      messages: [
        {
          author: 'claude',
          body: 'Rename `Hero`?',
          question: true,
          options: [{ label: 'Yes' }, { label: 'No' }],
          at: '2026-01-01T10:01:00.000Z',
        },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  await waitFor(() =>
    expect(document.querySelector('.an-ask code')?.textContent).toBe('Hero'),
  )
})
