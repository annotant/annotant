import { Fragment } from 'react'

/** The project's repository, as the server read it from its `origin` remote. */
export type Repository = { kind: 'github' | 'gitlab'; url: string }

/** The server's `repository`, when it is one the widget can link to. */
export function parseRepository(value: unknown): Repository | undefined {
  if (!value || typeof value !== 'object' || !('kind' in value) || !('url' in value)) {
    return undefined
  }
  const { kind, url } = value
  if ((kind !== 'github' && kind !== 'gitlab') || typeof url !== 'string')
    return undefined
  return url.startsWith('https://') ? { kind, url: url.replace(/\/+$/, '') } : undefined
}

/** A piece of a message: text, a link when it has an `href`. */
export type Token = { text: string; href?: string }

/** Code, inline or fenced: its text is never linked. */
const CODE = /```[\s\S]*?```|`[^`\n]+`/g

/**
 * A URL, or a reference: `owner/repo#12` (GitLab's `group/project!12` too),
 * `#12`, `GH-12` or `!12`. Neither inside a word or a path, nor followed by
 * one: `#fff`, `a#1` and `#1a` stay text.
 */
const REFERENCE =
  /(?<!\w)(https?:\/\/[^\s<>"'`]+)|(?<![\w/.&#!-])(?:([\w-]+(?:\/[\w.-]+)+)([#!])(\d+)|(#|GH-|!)(\d+))(?![\w/-])/g

/** What ends a sentence after a URL, not the URL itself. */
const TRAILING = /[.,;:!?'"*_]$/

/** `url` without the punctuation after it, and a bracket it does not open. */
function trimUrl(url: string) {
  let end = url.length
  const count = (char: string) => url.slice(0, end).split(char).length - 1
  for (;;) {
    const last = url.slice(end - 1, end)
    if (TRAILING.test(last)) end -= 1
    else if (last === ')' && count(')') > count('(')) end -= 1
    else if (last === ']' && count(']') > count('[')) end -= 1
    else return url.slice(0, end)
  }
}

/** The page of issue (or merge request, `!`) `number` of the project at `path`. */
function issueUrl(repository: Repository, path: string, mark: string, number: string) {
  const site = new URL(repository.url).origin
  if (repository.kind === 'github') {
    // GitHub sends an issue's number to its pull request when it is one.
    return mark === '!' || path.split('/').length !== 2
      ? undefined
      : `${site}/${path}/issues/${number}`
  }
  return `${site}/${path}/-/${mark === '!' ? 'merge_requests' : 'issues'}/${number}`
}

/** The page a bare reference (`#12`, `GH-12`, `!12`) names in `repository`. */
function bareUrl(repository: Repository, mark: string, number: string) {
  const path = new URL(repository.url).pathname.slice(1)
  if (mark === 'GH-' && repository.kind !== 'github') return undefined
  return issueUrl(repository, path, mark === '!' ? '!' : '#', number)
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
