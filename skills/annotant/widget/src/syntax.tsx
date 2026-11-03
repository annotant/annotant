import { Fragment, type ReactNode } from 'react'

/**
 * A language the widget highlights: TypeScript without JSX (`ts`, where `<T>`
 * is a type), TypeScript with it (`tsx`), JavaScript with or without it
 * (`js`), and JSON with or without comments (`json`).
 */
export type Language = 'ts' | 'tsx' | 'js' | 'json'

/** What a token is, for its colour; plain text has none. */
type TokenKind = 'keyword' | 'string' | 'number' | 'comment' | 'tag' | 'attr' | 'key'

export type Token = { text: string; kind?: TokenKind }

const BY_EXTENSION: Readonly<Record<string, Language>> = {
  ts: 'ts',
  mts: 'ts',
  cts: 'ts',
  tsx: 'tsx',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  jsx: 'js',
  json: 'json',
  jsonc: 'json',
}

const BY_FENCE: Readonly<Record<string, Language>> = {
  ts: 'ts',
  typescript: 'ts',
  tsx: 'tsx',
  js: 'js',
  javascript: 'js',
  jsx: 'js',
  json: 'json',
  jsonc: 'json',
}

/** The language of the file at `path`, from its extension; none for any other. */
export function languageOfFile(path: string): Language | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? BY_EXTENSION[name.slice(dot + 1).toLowerCase()] : undefined
}

/** The language a code block's fence names (```` ```tsx ````); none for any other. */
export function languageOfFence(word: string | undefined): Language | undefined {
  return word ? BY_FENCE[word.toLowerCase()] : undefined
}

const KEYWORDS = new Set(
  (
    'async await break case catch class const continue debugger default delete do ' +
    'else export extends false finally for from function if import in instanceof let ' +
    'new null of return static super switch this throw true try typeof undefined var ' +
    'void while with yield'
  ).split(' '),
)
/**
 * TypeScript's own words, most of them contextual (`type`, `string` can name a
 * variable): coloured anywhere but after a `.` or before a `:`, an
 * approximation; plain names in JavaScript.
 */
const TS_KEYWORDS = new Set(
  (
    'abstract any as asserts bigint boolean declare enum implements infer interface ' +
    'is keyof namespace never number object private protected public readonly ' +
    'satisfies string symbol type unique unknown'
  ).split(' '),
)

// A comment, or a string, runs to the end of the line when it is not closed there:
// a diff's line may be cut in the middle of either.
const COMMENT = String.raw`\/\/.*|\/\*(?:[^*]|\*(?!\/))*(?:\*\/|$)`
const QUOTED = (quote: string) =>
  String.raw`${quote}(?:[^${quote}\\]|\\.)*(?:${quote}|\\?$)`
// An apostrophe right after a letter is prose's (JSX text's `Don't`), no string.
const SINGLE = String.raw`(?<![A-Za-z])${QUOTED("'")}`
const NUMBER = String.raw`\b(?:0[xXbBoO][\da-fA-F_]+n?|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?n?)\b`

/**
 * One line of JavaScript or TypeScript: a comment, a string (a template
 * literal up to its next backtick, `${}` included; a quote in a regular
 * expression's literal opens one too), with JSX a `<` or `</` and the name after
 * it (`tokens` tells a tag from a comparison or a type), a number, then a
 * word, with JSX its hyphens included (`aria-label`). A word is matched whole,
 * never retried from inside: one pass over the line, however long.
 */
const script = (jsx: boolean) =>
  new RegExp(
    [
      `(${COMMENT})`,
      `(${SINGLE}|${QUOTED('"')}|${QUOTED('`')})`,
      // Without JSX, the same groups, never matched (`(?!)` always fails).
      String.raw`${jsx ? '' : '(?!)'}(<\/?)([A-Za-z][\w.:-]*)`,
      `(${NUMBER})`,
      jsx ? String.raw`([A-Za-z_$][\w$]*(?:-[\w$]+)*)` : String.raw`([A-Za-z_$][\w$]*)`,
    ].join('|'),
    'g',
  )

const PATTERNS = { plain: script(false), jsx: script(true) }

/** A JSON line: a comment (JSONC), a string, a key's when a `:` follows it, a number, a literal. */
const JSON_LINE = new RegExp(
  `(${COMMENT})|(${QUOTED('"')})(\\s*:)?|(-?${NUMBER})|\\b(true|false|null)\\b`,
  'g',
)

