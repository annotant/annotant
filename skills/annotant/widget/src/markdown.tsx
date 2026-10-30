import { Fragment, type ReactNode } from 'react'
import { Linked, type Repository } from './links'

/**
 * A block of a message: a paragraph, a list (`ordered` from `start`) or a
 * fenced code block.
 */
type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
  | { kind: 'code'; text: string }

// A fence opens on a line of its own: ```` ```npm test``` ```` is inline code.
const FENCE = /^\s*```[^`]*$/
const BULLET = /^\s*-\s+(.*)$/
const NUMBERED = /^\s*(\d{1,9})\.\s+(.*)$/

/**
 * `body` cut into blocks: blank lines end a paragraph or a list, a line
 * starting with ```` ``` ```` (a language after it, no other backtick) opens a
 * code block up to the next bare ```` ``` ```` line (or the end), a line
 * starting with `- ` or `1. ` is a list item, indented or not (lists do not
 * nest), and a line after an item goes on with it. Anything else is a
 * paragraph's text, as written.
 */
export function blocks(body: string): Block[] {
  const result: Block[] = []
  let current: Block | undefined
  // The lines of the code block open, until its closing fence.
  let code: string[] | undefined
  const end = () => {
    if (current) result.push(current)
    current = undefined
  }
  for (const line of body.split(/\r?\n/)) {
    if (code) {
      if (/^\s*```\s*$/.test(line)) {
        result.push({ kind: 'code', text: code.join('\n') })
        code = undefined
      } else code.push(line)
      continue
    }
    if (FENCE.test(line)) {
      end()
      code = []
      continue
    }
    if (!line.trim()) {
      end()
      continue
    }
    const bullet = BULLET.exec(line)
    const numbered = bullet ? null : NUMBERED.exec(line)
    if (bullet || numbered) {
      const ordered = !!numbered
      const text = (bullet ? bullet[1] : numbered?.[2]) ?? ''
      if (current?.kind === 'list' && current.ordered === ordered)
        current.items.push(text)
      else {
        end()
        current = {
          kind: 'list',
          ordered,
          start: Number(numbered?.[1] ?? 1),
          items: [text],
        }
      }
    } else if (current?.kind === 'list') {
      current.items[current.items.length - 1] += `\n${line.trim()}`
    } else if (current?.kind === 'paragraph') current.text += `\n${line}`
    else {
      end()
      current = { kind: 'paragraph', text: line }
    }
  }
  // A fence never closed runs to the end.
  if (code) result.push({ kind: 'code', text: code.join('\n') })
  end()
  return result
}

/**
 * A backslash's escape (`\*` is a star), inline code, a link (an image's `!` before it keeps it text), a bare URL
 * (matched only so that the stars and brackets in it stay its own), bold, and
 * italic. Bold and italic stars hug their text and stand outside a word or a
 * path: `2 * 3`, `2*3*4` and `src/*.ts` stay text. Bounded spans keep a long
 * line of `[` or `**` from taking quadratic time. Emphasis holds whole code spans,
 * so a star in code never closes it.
 */
const INLINE =
  /\\([\\`*_[\]])|(`[^`\n]+`)|(!?)\[([^\]\n]{1,200})\]\(([^()\s]+)\)|(?<!\w)https?:\/\/[^\s<>"'`]+|(?<![\w*/])\*\*(?=[^\s*])((?:`[^`\n]+`|[^`\n]){1,300}?)(?<=[^\s*])\*\*(?![\w*])|(?<![\w*/])\*(?=[^\s*])((?:`[^`\n]+`|[^*`\n]){1,300}?)(?<=[^\s*])\*(?![\w*])/g

/** Only an http(s) address becomes a link: never `javascript:` or `data:`. */
function safeHref(url: string) {
  return /^https?:\/\//i.test(url) ? url : undefined
}

/**
 * `text`'s inline Markdown as React elements, never HTML: code, bold, italic
 * and http(s) links; the rest is text, its URLs and issues linked. Without
 * `links` (in a link's label), nothing in it is linked.
 */
function inline(
  text: string,
  repository: Repository | undefined,
  links = true,
): ReactNode[] {
  const nodes: ReactNode[] = []
  let prose = ''
  const flush = () => {
    if (!prose) return
    nodes.push(
      <Fragment key={nodes.length}>
        {links ? <Linked text={prose} repository={repository} /> : prose}
      </Fragment>,
    )
    prose = ''
  }
  let from = 0
  for (const match of text.matchAll(INLINE)) {
    const [whole, escaped, code, bang, label, url, bold, italic] = match
    prose += text.slice(from, match.index)
    from = match.index + whole.length
    const href = label && url && !bang && links ? safeHref(url) : undefined
    if (escaped) prose += escaped
    else if (code) {
      flush()
      nodes.push(<code key={nodes.length}>{code.slice(1, -1)}</code>)
    } else if (href && label) {
      flush()
      nodes.push(
        // Its address on hover: the label may read as another one.
        <a
          key={nodes.length}
          href={href}
          title={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {inline(label, repository, false)}
        </a>,
      )
    } else if (bold) {
      flush()
      nodes.push(<strong key={nodes.length}>{inline(bold, repository, links)}</strong>)
    } else if (italic) {
      flush()
      nodes.push(<em key={nodes.length}>{inline(italic, repository, links)}</em>)
    } else prose += whole
  }
  prose += text.slice(from)
  flush()
  return nodes
}

/**
 * Claude's message, its small subset of Markdown formatted: paragraphs, `-`
 * and `1.` lists, fenced code, `code`, **bold**, *italic* and http(s) links.
 * Headings, tables, images and HTML show as the text they are.
 */
export function Markdown({
  text,
  repository,
}: {
  text: string
  repository: Repository | undefined
}) {
  return (
    <div className="an-md">
      {blocks(text).map((block, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- the blocks of one text never move
        <Fragment key={index}>
          {block.kind === 'code' ? (
            <pre>
              <code>{block.text}</code>
            </pre>
          ) : block.kind === 'paragraph' ? (
            <p>{inline(block.text, repository)}</p>
          ) : block.ordered ? (
            <ol start={block.start === 1 ? undefined : block.start}>
              {block.items.map((item, at) => (
                // oxlint-disable-next-line react/no-array-index-key -- the items of one list never move
                <li key={at}>{inline(item, repository)}</li>
              ))}
            </ol>
          ) : (
            <ul>
              {block.items.map((item, at) => (
                // oxlint-disable-next-line react/no-array-index-key -- the items of one list never move
                <li key={at}>{inline(item, repository)}</li>
              ))}
            </ul>
          )}
        </Fragment>
      ))}
    </div>
  )
}
