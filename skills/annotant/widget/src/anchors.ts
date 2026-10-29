import {
  type ReviewAnchor,
  type ReviewArea,
  type ReviewBox,
  type ReviewElement,
  type ReviewNode,
  type ReviewStroke,
  MAX_DRAWING_POINTS,
  MAX_STROKE_POINTS,
  MAX_STROKES,
  normaliseQuote,
} from './domain'
import { scrollBehavior } from './styles'

const HEADINGS = 'h1, h2, h3'
/** The page's text kept on each side of a quote, to tell its copies apart; as the server's. */
const MAX_CONTEXT = 32
export const WIDGET = '[data-annotant]'
/** Text that is code or a control's value, never part of what the reader reads. */
export const UNREAD = 'script, style, template, noscript, select, textarea'

interface TextIndex {
  nodes: { node: Text; start: number }[]
  /** Normalised page text. */
  text: string
  /** Raw offset of every normalised character. */
  rawOffsets: number[]
  /** Offsets of the normalised spaces where a block or a line ends. */
  breaks: Set<number>
}

/** Block-level by default, for a `display` the page's CSS leaves empty. */
const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'CAPTION',
  'DD',
  'DETAILS',
  'DIALOG',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'SUMMARY',
  'TABLE',
  'TBODY',
  'TD',
  'TFOOT',
  'TH',
  'THEAD',
  'TR',
  'UL',
])

function isBlock(element: Element): boolean {
  const display = getComputedStyle(element).display
  if (!display) return BLOCK_TAGS.has(element.tagName)
  return !display.startsWith('inline') && display !== 'contents' && display !== 'none'
}

/** The block `node` sits in, inside `root`; `blocks` caches each element's answer. */
function blockOf(root: Element, node: Text, blocks: Map<Element, boolean>): Element {
  for (let element = node.parentElement; element && element !== root;) {
    let block = blocks.get(element)
    if (block === undefined) {
      block = isBlock(element)
      blocks.set(element, block)
    }
    if (block) return element
    element = element.parentElement
  }
  return root
}

/**
 * The page's text as written in the DOM, with a line break between blocks and
 * at every `<br>`, so a quote across elements reads as two words, not one.
 */
function indexText(root: Element): TextIndex {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node instanceof Element && node.matches(UNREAD)
          ? NodeFilter.FILTER_REJECT
          : (node instanceof Element ? node : node.parentElement)?.closest(WIDGET)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
    },
  )
  const nodes: TextIndex['nodes'] = []
  const blocks = new Map<Element, boolean>()
  let block: Element | undefined
  let raw = ''
  const rawBreaks = new Set<number>()
  const lineBreak = () => {
    rawBreaks.add(raw.length)
    raw += '\n'
  }
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Element) {
      if (node.tagName === 'BR') lineBreak()
      continue
    }
    if (!(node instanceof Text)) continue
    const current = blockOf(root, node, blocks)
    if (block && current !== block) lineBreak()
    block = current
    nodes.push({ node, start: raw.length })
    raw += node.textContent ?? ''
  }

  let text = ''
  const rawOffsets: number[] = []
  const breaks = new Set<number>()
  let pendingSpace = false
  let pendingBreak = false
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charAt(i)
    if (/\s/.test(char)) {
      pendingSpace = text.length > 0
      pendingBreak ||= rawBreaks.has(i)
      continue
    }
    if (pendingSpace) {
      if (pendingBreak) breaks.add(text.length)
      text += ' '
      rawOffsets.push(i)
      pendingSpace = false
    }
    pendingBreak = false
    text += char
    rawOffsets.push(i)
  }
  return { nodes, text, rawOffsets, breaks }
}

function locate(index: TextIndex, rawOffset: number): [Text, number] {
  let match = index.nodes[0]
  if (!match) throw new Error('annotant: the page has no text to anchor to')
  for (const entry of index.nodes) {
    if (entry.start > rawOffset) break
    match = entry
  }
  return [match.node, rawOffset - match.start]
}

function rawOffsetAt(index: TextIndex, offset: number): number {
  const raw = index.rawOffsets[offset]
  if (raw === undefined)
    throw new RangeError(`annotant: offset ${offset} is outside the page text`)
  return raw
}

function rangeOf(index: TextIndex, start: number, end: number): Range {
  const range = document.createRange()
  const [startNode, startOffset] = locate(index, rawOffsetAt(index, start))
  const [endNode, endOffset] = locate(index, rawOffsetAt(index, end - 1))
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset + 1)
  return range
}