/**
 * `line` cut into tokens, each with its kind, the text between them plain:
 * one line at a time, so that a line's colours never depend on another's (a
 * comment or a template literal over several lines loses its colour after
 * its first). A line longer than `MAX_LINE` stays plain: a minified bundle's
 * would cost a span per token. Joined, the tokens' texts are `line`.
 */
export function tokens(line: string, language: Language): Token[] {
  if (line.length > MAX_LINE) return line ? [{ text: line }] : []
  const result: Token[] = []
  let from = 0
  const push = (text: string, kind?: TokenKind) => {
    if (!text) return
    const last = result[result.length - 1]
    if (!kind && last && !last.kind) last.text += text
    else result.push(kind ? { text, kind } : { text })
  }
  const pattern =
    language === 'json' ? JSON_LINE : PATTERNS[language === 'ts' ? 'plain' : 'jsx']
  for (const match of line.matchAll(pattern)) {
    push(line.slice(from, match.index))
    from = match.index + match[0].length
    if (language === 'json') {
      const [, comment, string, colon, number, literal] = match
      if (comment) push(comment, 'comment')
      else if (string) {
        push(string, colon ? 'key' : 'string')
        push(colon ?? '')
      } else if (number) push(number, 'number')
      else if (literal) push(literal, 'keyword')
      continue
    }
    const [, comment, string, open, tag, number, word] = match
    if (comment) push(comment, 'comment')
    else if (string) push(string, 'string')
    else if (open && tag) {
      push(open)
      if (open === '</' || opensTag(line, match.index)) push(tag, 'tag')
      else
        push(tag, isKeyword(tag, language, line, match.index + 1) ? 'keyword' : undefined)
    } else if (number) push(number, 'number')
    else if (word) {
      const end = match.index + word.length
      // With JSX, a name right before `="`, `='` or `={` is an attribute's.
      if (language !== 'ts' && line[end] === '=' && /["'{]/.test(line[end + 1] ?? ''))
        push(word, 'attr')
      else
        push(word, isKeyword(word, language, line, match.index) ? 'keyword' : undefined)
    }
  }
  push(line.slice(from))
  return result
}

/** The longest line `tokens` highlights. */
const MAX_LINE = 2000

/**
 * Whether the `<` at `at` in `line`, a name right after it, opens a JSX tag:
 * not right after a name or a bracket, where it is a type's (`Array<T>`,
 * `f<T>()`). A comparison has a space after its `<` (`i < n`): never matched.
 */
function opensTag(line: string, at: number) {
  return !/[\w$)\]]/.test(line[at - 1] ?? '')
}

/**
 * Whether `word`, at `at` in `line`, is a keyword: not a property's name after
 * `.`, nor TypeScript's word as a key before `:` (`{ type: 'a' }`).
 */
function isKeyword(word: string, language: Language, line: string, at: number) {
  if (line[at - 1] === '.' && line[at - 2] !== '.') return false
  if (KEYWORDS.has(word)) return true
  return (
    language !== 'js' &&
    TS_KEYWORDS.has(word) &&
    !/^\s*:/.test(line.slice(at + word.length))
  )
}

/** One line's tokens as React elements, never HTML: a span for each coloured one. */
function highlighted(line: string, language: Language): ReactNode[] {
  return tokens(line, language).map(({ text, kind }, index) =>
    kind ? (
      // oxlint-disable-next-line react/no-array-index-key -- the tokens of one line never move
      <span key={index} className={`an-tok an-tok--${kind}`}>
        {text}
      </span>
    ) : (
      // oxlint-disable-next-line react/no-array-index-key -- the tokens of one line never move
      <Fragment key={index}>{text}</Fragment>
    ),
  )
}

/**
 * `code` with its syntax highlighted, line by line, in `language`; as written
 * without one.
 */
export function Code({
  code,
  language,
}: {
  code: string
  language: Language | undefined
}) {
  if (!language) return code
  return code.split('\n').map((line, index) => (
    // oxlint-disable-next-line react/no-array-index-key -- the lines of one block never move
    <Fragment key={index}>
      {index > 0 && '\n'}
      {highlighted(line, language)}
    </Fragment>
  ))
}
