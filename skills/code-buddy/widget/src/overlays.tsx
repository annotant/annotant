import {
  type CSSProperties,
  Fragment,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  boxOf,
  coveredBy,
  elementFromAnchor,
  framedArea,
  holderOf,
  rangesFromAnchors,
  startRect,
} from './anchors'
import {
  type ReviewArea,
  type ReviewBox,
  gist,
  type ReviewComment,
  wasResolved,
} from './domain'
import { setInlineStyle } from './inline'
import { RAINBOW_PERIOD } from './styles'
import { Icon } from './ui'

const WIDGET = '[data-code-buddy]'

type Box = ReviewBox

type Corners = Pick<
  CSSProperties,
  | 'borderTopLeftRadius'
  | 'borderTopRightRadius'
  | 'borderBottomRightRadius'
  | 'borderBottomLeftRadius'
>

/** The rounded corners of `element`, for a frame on its box. */
const cornersOf = (element: Element): Corners => {
  const style = getComputedStyle(element)
  return {
    borderTopLeftRadius: style.borderTopLeftRadius || '0px',
    borderTopRightRadius: style.borderTopRightRadius || '0px',
    borderBottomRightRadius: style.borderBottomRightRadius || '0px',
    borderBottomLeftRadius: style.borderBottomLeftRadius || '0px',
  }
}

interface Edges {
  top: number
  left: number
  right: number
  bottom: number
}

/** Whether a side of a box shows from `from` to `to`: with no `size`, at a point. */
const shows = (from: number, to: number, size: number) => (size ? to > from : to >= from)

/** The part of `box` inside `clip`, if any: a box with no size shows where it is. */
function within(box: Box, clip: Edges): Box | undefined {
  const top = Math.max(box.top, clip.top)
  const left = Math.max(box.left, clip.left)
  const bottom = Math.min(box.top + box.height, clip.bottom)
  const right = Math.min(box.left + box.width, clip.right)
  return shows(top, bottom, box.height) && shows(left, right, box.width)
    ? { top, left, width: right - left, height: bottom - top }
    : undefined
}

/** An ancestor that cuts what overflows it, on one axis or both. */
interface Clipper {
  element: Element
  x: boolean
  y: boolean
}

const cuts = (overflow: string) => overflow !== '' && overflow !== 'visible'

/** Whether its element holds its fixed descendants, as it holds its absolute ones. */
const holdsFixed = (style: CSSStyleDeclaration) =>
  [style.transform, style.filter, style.perspective].some(
    (value) => value && value !== 'none',
  ) ||
  /paint|layout|strict|content/.test(style.contain) ||
  /transform|filter|perspective/.test(style.willChange)

/**
 * What cuts what `element` holds: `element` and each ancestor that clips its
 * overflow (a scrolling sidebar, a list) and contains it, up to `body`, whose
 * overflow is the viewport's. `position` is that of what it holds: absolute
 * or fixed, it escapes the ancestors that do not contain it. Read with the
 * page's changes, not on every scroll: a scroll leaves them as they are.
 */
function clippersOf(element: Element | null, position = 'static'): Clipper[] {
  const clippers: Clipper[] = []
  for (
    let ancestor = element;
    ancestor && ancestor !== document.body && ancestor !== document.documentElement;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor)
    const contains =
      position === 'fixed'
        ? holdsFixed(style)
        : position !== 'absolute' || style.position !== 'static' || holdsFixed(style)
    if (!contains) continue
    position = style.position
    // Overflow cuts nothing on an inline box (a truncated `span`), nor on no box.
    if (style.display === 'inline' || style.display === 'contents') continue
    const x = cuts(style.overflowX)
    const y = cuts(style.overflowY)
    if (x || y) clippers.push({ element: ancestor, x, y })
  }
  return clippers
}