/** Where a boundary point falls in the normalised page text. */
function textOffset(index: TextIndex, container: Node, offset: number): number {
  const entry = index.nodes.find(({ node }) => node === container)
  let raw: number | undefined
  if (entry) {
    raw = entry.start + offset
  } else {
    // A boundary between elements: the first text after it.
    const point = document.createRange()
    point.setStart(container, offset)
    raw = index.nodes.find(({ node }) => point.comparePoint(node, 0) >= 0)?.start
  }
  if (raw === undefined) return index.text.length
  const at = index.rawOffsets.findIndex((rawOffset) => rawOffset >= raw)
  return at === -1 ? index.text.length : at
}

function occurrencesOf(text: string, quote: string): number[] {
  const found: number[] = []
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    found.push(at)
  }
  return found
}

/** The page's text from `start` to `end`, a line break where a block or a line ends. */
function contextOf(index: TextIndex, start: number, end: number): string {
  let context = ''
  for (let at = Math.max(0, start); at < end && at < index.text.length; at++) {
    context += index.breaks.has(at) ? '\n' : index.text.charAt(at)
  }
  return context
}

function sectionOf(root: Element, range: Range): string {
  let section = ''
  root.querySelectorAll(HEADINGS).forEach((heading) => {
    if (heading.closest(WIDGET)) return
    const before =
      range.compareBoundaryPoints(Range.START_TO_START, rangeAround(heading)) >= 0
    if (before) section = heading.textContent?.trim() ?? section
  })
  return section
}

function rangeAround(element: Element): Range {
  const range = document.createRange()
  range.selectNodeContents(element)
  return range
}

/** Describes a user selection so it can be found again on a later render. */
export function anchorFromSelection(
  root: Element,
  selection: Selection,
): ReviewAnchor | undefined {
  return quoteFromSelection(root, selection)?.anchor
}

/**
 * `anchorFromSelection`, with the range `rangeFromAnchor` finds for it,
 * reading the page's text once: a drag changes the selection many times a second.
 */
export function quoteFromSelection(
  root: Element,
  selection: Selection,
): { anchor: ReviewAnchor; range: Range | undefined } | undefined {
  if (selection.rangeCount === 0 || selection.isCollapsed) return undefined
  const range = selection.getRangeAt(0)
  const container = range.commonAncestorContainer
  const element = container instanceof Element ? container : container.parentElement
  if (!root.contains(container) || element?.closest(WIDGET)) {
    return undefined
  }

  // The quote is read from the page's own text, not from `selection.toString()`:
  // that one is the rendered text (uppercased by CSS, without hidden parts…),
  // which the page's text may not contain, and the anchor could not be found.
  const index = indexText(root)
  let start = textOffset(index, range.startContainer, range.startOffset)
  const end = textOffset(index, range.endContainer, range.endOffset)
  while (index.text.charAt(start) === ' ') start++
  const quote = normaliseQuote(index.text.slice(start, end))
  if (!quote) return undefined

  const copies = occurrencesOf(index.text, quote)
  const occurrence = Math.max(0, copies.indexOf(start))
  const prefix = contextOf(index, start - MAX_CONTEXT, start).trimStart()
  const after = start + quote.length
  const suffix = contextOf(index, after, after + MAX_CONTEXT).trimEnd()

  const anchor = {
    quote,
    occurrence,
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
    ...(copies.length ? { occurrences: copies.length } : {}),
    section: sectionOf(root, range),
  }
  return { anchor, range: findAnchor(index, anchor) }
}

/**
 * Where `range` starts on screen: its first character's box. The whole range's
 * box starts at its leftmost line, which is not the start once it wraps.
 */
export function startRect(range: Range): DOMRect {
  const start = range.cloneRange()
  start.collapse(true)
  const caret = start.getBoundingClientRect()
  return caret.height ? caret : range.getBoundingClientRect()
}

/** Where `quote` starts in the page text, ignoring spaces; ends after its last character. */
function looseMatches(index: TextIndex, quote: string): [number, number][] {
  const positions: number[] = []
  let compact = ''
  for (let i = 0; i < index.text.length; i++) {
    if (index.text.charAt(i) === ' ') continue
    compact += index.text.charAt(i)
    positions.push(i)
  }
  const wanted = quote.replaceAll(' ', '')
  if (!wanted) return []
  return occurrencesOf(compact, wanted).map((at) => [
    positions[at] ?? 0,
    (positions[at + wanted.length - 1] ?? 0) + 1,
  ])
}

const compact = (text: string) => text.replace(/\s+/g, '')

