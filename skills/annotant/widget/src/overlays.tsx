import {
  type CSSProperties,
  Fragment,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  boxOf,
  coveredBy,
  type DrawnPoint,
  elementFromAnchor,
  aroundOf,
  framedArea,
  holderOf,
  rangesFromAnchors,
  startRect,
} from './anchors'
import {
  type ReviewArea,
  type ReviewBox,
  gist,
  markedElement,
  outdated,
  pickedMark,
  type ReviewComment,
  wasResolved,
} from './domain'
import { type Clipper, clipOf, clippersOf, type Edges, within } from './clips'
import { setInlineStyle } from './inline'
import { RAINBOW, RAINBOW_PERIOD, REDUCED_MOTION, scrollBehavior } from './styles'
import { fieldOf } from './shortcuts'
import { Icon } from './ui'

const WIDGET = '[data-annotant]'

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
 * docked panel adds), `measure` alone on scroll, on resize and when `root` or
 * an element `anchors` gives changes size (a docked panel squeezing the page,
 * an image loading) and when a font loads, once per frame.
 */
function useTracked<Found, Measured>(
  root: Element,
  comments: ReviewComment[],
  find: (root: Element, comments: ReviewComment[]) => Found,
  measure: (found: Found) => Measured[],
  anchors: (found: Found) => (Element | null | undefined)[],
): Measured[] {
  const [measured, setMeasured] = useState<Measured[]>([])
  useEffect(() => {
    let found: { value: Found } | undefined
    let frame = 0
    // The anchors observed: one observed again would be measured again for nothing.
    let observed = new Set<Element>()
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!found) {
          found = { value: find(root, comments) }
          const next = new Set(anchors(found.value).filter((anchor) => !!anchor))
          for (const anchor of observed) if (!next.has(anchor)) resized.unobserve(anchor)
          for (const anchor of next) if (!observed.has(anchor)) resized.observe(anchor)
          observed = next
        }
        setMeasured(measure(found.value))
      })
    }
    // Layout moves what no mutation tells: an animation, an image loading.
    const resized = new ResizeObserver(update)
    resized.observe(root)
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
    // A font moves text within boxes that keep their size.
    document.fonts?.addEventListener('loadingdone', update)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      resized.disconnect()
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
      document.fonts?.removeEventListener('loadingdone', update)
    }
  }, [root, comments, find, measure, anchors])
  return measured
}

interface Mark {
  comment: ReviewComment
  /** The element's tag, for the bubble's name. */
  tag: string
  /** The element's box. */
  frame: Box
  /** The part of it that shows, out of the scrolling boxes that hide the rest. */
  shown: Box
  corners: Corners
}

function findElements(root: Element, comments: ReviewComment[]) {
  return comments.flatMap((comment) => {
    const marked = markedElement(comment, window.location.pathname)
    const element =
      marked && elementFromAnchor(root, { ...comment.anchor, element: marked })
    // Read with the page's changes, not on every scroll: a scroll leaves them as they are.
    if (!marked || !element) return []
    const { position } = getComputedStyle(element)
    const clippers = clippersOf(element.parentElement, position)
    const { tag } = marked
    return [{ comment, tag, element, corners: cornersOf(element), clippers }]
  })
}

const elementsOf = (found: ReturnType<typeof findElements>) =>
  found.map(({ element }) => element)

function measureElements(found: ReturnType<typeof findElements>): Mark[] {
  return found.flatMap(({ comment, tag, element, corners, clippers }) => {
    const frame = boxOf(element)
    const shown = within(frame, clipOf(clippers))
    return shown ? [{ comment, tag, frame, shown, corners }] : []
  })
}

/**
 * Frames around the elements that open comments point at, until their thread
 * is first resolved: a follow-up, often about something else, does not bring
 * them back, unless it picks an element, which is then framed in their place.
 * A bubble on each opens the comment's thread.
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
  const marks = useTracked(root, comments, findElements, measureElements, elementsOf)

  return (
    <>
      {marks.map(({ comment, tag, frame, shown, corners }) => (
        <Fragment key={comment.id}>
          {/* The frame, cut to the part of the element that shows. */}
          <div className="an-clip" style={shown}>
            <div
              className="an-mark"
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
            className="an-quote-pin an-live"
            style={{ top: shown.top, left: shown.left }}
            aria-label={`Open the comment on <${tag}>`}
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