/** Where what `clippers` cut shows on screen: the viewport, cut by their padding boxes. */
function clipOf(clippers: Clipper[]): Edges {
  const clip = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight }
  for (const { element, x, y } of clippers) {
    const rect = element.getBoundingClientRect()
    // Its padding box, scaled as its box is: its border and scrollbars hide what scrolls too.
    const scaled =
      element instanceof HTMLElement && element.offsetWidth && element.offsetHeight
    const scaleX = scaled ? rect.width / element.offsetWidth : 1
    const scaleY = scaled ? rect.height / element.offsetHeight : 1
    if (x) {
      const left = rect.left + element.clientLeft * scaleX
      clip.left = Math.max(clip.left, left)
      clip.right = Math.min(clip.right, left + element.clientWidth * scaleX)
    }
    if (y) {
      const top = rect.top + element.clientTop * scaleY
      clip.top = Math.max(clip.top, top)
      clip.bottom = Math.min(clip.bottom, top + element.clientHeight * scaleY)
    }
  }
  return clip
}

const sameBox = (a?: Box, b?: Box) =>
  !!a &&
  !!b &&
  a.top === b.top &&
  a.left === b.left &&
  a.width === b.width &&
  a.height === b.height

/**
 * `measure(find(root, comments))`, kept in step with the page: `find` runs
 * again when the page changes (nodes, text, attributes such as the padding a
 * docked panel adds), `measure` alone on scroll and resize, once per frame.
 */
function useTracked<Found, Measured>(
  root: Element,
  comments: ReviewComment[],
  find: (root: Element, comments: ReviewComment[]) => Found,
  measure: (found: Found) => Measured[],
): Measured[] {
  const [measured, setMeasured] = useState<Measured[]>([])
  useEffect(() => {
    let found: { value: Found } | undefined
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!found) found = { value: find(root, comments) }
        setMeasured(measure(found.value))
      })
    }
    const changed = () => {
      found = undefined
      update()
    }
    update()
    const observer = new MutationObserver(changed)
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
    // The docked panel squeezes the page through `html`'s padding.
    observer.observe(document.documentElement, { attributes: true })
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
    }
  }, [root, comments, find, measure])
  return measured
}

interface Mark {
  comment: ReviewComment
  /** The element's box. */
  frame: Box
  /** The part of it that shows, out of the scrolling boxes that hide the rest. */
  shown: Box
  corners: Corners
}

function findElements(root: Element, comments: ReviewComment[]) {
  return comments.flatMap((comment) => {
    if (wasResolved(comment)) return []
    const element = elementFromAnchor(root, comment.anchor)
    // Read with the page's changes, not on every scroll: a scroll leaves them as they are.
    if (!element) return []
    const { position } = getComputedStyle(element)
    const clippers = clippersOf(element.parentElement, position)
    return [{ comment, element, corners: cornersOf(element), clippers }]
  })
}

function measureElements(found: ReturnType<typeof findElements>): Mark[] {
  return found.flatMap(({ comment, element, corners, clippers }) => {
    const frame = boxOf(element)
    const shown = within(frame, clipOf(clippers))
    return shown ? [{ comment, frame, shown, corners }] : []
  })
}

/**
 * Frames around the elements that open comments point at, until their thread
 * is first resolved: a follow-up, often about something else, does not bring
 * them back. A bubble on each opens the comment's thread.
 */
export function ElementMarks({
  root,
  comments,
  onOpen,
}: {
  root: Element
  comments: ReviewComment[]
  onOpen: (comment: ReviewComment) => void
}) {
  const marks = useTracked(root, comments, findElements, measureElements)

  return (
    <>
      {marks.map(({ comment, frame, shown, corners }) => (
        <Fragment key={comment.id}>
          {/* The frame, cut to the part of the element that shows. */}
          <div className="cb-clip" style={shown}>
            <div
              className="cb-mark"
              style={{
                top: frame.top - shown.top,
                left: frame.left - shown.left,
                width: frame.width,
                height: frame.height,
                ...corners,
              }}
            />
          </div>
          {/* On its top left corner, the tail towards it: on the part that shows. */}
          <button
            type="button"
            className="cb-quote-pin cb-live"
            style={{ top: shown.top, left: shown.left }}
            aria-label={`Open the comment on <${comment.anchor.element?.tag ?? 'element'}>`}
            title={gist(comment.messages[0])}
            onClick={() => onOpen(comment)}
          >
            <Icon name="chat" />
          </button>
        </Fragment>
      ))}
    </>
  )
}