/**
 * Whether the page reads around the copy from `start` to `end` as it did when
 * the anchor was saved. Both sides must: one alone matches the copy before
 * once the row between them is gone. A side matches in full, or by its part
 * in the quote's own block, which changes in the next blocks leave as it was.
 * Spaces are ignored: a layout adds line breaks.
 */
function readsAround(text: string, [start, end]: [number, number], anchor: ReviewAnchor) {
  const { prefix = '', suffix = '' } = anchor
  // Twice as long: the page may have more spaces than the saved text.
  const before = compact(text.slice(Math.max(0, start - 2 * prefix.length), start))
  const after = compact(text.slice(end, end + 2 * suffix.length))
  const nearPrefix = compact(prefix.slice(prefix.lastIndexOf('\n') + 1))
  const nearSuffix = compact(suffix.split('\n')[0] ?? '')
  return (
    (before.endsWith(compact(prefix)) || (!!nearPrefix && before.endsWith(nearPrefix))) &&
    (after.startsWith(compact(suffix)) || (!!nearSuffix && after.startsWith(nearSuffix)))
  )
}

/**
 * The copy the anchor was saved on: the only one the page still reads around
 * as then; else, while the page has as many copies as then, the one at its
 * place. None rather than another copy: its own was rewritten or removed.
 */
function pick(
  text: string,
  copies: [number, number][],
  anchor: ReviewAnchor,
): [number, number] | undefined {
  const around =
    anchor.prefix || anchor.suffix
      ? copies.filter((copy) => readsAround(text, copy, anchor))
      : []
  if (around.length === 1) return around[0]
  // Saved without a count, its place is all there is to go by.
  if (anchor.occurrences !== undefined && copies.length !== anchor.occurrences)
    return undefined
  const copy = copies[anchor.occurrence]
  return copy && (around.length < 2 || around.includes(copy)) ? copy : undefined
}

function findAnchor(index: TextIndex, anchor: ReviewAnchor): Range | undefined {
  if (!anchor.quote) return undefined
  const { length } = anchor.quote
  const exact = occurrencesOf(index.text, anchor.quote).map((start): [number, number] => [
    start,
    start + length,
  ])
  // A line break between blocks depends on the layout (a span may be a block on a
  // phone only), and comments saved before it was indexed have none: match
  // without spaces rather than lose the comment.
  const copies = exact.length ? exact : looseMatches(index, anchor.quote)
  const match = pick(index.text, copies, anchor)
  return match && rangeOf(index, match[0], match[1])
}

/** Finds the live Range for a stored anchor, if its quote is still on the page. */
export function rangeFromAnchor(root: Element, anchor: ReviewAnchor): Range | undefined {
  return rangesFromAnchors(root, [anchor])[0]
}

/** `rangeFromAnchor` for several anchors, reading the page's text once. */
export function rangesFromAnchors(
  root: Element,
  anchors: ReviewAnchor[],
): (Range | undefined)[] {
  if (!anchors.some((anchor) => anchor.quote)) return anchors.map(() => undefined)
  const index = indexText(root)
  return anchors.map((anchor) => findAnchor(index, anchor))
}

/**
 * An id made per render or per load, which the next one changes: React's
 * `useId` (`:r3:`, `«r3»`, `_r_3_`, also inside Radix's `radix-:r1:`), Vue's
 * `v-0`, Downshift's `downshift-0-menu`, and a counter after a library's
 * prefix: MUI's `mui-123`, Ember's `ember42`, Headless UI's
 * `headlessui-menu-button-5`, Angular Material's `mat-input-0`. An id with
 * another colon (`loginForm:email`) is written in the code, and kept.
 */
const GENERATED_ID =
  /:r[\da-z]*:|«r[\da-z]*»|^_r_[\da-z]+_$|^v-\d[\d-]*$|^downshift-\d|^(?:mui|ember|headlessui|radix|react-aria|mat|cdk)(?:-[a-z-]*)?\d[\d-]*$/i