/**
 * The lines drawn freehand in an area, over its whole box: they stretch with
 * it, as its width follows the element it lies in. With `rainbow`, the id of
 * its gradient, they carry the rainbow of a comment in progress, turning.
 */
function Strokes({ area, rainbow }: { area: ReviewArea; rainbow?: string | undefined }) {
  if (!area.strokes?.length) return null
  const { width, height } = area
  // Its ends a diagonal apart, the gradient covers the box as it turns.
  const half = Math.hypot(width, height) / 2
  const turning = !matchMedia(REDUCED_MOTION).matches
  return (
    <svg
      className="an-strokes"
      data-testid="an-strokes"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={rainbow ? { stroke: `url(#${rainbow})` } : undefined}
    >
      {rainbow && (
        <defs>
          <linearGradient
            id={rainbow}
            gradientUnits="userSpaceOnUse"
            x1={width / 2 - half}
            y1={height / 2}
            x2={width / 2 + half}
            y2={height / 2}
          >
            {RAINBOW.map((color, at) => (
              <stop
                // oxlint-disable-next-line react/no-array-index-key -- the first colour comes back last
                key={at}
                offset={at / (RAINBOW.length - 1)}
                stopColor={color}
              />
            ))}
            {turning && (
              <animateTransform
                attributeName="gradientTransform"
                type="rotate"
                from={`0 ${width / 2} ${height / 2}`}
                to={`360 ${width / 2} ${height / 2}`}
                dur="3s"
                repeatCount="indefinite"
              />
            )}
          </linearGradient>
        </defs>
      )}
      {area.strokes.map((stroke, place) => (
        <polyline
          // oxlint-disable-next-line react/no-array-index-key -- the strokes never change once drawn
          key={place}
          points={(stroke.length > 1 ? stroke : [...stroke, ...stroke]).join(' ')}
        />
      ))}
    </svg>
  )
}

interface AreaMark {
  comment: ReviewComment
  area: ReviewArea
  /** The area's box. */
  frame: Box
  /** The part of it that shows, out of the scrolling boxes that hide the rest. */
  shown: Box
}

function findAreas(root: Element, comments: ReviewComment[]) {
  return comments.flatMap((comment) => {
    const { area } = comment.anchor
    // An element picked since takes the area's place.
    if (wasResolved(comment) || !area || pickedMark(comment)) return []
    const holder = holderOf(root, area)
    const around = aroundOf(root, area)
    return [{ comment, area, holder, around, clippers: clippersOf(holder ?? null) }]
  })
}

const holdersOf = (found: ReturnType<typeof findAreas>) =>
  found.flatMap(({ holder, around }) => [holder, around])

function measureAreas(found: ReturnType<typeof findAreas>): AreaMark[] {
  return found.flatMap(({ comment, area, holder, around, clippers }) => {
    const frame = framedArea(area, holder, around)
    const shown = frame && within(frame, clipOf(clippers))
    return shown ? [{ comment, area, frame, shown }] : []
  })
}

