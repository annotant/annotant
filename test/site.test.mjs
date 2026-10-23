import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  PAGES,
  REPOSITORY,
  htmlLines,
  keepSections,
  pageIds,
  rewriteLinks,
  slug,
  toPage,
} from '../.github/scripts/site.mjs'

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')

test('ids headings the way GitHub does', () => {
  assert.equal(slug('1. Check the requirements'), '1-check-the-requirements')
  assert.equal(slug('`comments.json`'), 'commentsjson')
  assert.equal(
    slug('A comment waits, or an agent seems stuck'),
    'a-comment-waits-or-an-agent-seems-stuck',
  )
})

test('keeps the sections named, without the header before them', () => {
  const markdown = [
    '<h1>Header</h1>',
    '## Install',
    'Run it.',
    '````sh',
    '## not a heading',
    '```js',
    '````',
    '## Development',
    'For contributors.',
    '## Security',
    'Local only.',
  ].join('\n')
  assert.equal(
    keepSections(markdown, ['Install', 'Security']),
    '## Install\nRun it.\n````sh\n## not a heading\n```js\n````\n## Security\nLocal only.\n',
  )
  // A renamed heading would drop its section from the site.
  assert.throws(
    () => keepSections(markdown, ['Install', 'Installation']),
    /## Installation/,
  )
})

const README = [
  '## Models',
  '[here](#models) [gone](#development) [file](docs/comments-file.md#states-and-moves)',
  '[self](README.md) [policy](SECURITY.md) [web](https://example.com/a.md)',
  '```',
  '[code](SECURITY.md)',
  '```',
  '## Development',
].join('\n')
const COMMENTS = '# The file\n## States and moves\n'
const sources = new Map([
  ['README.md', README],
  ['docs/comments-file.md', COMMENTS],
])
const pages = [{ ...PAGES[0], sections: ['Models'] }, PAGES[1]]
const ids = pageIds(pages, sources)

test('points links at the site, the page, or GitHub', () => {
  assert.equal(
    rewriteLinks(keepSections(README, ['Models']), 'README.md', pages, ids),
    [
      '## Models',
      `[here](#models) [gone](${REPOSITORY}/blob/main/README.md#development) [file](comments-file.html#states-and-moves)`,
      `[self](#) [policy](${REPOSITORY}/blob/main/SECURITY.md) [web](https://example.com/a.md)`,
      '```',
      '[code](SECURITY.md)',
      '```',
      '',
    ].join('\n'),
  )
  // A section the site drops, linked from another page, is on GitHub only.
  assert.equal(
    rewriteLinks(
      '[a](../README.md#models) [b](../README.md#development) [c](../skills/x.mjs)',
      'docs/comments-file.md',
      pages,
      ids,
    ),
    `[a](./#models) [b](${REPOSITORY}/blob/main/README.md#development) [c](${REPOSITORY}/blob/main/skills/x.mjs)`,
  )
})

test('refuses a link to a missing heading or with an unsafe scheme', () => {
  assert.throws(
    () => rewriteLinks('[a](../README.md#modles)', 'docs/comments-file.md', pages, ids),
    /#modles, a heading README.md does not have/,
  )
  assert.throws(
    () => rewriteLinks('[a](javascript:alert(1))', 'README.md', pages, ids),
    /link to javascript:/,
  )
})

test('finds a line kramdown would read as HTML', () => {
  // GitHub reads it as the end of a code span; kramdown as an HTML block.
  assert.deepEqual(
    htmlLines('the server stops with `delete\n<file>`, and\n\n<p>a block</p>'),
    ['<file>`, and'],
  )
})

test('keeps a page that closes the raw block out of Liquid', () => {
  const closing = new Map([
    ...sources,
    ['docs/comments-file.md', '{% endraw %}{{ site }}\n'],
  ])
  assert.throws(() => toPage(PAGES[1], pages, closing), /endraw/)
})

test("stages every docs page from the repository's Markdown", async () => {
  const real = new Map(
    await Promise.all(
      PAGES.map(
        async (page) => /** @type {const} */ ([page.source, await read(page.source)]),
      ),
    ),
  )
  for (const page of PAGES) {
    const staged = toPage(page, PAGES, real)
    assert.match(staged, /^---\nlayout: docs\n/)
    assert.match(staged, /\nroot: "\.\.\/"\n/, `${page.source}: its root, from docs/`)
    assert.match(
      staged,
      /\{% raw %\}\n(?!# )[^]*\n## [^]*\{% endraw %\}\n$/,
      `${page.source}: its sections, without its H1`,
    )
    for (const section of page.sections ?? []) {
      assert.ok(staged.includes(`\n## ${section}\n`), `${page.source}: ${section}`)
    }
  }
})

test('keeps Liquid tags whole in the layouts', async () => {
  // Prettier splits a tag inside an HTML tag across lines, which breaks it.
  const dir = new URL('../site/_layouts/', import.meta.url)
  for (const file of await readdir(dir)) {
    const layout = await readFile(new URL(file, dir), 'utf8')
    assert.doesNotMatch(layout, /\{%[^%]*\n/, file)
  }
})