/** The element's own name: its test id or an id written in the code, when it has one. */
function nameStep(element: Element): string | undefined {
  const testId = element.getAttribute('data-testid')
  // Quoted as written, for the agent to search the code for; escaped otherwise.
  if (testId)
    return /["\\\n\r\f]/.test(testId)
      ? `[data-testid=${CSS.escape(testId)}]`
      : `[data-testid="${testId}"]`
  if (element.id && !GENERATED_ID.test(element.id)) return `#${CSS.escape(element.id)}`
  return undefined
}

/** Where the element sits among its parent's children. */
function positionStep(element: Element): string {
  const tag = element.tagName.toLowerCase()
  const parent = element.parentElement
  if (!parent) return tag
  const siblings = Array.from(parent.children).filter(
    (child) => child.tagName === element.tagName,
  )
  return siblings.length > 1
    ? `${tag}:nth-of-type(${siblings.indexOf(element) + 1})`
    : tag
}

/**
 * Climbs from `element` to the first test id or id that names it alone; one
 * repeated in a list names every item, so it climbs on by position.
 */
function selectorFor(root: Element, element: Element): string {
  const steps: string[] = []
  for (let node: Element | null = element; node && node !== root;) {
    const name = nameStep(node)
    if (name) {
      const selector = [name, ...steps].join(' > ')
      if (root.querySelectorAll(selector).length === 1) return selector
    }
    steps.unshift(positionStep(node))
    node = node.parentElement
  }
  return steps.join(' > ')
}

/** Describes a pointed-at element so it can be found and understood later. */
export function anchorFromElement(root: Element, element: Element): ReviewAnchor {
  const anchor: ReviewElement = {
    selector: selectorFor(root, element),
    tag: element.tagName.toLowerCase(),
    text: normaliseQuote(element.textContent ?? '').slice(0, 200),
    html: normaliseQuote(element.outerHTML).slice(0, 600),
  }
  return {
    quote: '',
    occurrence: 0,
    section: sectionOf(root, rangeAround(element)),
    element: anchor,
  }
}

/**
 * The element a stored anchor points at. Of several matches (a selector saved
 * before it was unique), the one with the saved text; none rather than a wrong
 * one. A single match is kept even if its text changed: the agent edits it.
 */
export function elementFromAnchor(
  root: Element,
  anchor: ReviewAnchor,
): Element | undefined {
  if (!anchor.element) return undefined
  const { selector, tag, text } = anchor.element
  let matches: Element[]
  try {
    matches = Array.from(root.querySelectorAll(selector))
  } catch {
    return undefined
  }
  const sameTag = matches.filter((match) => match.tagName.toLowerCase() === tag)
  if (sameTag.length === 1) return sameTag[0]
  const sameText = sameTag.filter(
    (match) => normaliseQuote(match.textContent ?? '').slice(0, 200) === text,
  )
  return sameText.length === 1 ? sameText[0] : undefined
}

/** The most elements an area records as covered, and as crossed. */
const MAX_COVERS = 10
const MAX_CROSSES = 6
/** A box this much past an edge still counts as inside: borders round. */
const SLACK = 1

export const boxOf = (element: Element): ReviewBox => {
  const { top, left, width, height } = element.getBoundingClientRect()
  return { top, left, width, height }
}

const holds = (outer: ReviewBox, inner: ReviewBox) =>
  inner.left >= outer.left - SLACK &&
  inner.top >= outer.top - SLACK &&
  inner.left + inner.width <= outer.left + outer.width + SLACK &&
  inner.top + inner.height <= outer.top + outer.height + SLACK

const overlaps = (a: ReviewBox, b: ReviewBox) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height

/**
 * The page's elements under `parent`: a `display: contents` one has no box, its
 * children do; nor has a wrapper `through` picks (a portal's).
 */
function laidOut(
  parent: Element,
  through: (element: Element) => boolean = () => false,
): { element: Element; box: ReviewBox }[] {
  return Array.from(parent.children).flatMap((element) => {
    if (element.closest(WIDGET) || element.matches(UNREAD)) return []
    const box = boxOf(element)
    if (box.width && box.height) return [{ element, box }]
    return getComputedStyle(element).display === 'contents' || through(element)
      ? laidOut(element, through)
      : []
  })
}

/** Where a box is hit-tested: its centre first, then four points around it. */
const SAMPLES = [
  [0.5, 0.5],
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
] as const

/** The points of `box` that `SAMPLES` names. */
const samplesOf = (box: ReviewBox): DrawnPoint[] =>
  SAMPLES.map(([x, y]) => ({ x: box.left + box.width * x, y: box.top + box.height * y }))

/** The page's elements painted on top in `rect`, at its centre first; none off screen. */
function paintedIn(root: Element, rect: ReviewBox): Element[] {
  return samplesOf(rect)
    .map((point) => hitAt(root, point))
    .filter((element) => element !== undefined)
}

/**
 * The element `rect` lies in: from the first element painted in it, its centre
 * first, the first element up that holds all of it, `root` when none does (a
 * dropdown smaller than it); an overlay, not the page under it, wherever it is
 * in the DOM. Where nothing is hit, by layout alone: the smallest element that
 * holds it, the later of two siblings.
 */
function holderFor(root: Element, rect: ReviewBox, painted: Element[]): Element {
  const [top] = painted
  if (top) {
    for (let element: Element | null = top; element && element !== root;) {
      if (holds(boxOf(element), rect)) return element
      element = element.parentElement
    }
    return root
  }
  let holder = root
  for (;;) {
    const child = laidOut(holder).findLast(({ box }) => holds(box, rect))
    if (!child) return holder
    holder = child.element
  }
}

/** Drawn over what is behind: a background, or an image. */
const OPAQUE = 'img, video, canvas, iframe, svg, picture, object, embed'
const clear = (color: string) =>
  !color || color === 'transparent' || /,\s*0\)$/.test(color)

