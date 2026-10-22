import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  PAGES,
  REPOSITORY,
  htmlLines,
  keepSections,
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
    '```sh',
    '## not a heading',
    '```',
    '## Development',
    'For contributors.',
    '## Security',
    'Local only.',
  ].join('\n')
  assert.equal(
    keepSections(markdown, ['Install', 'Security']),
    '## Install\nRun it.\n```sh\n## not a heading\n```\n## Security\nLocal only.\n',
  )
})

test('points links at the site, the page, or GitHub', () => {
  const markdown = [
    '## Models',
    '[here](#models) [gone](#development) [file](docs/comments-file.md#states)',
    '[self](README.md) [policy](SECURITY.md) [web](https://example.com/a.md)',
    '```',
    '[code](SECURITY.md)',
    '```',
  ].join('\n')
  assert.equal(
    rewriteLinks(markdown, 'README.md', PAGES),
    [
      '## Models',
      `[here](#models) [gone](${REPOSITORY}/blob/main/README.md#development) [file](comments-file.html#states)`,
      `[self](#) [policy](${REPOSITORY}/blob/main/SECURITY.md) [web](https://example.com/a.md)`,
      '```',
      '[code](SECURITY.md)',
      '```',
    ].join('\n'),
  )
  assert.equal(
    rewriteLinks(
      '[a](../README.md#install) [b](../skills/x.mjs)',
      'docs/comments-file.md',
      PAGES,
    ),
    `[a](./#install) [b](${REPOSITORY}/blob/main/skills/x.mjs)`,
  )
})

test('finds a line kramdown would read as HTML', () => {
  // GitHub reads it as the end of a code span; kramdown as an HTML block.
  assert.deepEqual(
    htmlLines('the server stops with `delete\n<file>`, and\n\n<p>a block</p>'),
    ['<file>`, and'],
  )
})

test("stages every docs page from the repository's Markdown", async () => {
  for (const page of PAGES) {
    const staged = toPage(page, await read(page.source), PAGES)
    assert.match(staged, /^---\nlayout: docs\n/)
    assert.match(
      staged,
      /\{% raw %\}\n[^]*\n## [^]*\{% endraw %\}\n$/,
      `${page.source}: its sections`,
    )
    assert.ok(
      !staged.includes('](.github/'),
      `${page.source}: no link left to the repository`,
    )
  }
})