interface AreaMark {
  comment: ReviewComment
  /** The area's box. */
  frame: Box
  /** The part of it that shows, out of the scrolling boxes that hide the rest. */
  shown: Box
}

function findAreas(root: Element, comments: ReviewComment[]) {
  return comments.flatMap((comment) => {
    const { area } = comment.anchor
    if (wasResolved(comment) || !area) return []
    const holder = holderOf(root, area)
    return [{ comment, area, holder, clippers: clippersOf(holder ?? null) }]
  })
}

function measureAreas(found: ReturnType<typeof findAreas>): AreaMark[] {
  return found.flatMap(({ comment, area, holder, clippers }) => {
    const frame = framedArea(area, holder)
    const shown = frame && within(frame, clipOf(clippers))
    return shown ? [{ comment, frame, shown }] : []
  })
}

/**
 * Frames around the areas comments were drawn on, as around an element,
 * until their thread is first resolved; a bubble on each opens its thread.
 */
export function AreaMarks({
  root,
  comments,
  onOpen,
}: {
  root: Element
  comments: ReviewComment[]
  onOpen: (comment: ReviewComment) => void
}) {
  const marks = useTracked(root, comments, findAreas, measureAreas)

  return (
    <>
      {marks.map(({ comment, frame, shown }) => (
        <Fragment key={comment.id}>
          <div className="cb-clip" style={shown}>
            <div
              className="cb-mark cb-mark--area"
              data-testid="cb-area-mark"
              style={{
                top: frame.top - shown.top,
                left: frame.left - shown.left,
                width: frame.width,
                height: frame.height,
              }}
            />
          </div>
          <button
            type="button"
            className="cb-quote-pin cb-live"
            style={{ top: shown.top, left: shown.left }}
            aria-label="Open the comment on the drawn area"
            title={gist(comment.messages[0])}
            onClick={() => onOpen(comment)}
          >
            <Icon name="frame" />
          </button>
        </Fragment>
      ))}
    </>
  )
}

interface QuotePin {
  comment: ReviewComment
  /** One box per line of the quote, behind its text, cut to where it shows. */
  lines: Box[]
  /** Its bubble, if a part of the quote shows. */
  bubble: { top: number; left: number } | undefined
}

interface TextPart {
  range: Range
  clippers: Clipper[]
}

/** The text `range` covers, node by node, each with what cuts it: not the elements it spans. */
function textParts(
  range: Range,
  clippers: (element: Element | null) => Clipper[],
): TextPart[] {
  const ancestor = range.commonAncestorContainer
  const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  if (ancestor instanceof Text) texts.push(ancestor)
  while (walker.nextNode()) {
    if (walker.currentNode instanceof Text && range.intersectsNode(walker.currentNode)) {
      texts.push(walker.currentNode)
    }
  }
  return texts.map((text) => {
    const part = document.createRange()
    part.selectNodeContents(text)
    if (text === range.startContainer) part.setStart(text, range.startOffset)
    if (text === range.endContainer) part.setEnd(text, range.endOffset)
    return { range: part, clippers: clippers(text.parentElement) }
  })
}

/** The ranges of the comments on a text never resolved, read from the page's text once. */
function findQuotes(root: Element, comments: ReviewComment[]) {
  const quoted = comments.filter(
    (comment) => !wasResolved(comment) && !comment.anchor.element && comment.anchor.quote,
  )
  const ranges = rangesFromAnchors(
    root,
    quoted.map((comment) => comment.anchor),
  )
  // Texts side by side share what cuts them.
  const read = new Map<Element | null, Clipper[]>()
  const clippers = (element: Element | null) => {
    const known = read.get(element) ?? clippersOf(element)
    read.set(element, known)
    return known
  }
  return quoted.flatMap((comment, i) => {
    const range = ranges[i]
    if (!range) return []
    const { startContainer: start } = range
    const startClippers = clippers(start instanceof Element ? start : start.parentElement)
    return [{ comment, range, parts: textParts(range, clippers), startClippers }]
  })
}

/** Under this luminance, the page is dark: a rainbow lightens it rather than tints it. */
const DARK = 0.4