/**
 * Whether `layer`, or what holds it short of the branch it shares with
 * `element`, paints over `element`: a modal's panel, not a transparent link
 * stretched over a card to make all of it a click target.
 */
function paintsOver(layer: Element, element: Element): boolean {
  for (let node: Element | null = layer; node && !node.contains(element);) {
    if (node.matches(OPAQUE)) return true
    const { backgroundColor, backgroundImage } = getComputedStyle(node)
    if (!clear(backgroundColor) || (backgroundImage && backgroundImage !== 'none'))
      return true
    node = node.parentElement
  }
  return false
}

/**
 * Whether `element` shows in `rect`: at one of a few points of its part there,
 * what is painted is itself, in it, holds it (a box that lets clicks through),
 * or does not paint over it; one that clicks go through (`pointer-events:
 * none`) shows whatever is under it. Unknown off screen, or where nothing is
 * hit: shown.
 */
function shownIn(root: Element, element: Element, box: ReviewBox, rect: ReviewBox) {
  const left = Math.max(box.left, rect.left, 0)
  const top = Math.max(box.top, rect.top, 0)
  const right = Math.min(box.left + box.width, rect.left + rect.width, window.innerWidth)
  const bottom = Math.min(
    box.top + box.height,
    rect.top + rect.height,
    window.innerHeight,
  )
  if (right <= left || bottom <= top) return true
  const part = { left, top, width: right - left, height: bottom - top }
  const covered = samplesOf(part).every((point) => {
    const hit = hitAt(root, point)
    return (
      !!hit &&
      !element.contains(hit) &&
      !hit.contains(element) &&
      paintsOver(hit, element)
    )
  })
  return !covered || getComputedStyle(element).pointerEvents === 'none'
}

/**
 * What `rect` covers in `holder`, of what shows there: the outermost elements
 * wholly inside it; the children of `holder` it cuts through, and the innermost
 * ones in them (the section, and the two buttons around a gap in it);
 * `truncated` when there were more than it keeps. A layer painted in it
 * (`painted`) is looked for past its parent's box: a dropdown that overflows it.
 */
function elementsIn(root: Element, holder: Element, rect: ReviewBox, painted: Element[]) {
  const covers: Element[] = []
  const crosses: Element[] = []
  let truncated = false
  const keep = (list: Element[], max: number, element: Element) => {
    if (list.length < max) list.push(element)
    else truncated = true
  }
  const holdsPainted = (element: Element) =>
    painted.some((hit) => element !== hit && element.contains(hit))
  // Whether `rect` cuts through an element under `parent`.
  const visit = (parent: Element): boolean => {
    let cuts = false
    for (const { element, box } of laidOut(parent, holdsPainted)) {
      if (!overlaps(rect, box)) {
        if (holdsPainted(element)) cuts = visit(element) || cuts
        continue
      }
      if (!shownIn(root, element, box, rect)) continue
      if (holds(rect, box)) keep(covers, MAX_COVERS, element)
      else {
        cuts = true
        const outer = parent === holder
        if (outer) keep(crosses, MAX_CROSSES, element)
        if (!visit(element) && !outer) keep(crosses, MAX_CROSSES, element)
      }
    }
    return cuts
  }
  visit(holder)
  return { covers, crosses, truncated }
}

/** The elements an area drawn over `rect` would record as covered. */
export function coveredBy(root: Element, rect: ReviewBox): Element[] {
  const painted = paintedIn(root, rect)
  return elementsIn(root, holderFor(root, rect, painted), rect, painted).covers
}

/** An element's text as the page shows it: a card's label and title apart, not run together. */
const shownText = (element: Element): string =>
  normaliseQuote(
    element instanceof HTMLElement ? element.innerText : (element.textContent ?? ''),
  )

function nodeOf(root: Element, element: Element): ReviewNode {
  return {
    selector: selectorFor(root, element),
    tag: element.tagName.toLowerCase(),
    text: shownText(element).slice(0, 80),
  }
}

