#!/usr/bin/env node
// site.mjs <out-dir>
// Stages the website's sources in <out-dir> for Jekyll: site/ as it is, the
// mascot, and the docs pages built from the repository's Markdown (README.md
// and docs/), so the site never holds a copy of them. Run from the repository
// root; the Pages workflow builds <out-dir> with Jekyll.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPOSITORY = 'https://github.com/neolitec/code-buddy'

/**
 * A docs page: its source in the repository, where it goes on the site, and,
 * for the README, the sections it keeps (the rest is for contributors).
 * @typedef {{ source: string, path: string, title: string, sections?: string[] }} Page
 */

/** @type {Page[]} */
export const PAGES = [
  {
    source: 'README.md',
    path: 'docs/index.md',
    title: 'Guide',
    sections: ['How it works', 'Install', 'In the widget', 'Troubleshooting', 'Security'],
  },
  {
    source: 'docs/comments-file.md',
    path: 'docs/comments-file.md',
    title: 'The comments file',
  },
]

/**
 * GitHub's id for a heading: lowercase, punctuation dropped, spaces to dashes.
 * @param {string} heading
 */
export const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')

/**
 * The Markdown's lines, each with whether it lies in a fenced code block.
 * @param {string} markdown
 */
function lines(markdown) {
  let fence = ''
  return markdown.split('\n').map((text) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(text)?.[1]
    if (marker && (!fence || marker.startsWith(fence))) {
      fence = fence ? '' : marker
      return { text, code: true }
    }
    return { text, code: fence !== '' }
  })
}

/**
 * Keeps the `## ` sections named, in their order in the file, and drops what
 * comes before the first one (the README's header, made for GitHub).
 * @param {string} markdown
 * @param {string[]} names
 */
export function keepSections(markdown, names) {
  /** @type {string[]} */
  const kept = []
  let keep = false
  for (const { text, code } of lines(markdown)) {
    const h2 = code ? undefined : /^## (.+)$/.exec(text)?.[1]
    if (h2 !== undefined) keep = names.includes(h2.trim())
    if (keep) kept.push(text)
  }
  return kept.join('\n').trim() + '\n'
}

/**
 * The ids of the Markdown's headings.
 * @param {string} markdown
 */
export const headingIds = (markdown) =>
  new Set(
    lines(markdown).flatMap(({ text, code }) => {
      const heading = code ? undefined : /^#{1,6} (.+)$/.exec(text)?.[1]
      return heading === undefined ? [] : [slug(heading)]
    }),
  )

/**
 * Points the page's links where they work on the site: a page of the site
 * stays on the site, an anchor of the page stays as it is, and anything else
 * goes to the file on GitHub.
 * @param {string} markdown the page, as the site shows it
 * @param {string} source the page's file in the repository
 * @param {Page[]} pages
 */
export function rewriteLinks(markdown, source, pages) {
  const ids = headingIds(markdown)
  const site = new Map(pages.map((page) => [page.source, page.path]))
  const here = site.get(source) ?? source
  /** @param {string} target */
  const link = (target) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target
    const [path = '', hash = ''] = target.split('#')
    const file = path ? posix.normalize(posix.join(posix.dirname(source), path)) : source
    const anchor = hash ? `#${hash}` : ''
    const page = site.get(file)
    if (page && (file !== source || !hash || ids.has(hash))) {
      if (page === here) return anchor || '#'
      const html = posix
        .relative(posix.dirname(here), page)
        .replace(/(^|\/)index\.md$/, '$1')
      return (html.replace(/\.md$/, '.html') || './') + anchor
    }
    return `${REPOSITORY}/blob/main/${file}${anchor}`
  }
  return lines(markdown)
    .map(({ text, code }) =>
      code ? text : text.replace(/\]\(([^)\s]+)\)/g, (_, target) => `](${link(target)})`),
    )
    .join('\n')
}

/**
 * The lines kramdown would read as raw HTML where GitHub reads text: a tag at
 * the start of a paragraph's line (`<file>` wrapped from a code span), which
 * swallows the rest of the page.
 * @param {string} markdown
 */
export function htmlLines(markdown) {
  const all = lines(markdown)
  return all.flatMap(({ text, code }, i) =>
    !code && all[i - 1]?.text.trim() && /^\s*<[a-z]/i.test(text) ? [text.trim()] : [],
  )
}

/**
 * A docs page as Jekyll reads it: its front matter, a table of contents
 * (kramdown's), and the Markdown kept out of Liquid.
 * @param {Page} page
 * @param {string} markdown the source file's content
 * @param {Page[]} pages
 */
export function toPage(page, markdown, pages) {
  const kept = page.sections ? keepSections(markdown, page.sections) : markdown
  const html = htmlLines(kept)
  if (html.length) {
    throw new Error(
      `${page.source}: rewrap the lines that start with a tag: ${html.join(' | ')}`,
    )
  }
  // The page's own H1 is the layout's title.
  const body = rewriteLinks(kept, page.source, pages).replace(/^# .+\n+/, '')
  const root = '../'.repeat(page.path.split('/').length - 1)
  return [
    '---',
    'layout: docs',
    `title: ${JSON.stringify(page.title)}`,
    `root: ${JSON.stringify(root)}`,
    `source: ${JSON.stringify(`${REPOSITORY}/blob/main/${page.source}`)}`,
    '---',
    '',
    '* Contents',
    '{:toc}',
    '',
    '{% raw %}',
    body.trimEnd(),
    '{% endraw %}',
    '',
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2]
  if (!out) {
    console.error('usage: site.mjs <out-dir>')
    process.exit(2)
  }
  cpSync('site', out, { recursive: true })
  cpSync('.github/assets/buddy.png', join(out, 'assets/buddy.png'))
  for (const page of PAGES) {
    const file = join(out, page.path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, toPage(page, readFileSync(page.source, 'utf8'), PAGES))
  }
}