/** The page's background, from the first of `body` and `html` that has one. */
function pageIsDark(): boolean {
  for (const element of [document.body, document.documentElement]) {
    const channels = getComputedStyle(element)
      .backgroundColor.match(/[\d.]+/g)
      ?.map(Number)
    const [r = 0, g = 0, b = 0, alpha = 1] = channels ?? []
    if (!channels || alpha === 0) continue
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < DARK
  }
  return false
}

/**
 * A layer in the page itself, over its content: the shadow root's stacking
 * context would blend the rainbow with the widget alone, and so tint the text
 * above it. Blended with the page, it colours the background and leaves dark
 * text dark (light text light, on a dark page).
 */
function usePageLayer() {
  const [layer] = useState(() => {
    const element = document.createElement('div')
    element.setAttribute('data-code-buddy', '')
    element.className = 'code-buddy-layer'
    return element
  })
  useEffect(() => {
    // Out of `body`, the root the marks watch: its changes would measure them again, and again.
    document.documentElement.append(layer)
    const theme = () => layer.toggleAttribute('data-dark', pageIsDark())
    theme()
    const observer = new MutationObserver(theme)
    for (const target of [document.documentElement, document.body]) {
      observer.observe(target, { attributes: true })
    }
    return () => {
      observer.disconnect()
      layer.remove()
    }
  }, [layer])
  return layer
}

/** Width of a bubble and its gap: the next one on the same spot sits beside it. */
const PIN_STEP = 26

/**
 * The lines of each quote, and its bubble where it starts, where its Comment
 * button was; its start out of sight, on its first line that shows.
 */
function measureQuotes(found: ReturnType<typeof findQuotes>): QuotePin[] {
  const clips = new Map<Clipper[], Edges>()
  const clip = (clippers: Clipper[]) => {
    const known = clips.get(clippers) ?? clipOf(clippers)
    clips.set(clippers, known)
    return known
  }
  const spots: { top: number; left: number }[] = []
  const pins: QuotePin[] = []
  for (const { comment, range, parts, startClippers } of found) {
    const start = startRect(range)
    if (!start.height) continue
    const lines = parts.flatMap(({ range: part, clippers }) =>
      Array.from(part.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .flatMap((rect) => within(rect, clip(clippers)) ?? []),
    )
    const shown = within(start, clip(startClippers))
    const spot = shown?.height === start.height ? start : lines[0]
    const bubble = spot && {
      top: spot.top,
      left:
        spot.left +
        spots.filter(({ top, left }) => top === spot.top && left === spot.left).length *
          PIN_STEP,
    }
    if (spot) spots.push({ top: spot.top, left: spot.left })
    pins.push({ comment, lines, bubble })
  }
  return pins
}

/**
 * A rainbow behind each commented text, until its thread is first resolved, and a
 * bubble above its start, which opens the comment's thread.
 */
export function QuoteBubbles({
  root,
  comments,
  onOpen,
}: {
  root: Element
  comments: ReviewComment[]
  onOpen: (comment: ReviewComment) => void
}) {
  const pins = useTracked(root, comments, findQuotes, measureQuotes)
  const layer = usePageLayer()

  return (
    <>
      {createPortal(
        pins.flatMap(({ comment, lines }) =>
          lines.map((line) => (
            <div
              key={`${comment.id}:${line.top}:${line.left}`}
              className="code-buddy-quote-mark"
              style={{
                top: line.top,
                left: line.left,
                width: line.width,
                height: line.height,
              }}
            >
              {/* Laid from the viewport's corner, as every line's: they carry on from each other. */}
              <div style={{ left: -line.left - RAINBOW_PERIOD, top: -line.top }} />
            </div>
          )),
        ),
        layer,
      )}
      {pins.flatMap(({ comment, bubble }) =>
        bubble ? (
          <button
            key={comment.id}
            type="button"
            className="cb-quote-pin cb-live"
            style={bubble}
            aria-label={`Open the comment on “${comment.anchor.quote}”`}
            title={gist(comment.messages[0])}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onOpen(comment)}
          >
            <Icon name="chat" />
          </button>
        ) : (
          []
        ),
      )}
    </>
  )
}