/**
 * Frames around the areas comments were drawn on, as around an element,
 * until their thread is first resolved; a bubble on each opens its thread.
 * A drawing has no frame: its lines carry the rainbow. Once its agent has
 * written a file, while it works or once stopped, the page under an area may
 * have changed: it greys out, as what the reader pointed at, not what is
 * there now.
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
  const marks = useTracked(root, comments, findAreas, measureAreas, holdersOf)

  return (
    <>
      {marks.map(({ comment, area, frame, shown }) => (
        <Fragment key={comment.id}>
          <div className="an-clip" style={shown}>
            <div
              className={`an-mark an-mark--area${area.strokes ? ' an-mark--drawing' : ''}`}
              data-testid="an-area-mark"
              data-outdated={outdated(comment) || undefined}
              style={{
                top: frame.top - shown.top,
                left: frame.left - shown.left,
                width: frame.width,
                height: frame.height,
              }}
            >
              <Strokes
                area={area}
                rainbow={outdated(comment) ? undefined : `an-rainbow-${comment.id}`}
              />
            </div>
          </div>
          <button
            type="button"
            className="an-quote-pin an-live"
            style={{ top: shown.top, left: shown.left }}
            aria-label={`Open the comment on the ${area.strokes ? 'drawing' : 'drawn area'}`}
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
    (comment) =>
      !wasResolved(comment) &&
      !comment.anchor.element &&
      !pickedMark(comment) &&
      comment.anchor.quote,
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

/** The elements that hold each quote's text. */
const quotedOf = (found: ReturnType<typeof findQuotes>) =>
  found.flatMap(({ parts }) =>
    parts.map(({ range }) => range.startContainer.parentElement),
  )

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
    element.setAttribute('data-annotant', '')
    element.className = 'annotant-layer'
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
  const pins = useTracked(root, comments, findQuotes, measureQuotes, quotedOf)
  const layer = usePageLayer()

  return (
    <>
      {createPortal(
        pins.flatMap(({ comment, lines }) =>
          lines.map((line) => (
            <div
              key={`${comment.id}:${line.top}:${line.left}`}
              className="annotant-quote-mark"
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
            className="an-quote-pin an-live"
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
      className="an-outline"
      data-testid="an-target"
      style={{ ...box, ...cornersOf(element) }}
    />
  )
}

/** Outlines a drawn area while it is on screen, where `framedArea` places it. */
export function AreaOutline({ root, area }: { root: Element; area: ReviewArea }) {
  const measure = useCallback(
    () => framedArea(area, holderOf(root, area), aroundOf(root, area)),
    [root, area],
  )
  const box = useOnScreen(measure)
  if (!box) return null
  return (
    <div className="an-outline an-outline--area" data-testid="an-area-target" style={box}>
      <Strokes area={area} />
    </div>
  )
}

/** The events of a press, from pointerdown to click. */
const PRESSES = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const

/** How long the pointer stays on an element before the outline moves to it. */
export const HOVER_DWELL_MS = 50

/** What the picker's arrow keys skip, besides the widget: elements that draw nothing. */
const UNPICKABLE = 'script, style, template, noscript, link, meta'

/** A wrapper drawing no box of its own: the keys go through it, to its children. */
const wraps = (element: Element) => getComputedStyle(element).display === 'contents'

/**
 * The elements under `parent` the keys stop on: its children, those of its
 * wrappers, and none drawing nothing (`hidden`, `display: none`).
 */
function childrenOf(parent: Element): Element[] {
  return Array.from(parent.children).flatMap((child) => {
    if (child.matches(UNPICKABLE) || child.closest(WIDGET)) return []
    if (wraps(child)) return childrenOf(child)
    return child.getClientRects().length > 0 ? [child] : []
  })
}

/** What `element` is one of the children of, for the keys: past its wrappers, up to `root`. */
function parentOf(root: Element, element: Element) {
  let parent = element.parentElement
  while (parent && parent !== root && wraps(parent)) parent = parent.parentElement
  return parent
}

/** The element an arrow key moves the outline to from `from`, within `root`. */
function stepFrom(root: Element, from: Element | undefined, key: string) {
  if (!from?.isConnected || !root.contains(from) || from === root) {
    return childrenOf(root)[0]
  }
  const parent = parentOf(root, from)
  if (key === 'ArrowUp') return parent === root ? undefined : (parent ?? undefined)
  if (key === 'ArrowDown') return childrenOf(from)[0]
  const siblings = parent ? childrenOf(parent) : []
  return siblings[siblings.indexOf(from) + (key === 'ArrowRight' ? 1 : -1)]
}

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

/**
 * Dashed outline follows the pointer, gliding from one element to the next
 * once the pointer stays on it; a click picks the element, Escape cancels.
 * The arrow keys move it too, to the parent (up), the first child (down) or a
 * sibling (left, right), and Enter picks the element outlined: one hard to
 * hover can still be chosen.
 */
export function ElementPicker({
  root,
  hint = 'Click an element to comment on it, or move with the arrow keys and press Enter. Escape cancels.',
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
    // The element outlined, for Enter and the arrow keys: none off an element.
    let outlined: Element | undefined
    // Moved there with the arrow keys since the focus or the pointer last moved:
    // Enter picks it, even with the focus on a button (the picker's own, clicked to
    // start it).
    let byKeys = false
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
        outlined = element
        byKeys = false
        if (element) setHovered(element)
        setOver(!!element)
        setScrolled(false)
      }, HOVER_DWELL_MS)
    }
    // The page gets no press on the element being picked, nor its default
    // (focus, a menu opening on pointerdown, a drag): the click only picks.
    const onPress = (event: MouseEvent) => {
      // A click with no press of the pointer (`detail` 0) is the one the browser makes of
      // Enter or Space on a control, and the control's: its point, 0, 0, would pick the
      // page's top-left element.
      if (event.type === 'click' && event.detail === 0) return
      const element = target(event)
      if (!element) return
      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'click') onPick(element)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return onCancel()
      // Fields keep their keys, and the browser its shortcuts.
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.defaultPrevented || fieldOf(event)) return
      if (event.key === 'Enter') {
        // What has the focus keeps its Enter, the dock's Cancel among them, unless the
        // arrows moved the outline since the focus came to it.
        const [focused] = event.composedPath()
        if (!byKeys && focused instanceof Element && focused !== document.body) return
        const element = outlined
        if (!element?.isConnected) return
        event.preventDefault()
        onPick(element)
        return
      }
      if (!ARROWS.has(event.key)) return
      event.preventDefault()
      const element = stepFrom(root, outlined, event.key)
      if (!element) return
      clearTimeout(dwell)
      next = undefined
      outlined = element
      byKeys = true
      element.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
      setHovered(element)
      setOver(true)
      setScrolled(false)
    }
    const onFocus = () => {
      byKeys = false
    }
    const onScroll = () => {
      setScrolled(true)
      setTick((tick) => tick + 1)
    }
    document.addEventListener('mousemove', onMove)
    for (const type of PRESSES) window.addEventListener(type, onPress, true)
    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('scroll', onScroll, true)
    const restoreCursor = setInlineStyle(document.documentElement, 'cursor', 'crosshair')
    return () => {
      clearTimeout(dwell)
      document.removeEventListener('mousemove', onMove)
      for (const type of PRESSES) window.removeEventListener(type, onPress, true)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('scroll', onScroll, true)
      restoreCursor()
    }
  }, [root, onPick, onCancel])

  // An element gone from the page has no box: the outline leaves with it.
  const shown = hovered?.isConnected ? hovered : undefined
  const rect = shown?.getBoundingClientRect()
  return (
    <>
      <div className="an-hint">{hint}</div>
      {shown && rect && (
        <div
          className="an-hover"
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
    <div className="an-draw an-live" data-testid="an-draw" onMouseDown={start}>
      {!box && (
        <div className="an-hint">
          Drag over the page to frame an area. Scroll to stretch it; Escape cancels.
        </div>
      )}
      {(sized ? covered : []).map((part) => (
        <div
          key={`${part.top}:${part.left}:${part.width}:${part.height}`}
          className="an-draw-covered"
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
          className="an-draw-box"
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

/** A line being drawn: its points on the page, not in the viewport, as the page may scroll. */
type Line = DrawnPoint[]

/** Under this distance from the last point, in pixels, a move adds none: a line stays light. */
const MIN_STEP = 2

/** Where the pointer is on the page. */
const pointAt = (event: { clientX: number; clientY: number }) => ({
  x: event.clientX + window.scrollX,
  y: event.clientY + window.scrollY,
})

/** A line on the page, as SVG points in the viewport. */
const onScreen = (line: Line) =>
  line.map(({ x, y }) => `${x - window.scrollX},${y - window.scrollY}`).join(' ')

/**
 * The reader draws freehand over the page, with a mouse, a pen or a finger:
 * arrows, circles, a sketch. Undo takes the last line back, Clear all of
 * them; Done (or Enter) ends the drawing, Escape cancels it.
 */
export function SketchDrawer({
  lines: initial,
  onLines,
  onDraw,
  onCancel,
}: {
  /** The lines it starts from, on the page: those drawn before the page reloaded. */
  lines?: DrawnPoint[][] | undefined
  /** Each change of the lines, on the page, for the session to keep. */
  onLines?: (lines: DrawnPoint[][]) => void
  /** The lines, in viewport pixels. */
  onDraw: (lines: DrawnPoint[][]) => void
  onCancel: () => void
}) {
  const [lines, setLines] = useState<Line[]>(initial ?? [])
  const [, setScrolled] = useState(0)
  // The line under the pointer, and the pointer drawing it.
  const drawing = useRef<{ pointer: number; line: Line }>(undefined)

  const done = useCallback(() => {
    const drawn = lines.filter((line) => line.length)
    if (!drawn.length) return
    onDraw(
      drawn.map((line) =>
        line.map(({ x, y }) => ({ x: x - window.scrollX, y: y - window.scrollY })),
      ),
    )
  }, [lines, onDraw])
  // The line being drawn, if any, ends with the one it takes back.
  const undo = useCallback(() => {
    drawing.current = undefined
    setLines((current) => current.slice(0, -1))
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
      else if (event.key === 'Enter') {
        // A focused tool takes its own Enter: Undo's must not end the drawing too.
        if (event.composedPath()[0] instanceof HTMLButtonElement) return
        event.preventDefault()
        done()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undo()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, done, undo])

  useEffect(() => onLines?.(lines), [lines, onLines])

  // The lines stay on the page: they move with its scroll.
  useEffect(() => {
    const onScroll = () => setScrolled((count) => count + 1)
    document.addEventListener('scroll', onScroll, true)
    return () => document.removeEventListener('scroll', onScroll, true)
  }, [])

  const start = (event: ReactPointerEvent) => {
    if (event.button !== 0 || drawing.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const line = [pointAt(event)]
    drawing.current = { pointer: event.pointerId, line }
    setLines((current) => [...current, line])
  }
  const move = (event: ReactPointerEvent) => {
    const current = drawing.current
    if (current?.pointer !== event.pointerId) return
    const point = pointAt(event)
    const last = current.line.at(-1)
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < MIN_STEP) return
    const line = [...current.line, point]
    drawing.current = { ...current, line }
    setLines((all) => [...all.slice(0, -1), line])
  }
  const end = (event: ReactPointerEvent) => {
    if (drawing.current?.pointer === event.pointerId) drawing.current = undefined
  }

  const empty = !lines.length
  return (
    <div
      className="an-draw an-sketch an-live"
      data-testid="an-sketch"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <svg className="an-sketch-lines" aria-hidden="true">
        {lines.map((line, place) => (
          <polyline
            // oxlint-disable-next-line react/no-array-index-key -- lines are only added or taken back last
            key={place}
            points={onScreen(line.length > 1 ? line : [...line, ...line])}
          />
        ))}
      </svg>
      <div
        className="an-sketch-tools"
        // A press on the tools draws nothing.
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span>
          {empty
            ? 'Draw over the page: an arrow, a circle, a sketch. Escape cancels.'
            : `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`}
        </span>
        <button type="button" disabled={empty} onClick={undo}>
          Undo
        </button>
        <button
          type="button"
          disabled={empty}
          onClick={() => {
            drawing.current = undefined
            setLines([])
          }}
        >
          Clear
        </button>
        <button type="button" className="an-sketch-done" disabled={empty} onClick={done}>
          Done
        </button>
      </div>
    </div>
  )
}
