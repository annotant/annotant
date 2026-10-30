import { Fragment } from 'react'

/**
 * The project's repository, as the server read it from its `origin` remote
 * (remote.mjs): its site (`https://github.com`) and its path there
 * (`owner/repo`; on GitLab, maybe in subgroups).
 */
export type Repository = { kind: 'github' | 'gitlab'; site: string; path: string }

/**
 * The server's `repository`, `{ kind, url }`, when it is one the widget can
 * link to: an http(s) page of a project, `owner/repo` on GitHub.
 */
export function parseRepository(value: unknown): Repository | undefined {
  if (!value || typeof value !== 'object' || !('kind' in value) || !('url' in value)) {
    return undefined
  }
  const { kind, url } = value
  if ((kind !== 'github' && kind !== 'gitlab') || typeof url !== 'string') {
    return undefined
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  const path = parsed.pathname.replace(/^\/+|\/+$/g, '')
  const parts = path.split('/')
  if (!/^https?:$/.test(parsed.protocol) || parsed.search || parsed.hash) return undefined
  if (!parts.every((part) => /^[\w.-]+$/.test(part))) return undefined
  if (parts.length < 2 || (kind === 'github' && parts.length !== 2)) return undefined
  return { kind, site: parsed.origin, path }
}

/** A piece of a message: text, a link when it has an `href`. */
export type Token = { text: string; href?: string }

/** Code, inline or fenced: its text is never linked. */
const CODE = /```[\s\S]*?```|`[^`\n]+`/g

/**
 * A URL, or a reference: `owner/repo#12` (on GitLab, `group/sub/project#12`
 * and `group/project!12` too), `#12`, `GH-12` or `!12`. Neither inside a word
 * or after a path's slash, nor followed by a word, a path or a decimal:
 * `#fff`, `a#1`, `#1a` and `#1.2` stay text. A relative path such as
 * `src/app#3` reads as `owner/repo#3`.
 */
const REFERENCE =
  /(?<!\w)(https?:\/\/[^\s<>"'`]+)|(?<![\w/.&#!-])(?:([\w-]+(?:\/[\w.-]+)+)([#!])(\d+)|(#|GH-|!)(\d+))(?![\w/-]|\.\d)/g

/** Sentence punctuation or Markdown emphasis after a URL, not part of it. */
const TRAILING = /[.,;:!?*_]/

/** `url` without the punctuation after it, and a bracket it does not open. */
function trimUrl(url: string) {
  // Each bracket's balance in the whole URL, updated as its end is cut.
  const open = { ')': 0, ']': 0 }
  for (const char of url) {
    if (char === '(') open[')'] += 1
    else if (char === ')') open[')'] -= 1
    else if (char === '[') open[']'] += 1
    else if (char === ']') open[']'] -= 1
  }
  let end = url.length
  for (;;) {
    const last = url.charAt(end - 1)
    if (TRAILING.test(last)) end -= 1
    else if ((last === ')' || last === ']') && open[last] < 0) {
      open[last] += 1
      end -= 1
    } else return url.slice(0, end)
  }
}

/**
 * The page of issue (or merge request, `!`) `number` of the project at
 * `path`, or undefined when the host has no such page.
 */
function issueUrl(repository: Repository, path: string, mark: string, number: string) {
  const { site } = repository
  if (repository.kind === 'github') {
    // `!` and subgroups are GitLab's only. A pull request's number goes to
    // `issues/` too: GitHub redirects it.
    return mark === '!' || path.split('/').length !== 2
      ? undefined
      : `${site}/${path}/issues/${number}`
  }
  return `${site}/${path}/-/${mark === '!' ? 'merge_requests' : 'issues'}/${number}`
}

/**
 * The page a bare reference (`#12`, `GH-12`, `!12`) names in `repository`,
 * or undefined when the host has no such page.
 */
function bareUrl(repository: Repository, mark: string, number: string) {
  if (mark === 'GH-' && repository.kind !== 'github') return undefined
  return issueUrl(repository, repository.path, mark === '!' ? '!' : '#', number)
}

/**
 * `body` cut into text and links: its URLs, and, with a `repository`, the
 * issues it cites. Text only: the caller renders each piece as an element.
 */
export function tokenize(body: string, repository?: Repository): Token[] {
  const tokens: Token[] = []
  const text = (piece: string) => {
    if (!piece) return
    const last = tokens.at(-1)
    if (last && !last.href) last.text += piece
    else tokens.push({ text: piece })
  }
  const linkIn = (prose: string) => {
    let from = 0
    for (const match of prose.matchAll(REFERENCE)) {
      const [whole, url, path, mark, number, bareMark, bareNumber] = match
      const at = match.index
      text(prose.slice(from, at))
      from = at + whole.length
      if (url) {
        const link = trimUrl(url)
        tokens.push({ text: link, href: link })
        text(url.slice(link.length))
        continue
      }
      const href =
        repository &&
        (path && mark && number
          ? issueUrl(repository, path, mark, number)
          : bareMark && bareNumber
            ? bareUrl(repository, bareMark, bareNumber)
            : undefined)
      if (href) tokens.push({ text: whole, href })
      else text(whole)
    }
    text(prose.slice(from))
  }
  let from = 0
  for (const match of body.matchAll(CODE)) {
    linkIn(body.slice(from, match.index))
    text(match[0])
    from = match.index + match[0].length
  }
  linkIn(body.slice(from))
  return tokens
}

/** A message's text, its URLs and the issues it cites as links to a new tab. */
export function Linked({
  text,
  repository,
}: {
  text: string
  repository: Repository | undefined
}) {
  return tokenize(text, repository).map((token, index) =>
    token.href ? (
      // oxlint-disable-next-line react/no-array-index-key -- the pieces of one text never move
      <a key={index} href={token.href} target="_blank" rel="noopener noreferrer">
        {token.text}
      </a>
    ) : (
      // oxlint-disable-next-line react/no-array-index-key -- the pieces of one text never move
      <Fragment key={index}>{token.text}</Fragment>
    ),
  )
}