/** The box `measure` gives, once per frame, while it is on screen. */
function useOnScreen(measure: () => Box | undefined): Box | undefined {
  const [box, setBox] = useState<Box>()

  useEffect(() => {
    let frame = 0
    const track = () => {
      const next = measure()
      const onScreen =
        next &&
        next.width > 0 &&
        next.height > 0 &&
        next.top + next.height > 0 &&
        next.left + next.width > 0 &&
        next.top < window.innerHeight &&
        next.left < window.innerWidth
      setBox((current) =>
        !onScreen ? undefined : sameBox(current, next) ? current : next,
      )
      frame = requestAnimationFrame(track)
    }
    track()
    return () => cancelAnimationFrame(frame)
  }, [measure])

  return box
}

/** Outlines `element` while it is on screen, following scroll and layout. */
export function TargetOutline({ element }: { element: Element }) {
  const measure = useCallback(
    () => (element.isConnected ? boxOf(element) : undefined),
    [element],
  )
  const box = useOnScreen(measure)
  if (!box) return null
  return (
    <div
      className="cb-outline"
      data-testid="cb-target"
      style={{ ...box, ...cornersOf(element) }}
    />
  )
}

/** Outlines a drawn area while it is on screen, in the element it was drawn in. */
export function AreaOutline({ root, area }: { root: Element; area: ReviewArea }) {
  const measure = useCallback(() => framedArea(area, holderOf(root, area)), [root, area])
  const box = useOnScreen(measure)
  if (!box) return null
  return (
    <div
      className="cb-outline cb-outline--area"
      data-testid="cb-area-target"
      style={box}
    />
  )
}

/** The events of a press, from pointerdown to click. */
const PRESSES = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const

/** How long the pointer stays on an element before the outline moves to it. */
export const HOVER_DWELL_MS = 50

/**
 * Dashed outline follows the pointer, gliding from one element to the next
 * once the pointer stays on it; a click picks the element, Escape cancels.
 */
export function ElementPicker({
  root,
  hint = 'Click an element to comment on it. Escape cancels.',
  onPick,
  onCancel,
}: {
  root: Element
  hint?: string
  onPick: (element: Element) => void
  onCancel: () => void
}) {
  // The last element hovered: the outline stays on it, faded out, until the next.
  const [hovered, setHovered] = useState<Element>()
  // Whether the pointer is on an element: off one (a gap, the widget), the outline fades out.
  const [over, setOver] = useState(false)
  // After a scroll, the outline stays on its element: it moves at once.
  const [scrolled, setScrolled] = useState(false)
  const [, setTick] = useState(0)

  useEffect(() => {
    // The element the pointer is on, until it has stayed there long enough.
    let next: Element | undefined
    let dwell = 0
    const target = (event: MouseEvent) => {
      const element = document.elementFromPoint(event.clientX, event.clientY)
      return element &&
        root.contains(element) &&
        element !== root &&
        !element.closest(WIDGET)
        ? element
        : undefined
    }
    const onMove = (event: MouseEvent) => {
      const element = target(event)
      if (element === next) return
      next = element
      clearTimeout(dwell)
      dwell = window.setTimeout(() => {
        if (element) setHovered(element)
        setOver(!!element)
        setScrolled(false)
      }, HOVER_DWELL_MS)
    }
    // The page gets no press on the element being picked, nor its default
    // (focus, a menu opening on pointerdown, a drag): the click only picks.
    const onPress = (event: MouseEvent) => {
      const element = target(event)
      if (!element) return
      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'click') onPick(element)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    const onScroll = () => {
      setScrolled(true)
      setTick((tick) => tick + 1)
    }
    document.addEventListener('mousemove', onMove)
    for (const type of PRESSES) window.addEventListener(type, onPress, true)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    const restoreCursor = setInlineStyle(document.documentElement, 'cursor', 'crosshair')
    return () => {
      clearTimeout(dwell)
      document.removeEventListener('mousemove', onMove)
      for (const type of PRESSES) window.removeEventListener(type, onPress, true)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
      restoreCursor()
    }
  }, [root, onPick, onCancel])

  // An element gone from the page has no box: the outline leaves with it.
  const shown = hovered?.isConnected ? hovered : undefined
  const rect = shown?.getBoundingClientRect()
  return (
    <>
      <div className="cb-hint">{hint}</div>
      {shown && rect && (
        <div
          className="cb-hover"
          data-instant={scrolled || undefined}
          data-hidden={!over || undefined}
          style={{
            transform: `translate(${rect.left}px, ${rect.top}px)`,
            width: rect.width,
            height: rect.height,
            // Its shape too: the outline morphs to its rounded corners.
            ...cornersOf(shown),
          }}
        >
          <span>{shown.tagName.toLowerCase()}</span>
        </div>
      )}
    </>
  )
}

