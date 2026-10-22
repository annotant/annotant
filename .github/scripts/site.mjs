#!/usr/bin/env node
// site.mjs <out-dir>
// Stages the website's sources in <out-dir> for Jekyll: site/ as it is, the
// mascot, and the docs pages built from the Markdown files PAGES lists, so the
// site never holds a copy of them. Run from the repository root; the Pages
// workflow builds <out-dir> with Jekyll. Fails on what would break a page.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPOSITORY = 'https://github.com/annotant/annotant'

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
 * GitHub's id for a heading: lowercase, punctuation but `_` and `-` dropped,
 * spaces to dashes.
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
    const [, marker, info] = /^\s*(`{3,}|~{3,})(.*)$/.exec(text) ?? []
    // A closing fence is the opening one's character, as long, and nothing else.
    if (marker && (!fence || (marker.startsWith(fence) && !info?.trim()))) {
      fence = fence ? '' : marker
      return { text, code: true }
    }
    return { text, code: fence !== '' }
  })
}

/**
 * Keeps the `## ` sections named, in their order in the file, and drops what
 * comes before the first one (the README's header, made for GitHub). Throws
 * when one of them is not in the file: a renamed heading would drop it.
 * @param {string} markdown
 * @param {string[]} names
 */
export function keepSections(markdown, names) {
  /** @type {string[]} */
  const kept = []
  const found = new Set()
  let keep = false
  for (const { text, code } of lines(markdown)) {
    const h2 = code ? undefined : /^## (.+)$/.exec(text)?.[1]?.trim()
    if (h2 !== undefined) {
      keep = names.includes(h2)
      if (keep) found.add(h2)
    }
    if (keep) kept.push(text)
  }
  const missing = names.filter((name) => !found.has(name))
  if (missing.length) throw new Error(`no "## ${missing.join('", "## ')}" section`)
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
 * The headings of a docs page's source: all of them, and those its page keeps.
 * @typedef {{ all: Set<string>, kept: Set<string> }} Ids
 */

/**
 * Points the page's links where they work on the site: to a docs page when it
 * keeps the heading linked to, else to the file on GitHub. Throws on a link to
 * a heading its file does not have, or with a scheme but http(s) and mailto.
 * @param {string} markdown the page, as the site shows it
 * @param {string} source the page's file in the repository
 * @param {Page[]} pages
 * @param {Map<string, Ids>} ids the headings of each page's source
 */
export function rewriteLinks(markdown, source, pages, ids) {
  const site = new Map(pages.map((page) => [page.source, page.path]))
  const here = site.get(source) ?? source
  /** @param {string} target */
  const link = (target) => {
    if (/^(https?|mailto):/i.test(target)) return target
    if (/^[a-z][a-z0-9+.-]*:/i.test(target))
      throw new Error(`${source}: link to ${target}`)
    const [path = '', hash = ''] = target.split('#')
    const file = path ? posix.normalize(posix.join(posix.dirname(source), path)) : source
    const anchor = hash ? `#${hash}` : ''
    const page = site.get(file)
    const headings = ids.get(file)
    if (hash && headings && !headings.all.has(hash)) {
      throw new Error(`${source}: link to ${target}, a heading ${file} does not have`)
    }
    if (page && (!hash || headings?.kept.has(hash))) {
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
 * The lines kramdown would read as raw HTML where GitHub reads text: a line
 * inside a paragraph that starts with a tag (`<file>` wrapped from a code
 * span), which swallows the rest of the page.
 * @param {string} markdown
 */
export function htmlLines(markdown) {
  const all = lines(markdown)
  return all.flatMap(({ text, code }, i) =>
    !code && all[i - 1]?.text.trim() && /^\s*<[a-z]/i.test(text) ? [text.trim()] : [],
  )
}

/**
 * The Markdown a docs page shows: the sections it keeps.
 * @param {Page} page
 * @param {string} markdown the source file's content
 */
const shown = (page, markdown) =>
  page.sections ? keepSections(markdown, page.sections) : markdown

/**
 * The headings of each page's source.
 * @param {Page[]} pages
 * @param {Map<string, string>} sources each page's source file's content
 * @returns {Map<string, Ids>}
 */
export const pageIds = (pages, sources) =>
  new Map(
    pages.map((page) => {
      const markdown = sources.get(page.source) ?? ''
      return [
        page.source,
        { all: headingIds(markdown), kept: headingIds(shown(page, markdown)) },
      ]
    }),
  )

/**
 * A docs page as Jekyll reads it: its front matter, a table of contents
 * (kramdown's), and its sections with their links rewritten, without its H1
 * (the layout's title) and kept out of Liquid. Throws on what would break it.
 * @param {Page} page
 * @param {Page[]} pages
 * @param {Map<string, string>} sources each page's source file's content
 */
export function toPage(page, pages, sources) {
  const kept = shown(page, sources.get(page.source) ?? '')
  const html = htmlLines(kept)
  if (html.length) {
    throw new Error(
      `${page.source}: rewrap the lines that start with a tag: ${html.join(' | ')}`,
    )
  }
  if (/\{%-?\s*endraw/.test(kept)) throw new Error(`${page.source}: holds an endraw tag`)
  const body = rewriteLinks(kept, page.source, pages, pageIds(pages, sources)).replace(
    /^# .+\n+/,
    '',
  )
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
  cpSync('.github/assets/annotant.png', join(out, 'assets/annotant.png'))
  const sources = new Map(
    PAGES.map((page) => [page.source, readFileSync(page.source, 'utf8')]),
  )
  for (const page of PAGES) {
    const file = join(out, page.path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, toPage(page, PAGES, sources))
  }
}