/**
 * Describes a rectangle drawn over the page (`rect`, in viewport pixels):
 * where it is on the page, from its corner; the element it lies in, to find it
 * again on another layout; and the elements it covers or cuts through, to find
 * it in the code, those of `reach` when given, a wider box around it.
 */
export function anchorFromArea(
  root: Element,
  rect: ReviewBox,
  reach: ReviewBox = rect,
): ReviewAnchor {
  const painted = paintedIn(root, rect)
  const holder = holderFor(root, rect, painted)
  const reached = reach === rect ? painted : paintedIn(root, reach)
  const { covers, crosses, truncated } = elementsIn(
    root,
    reach === rect ? holder : holderFor(root, reach, reached),
    reach,
    reached,
  )
  const box = boxOf(holder)
  const size = { width: Math.round(box.width), height: Math.round(box.height) }
  // In the holder's content: a holder that scrolls itself moves what it holds.
  const within =
    holder !== root && size.width && size.height
      ? {
          ...nodeOf(root, holder),
          offset: {
            top: Math.round(rect.top - box.top + holder.scrollTop),
            left: Math.round(rect.left - box.left + holder.scrollLeft),
          },
          size,
        }
      : undefined
  const area: ReviewArea = {
    top: Math.round(rect.top + window.scrollY),
    left: Math.round(rect.left + window.scrollX),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
    },
    ...(within ? { within } : {}),
    covers: covers.map((element) => nodeOf(root, element)),
    crosses: crosses.map((element) => nodeOf(root, element)),
    ...(truncated ? { truncated: true as const } : {}),
  }
  return {
    quote: '',
    occurrence: 0,
    section: sectionOf(root, rangeAround(covers[0] ?? holder)),
    area,
  }
}

/** A point of a line drawn over the page, in viewport pixels. */
export interface DrawnPoint {
  x: number
  y: number
}

/** Room around a drawing's lines in its box: a stroke on the edge stays whole. */
const DRAWING_MARGIN = 8

/**
 * Room around a drawing's box in what Claude gets, on each side: a quarter of
 * its size, and this much at least, so what an arrow points at, past its tip,
 * is in.
 */
const DRAWING_REACH = 0.25
const MIN_DRAWING_REACH = 120

/**
 * `rect` with a drawing's room around it, cut to the window: what lies past
 * its edges, the reader did not see. The lines' box stays whole.
 */
function reachOf(rect: ReviewBox): ReviewBox {
  const x = Math.max(MIN_DRAWING_REACH, rect.width * DRAWING_REACH)
  const y = Math.max(MIN_DRAWING_REACH, rect.height * DRAWING_REACH)
  const left = Math.min(rect.left, Math.max(0, rect.left - x))
  const top = Math.min(rect.top, Math.max(0, rect.top - y))
  const right = Math.max(
    rect.left + rect.width,
    Math.min(window.innerWidth, rect.left + rect.width + x),
  )
  const bottom = Math.max(
    rect.top + rect.height,
    Math.min(window.innerHeight, rect.top + rect.height + y),
  )
  return { left, top, width: right - left, height: bottom - top }
}

function lengthOf(line: DrawnPoint[]): number {
  let length = 0
  let last: DrawnPoint | undefined
  for (const point of line) {
    if (last) length += Math.hypot(point.x - last.x, point.y - last.y)
    last = point
  }
  return length
}

/** How far past an arrow's tip, along its shaft, what it points at is looked for, and in which steps. */
const POINTING_REACH = 160
const POINTING_STEP = 8
/** How far back from its tip an arrow's direction is taken: its head's last wiggle aside. */
const SHAFT = 32

/** The page's element at a point, the innermost; none on the widget only. */
function hitAt(root: Element, { x, y }: DrawnPoint): Element | undefined {
  return document
    .elementsFromPoint(x, y)
    .find(
      (element) =>
        element !== root &&
        root.contains(element) &&
        !element.closest(WIDGET) &&
        !element.matches(UNREAD),
    )
}

/** Pointed at as a whole, wherever in it: a control, not what holds its label. */
const CONTROLS = 'a, button, label, summary, [role="button"], [role="link"]'

/**
 * Whether a point on `element`, the innermost there, is in a gap between what
 * it holds: a block, not a control, with blocks or boxes in it and no text of
 * its own.
 */
function isGap(element: Element): boolean {
  if (element.matches(CONTROLS) || !isBlock(element) || !laidOut(element).length)
    return false
  return !Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
  )
}

