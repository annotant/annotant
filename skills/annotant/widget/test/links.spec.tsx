import { screen, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { type Repository, parseRepository, tokenize } from '../src/links'
import { comment, fakeServer, openThread } from './server'
import { renderWidget } from './widget'

const GITHUB: Repository = { kind: 'github', url: 'https://github.com/acme/shop' }
const GITLAB: Repository = { kind: 'gitlab', url: 'https://gitlab.com/acme/web/shop' }

/** The links in `body`, as text and target. */
const links = (body: string, repository?: Repository) =>
  tokenize(body, repository)
    .filter((token) => token.href)
    .map(({ text, href }) => [text, href])

describe('tokenize', () => {
  test('keeps the whole text, in order', () => {
    const body = 'See #12 and https://example.com/a, then `#3`.'
    expect(
      tokenize(body, GITHUB)
        .map((token) => token.text)
        .join(''),
    ).toBe(body)
  })

  test("links a project's issues on GitHub", () => {
    expect(links('Fixed in #12, see GH-7.', GITHUB)).toEqual([
      ['#12', 'https://github.com/acme/shop/issues/12'],
      ['GH-7', 'https://github.com/acme/shop/issues/7'],
    ])
  })

  test("links another repository's issue", () => {
    expect(links('Like octo/cat#3 (and octo/cat.js#4)', GITHUB)).toEqual([
      ['octo/cat#3', 'https://github.com/octo/cat/issues/3'],
      ['octo/cat.js#4', 'https://github.com/octo/cat.js/issues/4'],
    ])
  })

  test("links GitLab's issues and merge requests", () => {
    expect(links('#12, !34 and acme/api!5', GITLAB)).toEqual([
      ['#12', 'https://gitlab.com/acme/web/shop/-/issues/12'],
      ['!34', 'https://gitlab.com/acme/web/shop/-/merge_requests/34'],
      ['acme/api!5', 'https://gitlab.com/acme/api/-/merge_requests/5'],
    ])
  })

  test('leaves what only the other host knows as text', () => {
    expect(links('Done !34, a/b/c#2', GITHUB)).toEqual([])
    expect(links('GH-7', GITLAB)).toEqual([])
  })

  test('links URLs, without the punctuation after them', () => {
    expect(
      links(
        'Read https://example.com/a?b=1#top. (See http://x.dev/p_(q)) Or https://a.io/x, ok',
      ),
    ).toEqual([
      ['https://example.com/a?b=1#top', 'https://example.com/a?b=1#top'],
      ['http://x.dev/p_(q)', 'http://x.dev/p_(q)'],
      ['https://a.io/x', 'https://a.io/x'],
    ])
  })

  test('links a URL in Markdown, and the issue after it', () => {
    expect(links('[the PR](https://github.com/acme/shop/pull/9) for #8', GITHUB)).toEqual(
      [
        ['https://github.com/acme/shop/pull/9', 'https://github.com/acme/shop/pull/9'],
        ['#8', 'https://github.com/acme/shop/issues/8'],
      ],
    )
  })

  test('without a repository, links only the URLs', () => {
    expect(links('#12, acme/shop#3, GH-7 and https://example.com')).toEqual([
      ['https://example.com', 'https://example.com'],
    ])
  })

  test('leaves code, words, colours, entities and headings as text', () => {
    const body = [
      '`#12` and ```\nfix #13\nhttps://example.com\n```',
      'issue#14 #15a #fff &#16; ## Title #',
      'x/#18 a/b/#19 javascript:alert(1) ftp://example.com',
    ].join('\n')
    expect(links(body, GITHUB)).toEqual([])
  })
})

test('parses only a repository the widget can link to', () => {
  expect(
    parseRepository({ kind: 'github', url: 'https://github.com/acme/shop/' }),
  ).toEqual(GITHUB)
  expect(parseRepository({ kind: 'bitbucket', url: 'https://bitbucket.org/a/b' })).toBe(
    undefined,
  )
  expect(parseRepository({ kind: 'github', url: 'javascript:alert(1)' })).toBe(undefined)
  expect(parseRepository('https://github.com/acme/shop')).toBe(undefined)
  expect(parseRepository(undefined)).toBe(undefined)
})

test("a thread's messages link the issues and URLs they cite, in a new tab", async () => {
  fakeServer(
    [
      comment({
        body: 'Like https://example.com/form, <b>#2</b>',
        state: 'answered',
        messages: [
          { author: 'claude', body: 'Done, see #12.', at: '2026-01-01T10:01:00.000Z' },
        ],
      }),
    ],
    { repository: { kind: 'github', url: 'https://github.com/acme/shop' } },
  )
  openThread('c1')
  renderWidget()

  const issue = await screen.findByRole('link', { name: '#12' })
  expect(issue.getAttribute('href')).toBe('https://github.com/acme/shop/issues/12')
  expect(issue.getAttribute('target')).toBe('_blank')
  expect(issue.getAttribute('rel')).toBe('noopener noreferrer')
  const url = screen.getByRole('link', { name: 'https://example.com/form' })
  expect(url.getAttribute('href')).toBe('https://example.com/form')
  expect(url.getAttribute('target')).toBe('_blank')
  // The reader's words stay text: their markup is not the page's.
  const own = screen.getByRole('link', { name: '#2' })
  expect(own.closest('.an-bubble')?.textContent).toBe(
    'Like https://example.com/form, <b>#2</b>',
  )
  expect(document.querySelector('.an-bubble b')).toBeNull()
})

test('without a known repository, an issue stays text', async () => {
  fakeServer([
    comment({
      state: 'answered',
      messages: [
        { author: 'claude', body: 'Done, see #12.', at: '2026-01-01T10:01:00.000Z' },
      ],
    }),
  ])
  openThread('c1')
  renderWidget()

  await screen.findByText('Done, see #12.')
  await waitFor(() => expect(screen.queryByRole('link', { name: '#12' })).toBeNull())
})