/** Under this many pixels a side, a drag is a slip, not an area. */
const MIN_SIDE = 8

interface Point {
  x: number
  y: number
}

interface Drag {
  start: Point
  end: Point
  /** Where the pointer is in the viewport, to follow a scroll. */
  pointer: Point
}

/** The box between two corners on the page, in viewport pixels. */
function boxBetween(start: Point, end: Point): Box {
  const left = Math.min(start.x, end.x) - window.scrollX
  const top = Math.min(start.y, end.y) - window.scrollY
  return {
    left,
    top,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

/**
 * The reader drags a rectangle over the page; the rest of the page dims, and
 * the elements it covers are outlined as it grows. Scrolling the page while
 * dragging extends it past the window. Escape cancels.
 */
export function AreaDrawer({
  root,
  onDraw,
  onCancel,
}: {
  root: Element
  onDraw: (rect: Box) => void
  onCancel: () => void
}) {
  // Both corners on the page, not in the viewport: the page may scroll under the drag.
  const [drag, setDrag] = useState<Drag>()
  const latest = useRef<Drag>(undefined)
  const [covered, setCovered] = useState<Box[]>([])
  const box = drag && boxBetween(drag.start, drag.end)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const dragging = !!drag
  useEffect(() => {
    if (!dragging) return undefined
    const follow = (pointer: Point) => {
      const current = latest.current
      if (!current) return undefined
      const next = {
        start: current.start,
        end: { x: pointer.x + window.scrollX, y: pointer.y + window.scrollY },
        pointer,
      }
      latest.current = next
      setDrag(next)
      return next
    }
    const onMove = (event: MouseEvent) => follow({ x: event.clientX, y: event.clientY })
    const onScroll = () => latest.current && follow(latest.current.pointer)
    const onUp = (event: MouseEvent) => {
      const done = follow({ x: event.clientX, y: event.clientY })
      latest.current = undefined
      setDrag(undefined)
      const rect = done && boxBetween(done.start, done.end)
      if (rect && rect.width >= MIN_SIDE && rect.height >= MIN_SIDE) onDraw(rect)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [dragging, onDraw])

  // What the area will record, outlined as it grows: once per frame at most.
  const left = box?.left
  const top = box?.top
  const width = box?.width
  const height = box?.height
  const sized = left !== undefined && top !== undefined && !!width && !!height
  useEffect(() => {
    if (left === undefined || top === undefined || !width || !height) return undefined
    const frame = requestAnimationFrame(() => {
      setCovered(coveredBy(root, { left, top, width, height }).map(boxOf))
    })
    return () => cancelAnimationFrame(frame)
  }, [root, left, top, width, height])

  const start = (event: ReactMouseEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    const pointer = { x: event.clientX, y: event.clientY }
    const point = { x: pointer.x + window.scrollX, y: pointer.y + window.scrollY }
    setCovered([])
    latest.current = { start: point, end: point, pointer }
    setDrag(latest.current)
  }

  return (
    <div className="cb-draw cb-live" data-testid="cb-draw" onMouseDown={start}>
      {!box && (
        <div className="cb-hint">
          Drag over the page to frame an area. Scroll to stretch it; Escape cancels.
        </div>
      )}
      {(sized ? covered : []).map((part) => (
        <div
          key={`${part.top}:${part.left}:${part.width}:${part.height}`}
          className="cb-draw-covered"
          style={{
            top: part.top,
            left: part.left,
            width: part.width,
            height: part.height,
          }}
        />
      ))}
      {box && (
        <div
          className="cb-draw-box"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
        >
          <span>
            {Math.round(box.width)} × {Math.round(box.height)}
          </span>
        </div>
      )}
    </div>
  )
}