/** The direction of a line at its end, from a point `SHAFT` back along it; none for a dot. */
function directionOf(line: DrawnPoint[]): DrawnPoint | undefined {
  const end = line.at(-1)
  if (!end) return undefined
  for (const point of line.toReversed()) {
    const length = Math.hypot(end.x - point.x, end.y - point.y)
    if (length >= SHAFT || point === line[0])
      return length
        ? { x: (end.x - point.x) / length, y: (end.y - point.y) / length }
        : undefined
  }
  return undefined
}

/**
 * The element a drawing points at: under the end of its longest line, where an
 * arrow's head usually is; when that end is in a gap of a container, or on the
 * root only, the first element past it along the line's direction. Never a
 * container that holds the whole drawing (`rect`).
 */
function pointedAt(
  root: Element,
  lines: DrawnPoint[][],
  rect: ReviewBox,
): Element | undefined {
  const longest = lines.reduce<DrawnPoint[] | undefined>(
    (best, line) => (!best || lengthOf(line) > lengthOf(best) ? line : best),
    undefined,
  )
  const end = longest?.at(-1)
  if (!longest || !end) return undefined
  const hit = hitAt(root, end)
  if (hit && !isGap(hit)) return hit
  const direction = directionOf(longest)
  if (direction)
    for (let step = POINTING_STEP; step <= POINTING_REACH; step += POINTING_STEP) {
      const ahead = hitAt(root, {
        x: end.x + direction.x * step,
        y: end.y + direction.y * step,
      })
      if (ahead && !isGap(ahead)) return ahead
    }
  return hit && !holds(boxOf(hit), rect) ? hit : undefined
}

/**
 * The box of lines drawn over the page, in viewport pixels, with a margin;
 * none for lines with no point.
 */
function drawingBox(lines: DrawnPoint[][]): ReviewBox | undefined {
  const points = lines.flat()
  if (!points.length) return undefined
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const left = Math.min(...xs) - DRAWING_MARGIN
  const top = Math.min(...ys) - DRAWING_MARGIN
  return {
    left,
    top,
    width: Math.max(...xs) + DRAWING_MARGIN - left,
    height: Math.max(...ys) + DRAWING_MARGIN - top,
  }
}

/** `points` with one every `step` at most, its ends kept: a long line stays under the cap. */
function thinned(points: DrawnPoint[]): DrawnPoint[] {
  if (points.length <= MAX_STROKE_POINTS) return points
  const step = (points.length - 1) / (MAX_STROKE_POINTS - 1)
  return Array.from({ length: MAX_STROKE_POINTS }, (_, index) =>
    points.at(Math.round(index * step)),
  ).filter((point) => point !== undefined)
}

/**
 * The lines a drawing keeps, under its caps: each thinned, then the latest
 * ones, as many as the caps on strokes and on points in all allow.
 */
function keptLines(lines: DrawnPoint[][]): DrawnPoint[][] {
  const kept: DrawnPoint[][] = []
  let points = 0
  for (const line of lines.toReversed()) {
    if (!line.length) continue
    const thin = thinned(line)
    if (kept.length === MAX_STROKES || points + thin.length > MAX_DRAWING_POINTS) break
    kept.unshift(thin)
    points += thin.length
  }
  return kept
}

const surface = (element: Element) => {
  const { width, height } = boxOf(element)
  return width * height
}

/**
 * The element lines are placed from: the largest wholly in their box `rect`,
 * of those `coveredBy` keeps, else the one they point at (`target`). A dropdown
 * of a fixed width moves with the layout but does not narrow with its holder.
 * Several that move apart: the lines follow this one.
 */
function drawnAround(root: Element, rect: ReviewBox, target: Element | undefined) {
  const element =
    coveredBy(root, rect).reduce<Element | undefined>(
      (largest, covered) =>
        !largest || surface(covered) > surface(largest) ? covered : largest,
      undefined,
    ) ?? target
  const box = element && boxOf(element)
  if (!element || !box?.width || !box.height) return undefined
  return {
    ...nodeOf(root, element),
    offset: {
      top: Math.round(rect.top - box.top),
      left: Math.round(rect.left - box.left),
    },
    size: { width: Math.round(box.width), height: Math.round(box.height) },
  }
}

/**
 * Describes lines drawn freehand over the page (in viewport pixels) as an
 * area, the box of the lines it keeps (`rect`, in viewport pixels), which
 * records what they lie in as a rectangle does, with the lines from its
 * corner. What they cover and cross is that of `reach`, a wider box,
 * `pointsAt` is the element they point at, and `around` the one they are
 * placed from.
 */
export function anchorFromDrawing(
  root: Element,
  lines: DrawnPoint[][],
):
  | {
      anchor: ReviewAnchor
      rect: ReviewBox
      reach: ReviewBox
      strokes: ReviewStroke[]
    }
  | undefined {
  const kept = keptLines(lines)
  const rect = drawingBox(kept)
  if (!rect) return undefined
  const reach = reachOf(rect)
  const anchor = anchorFromArea(root, rect, reach)
  const target = pointedAt(root, kept, rect)
  const around = drawnAround(root, rect, target)
  const strokes = kept.map((line) =>
    line.map(({ x, y }): [number, number] => [
      Math.round(x - rect.left),
      Math.round(y - rect.top),
    ]),
  )
  const area = anchor.area && {
    ...anchor.area,
    strokes,
    ...(target ? { pointsAt: nodeOf(root, target) } : {}),
    ...(around ? { around } : {}),
  }
  return {
    anchor: area ? { ...anchor, area } : anchor,
    rect,
    reach,
    strokes,
  }
}

function nodeIn(root: Element, node: ReviewNode | undefined): Element | undefined {
  if (!node) return undefined
  try {
    return root.querySelector(node.selector) ?? undefined
  } catch {
    return undefined
  }
}

/** The element the area was drawn in, when it is on the page. */
export const holderOf = (root: Element, area: ReviewArea) => nodeIn(root, area.within)

/** The element a drawing is placed from, when it is on the page. */
export const aroundOf = (root: Element, area: ReviewArea) => nodeIn(root, area.around)

/** `element`'s box while it is laid out: none once gone or hidden. */
function shownBox(element: Element | undefined) {
  const box = element && boxOf(element)
  return box?.width && box.height ? box : undefined
}

/**
 * Where the area is now, in viewport pixels. A drawing, from the element it
 * is placed from (`around`) while it shows, which may have moved since; its
 * left offset and width follow that element's width, not its height: a list
 * of a fixed width keeps them, text that wraps narrows them. Else in the element it was drawn in, which may have moved
 * or scrolled since; its width follows the holder's (a narrower window), its
 * height does not (content added further down). Without either, where it was
 * on the page.
 */
export function rectFromArea(
  area: ReviewArea,
  holder?: Element,
  around?: Element,
): ReviewBox {
  const pin = area.around && shownBox(around)
  if (area.around && pin) {
    const { offset, size } = area.around
    const scale = pin.width / size.width
    return {
      top: pin.top + offset.top,
      left: pin.left + offset.left * scale,
      width: area.width * scale,
      height: area.height,
    }
  }
  const box = holder && boxOf(holder)
  if (area.within && holder && box?.width && box.height) {
    const { offset, size } = area.within
    const scale = box.width / size.width
    return {
      top: box.top + offset.top - holder.scrollTop,
      left: box.left + offset.left * scale - holder.scrollLeft,
      width: area.width * scale,
      height: area.height,
    }
  }
  return {
    top: area.top - window.scrollY,
    left: area.left - window.scrollX,
    width: area.width,
    height: area.height,
  }
}

/**
 * Where to frame the area now: as `rectFromArea`, but nowhere while the
 * element a drawing is placed from is hidden (a closed dropdown), nor while the
 * element it was drawn in is gone or hidden (a closed modal, another tab) and
 * no `around` shows: its old place would frame something else. An `around`
 * gone from the page leaves it to its holder.
 */
export function framedArea(
  area: ReviewArea,
  holder?: Element,
  around?: Element,
): ReviewBox | undefined {
  const pinned = area.around && shownBox(around)
  if (area.around && around && !pinned) return undefined
  if (area.within && !shownBox(holder) && !pinned) return undefined
  return rectFromArea(area, holder, around)
}

/**
 * True once the page shows enough to place the area: its holder laid out, or,
 * without one, the page as tall as the area's bottom.
 */
export function areaReady(root: Element, area: ReviewArea): boolean {
  if (area.within) return !!holderOf(root, area)?.getBoundingClientRect().height
  return document.documentElement.scrollHeight >= area.top + area.height
}

/** Scrolls the page to the area: centred, or its top in view when it is taller than the window. */
export function scrollToArea(root: Element, area: ReviewArea): void {
  const rect = rectFromArea(area, holderOf(root, area), aroundOf(root, area))
  const margin = 40
  const top =
    rect.height > window.innerHeight - 2 * margin
      ? rect.top - margin
      : rect.top + rect.height / 2 - window.innerHeight / 2
  window.scrollBy({ top, behavior: scrollBehavior() })
}
