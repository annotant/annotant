import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent,
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  anchorFromArea,
  anchorFromDrawing,
  anchorFromElement,
  areaReady,
  type DrawnPoint,
  elementFromAnchor,
  quoteFromSelection,
  rangeFromAnchor,
  scrollToArea,
  startRect,
} from './anchors'
import { drawingImage } from './drawing'
import {
  createComment,
  deleteComment,
  imageUrl,
  updateComment,
  useAllComments,
  useComments,
  useRoute,
  useThemeSetting,
} from './api'
import {
  APP_ROUTE,
  type NewImage,
  type ReviewAnchor,
  type ReviewArea,
  type ReviewBox,
  type ReviewComment,
  type ReviewMessage,
  type ReviewNode,
  type ReviewPickedArea,
  type ReviewPickedElement,
  type ReviewProgress,
  type Status,
  answered,
  gaveUp,
  gist,
  isActive,
  isAsking,
  isReply,
  latestAttached,
  latestText,
  modelOf,
  openingOf,
  paused,
  statusOf,
} from './domain'
import { fits } from './images'
import { DebugPanel, DebugToggle } from './debug'
import { readSession, writeSession } from './session'
import {
  type Box,
  type Size,
  fitBox,
  fitPlace,
  placeOf,
  placeStyle,
  readLayout,
  viewport,
  writeLayout,
} from './layout'
import { setInlineStyle } from './inline'
import { clearHighlights, paintHighlights, scrollToComment } from './highlights'
import {
  AreaDrawer,
  AreaMarks,
  AreaOutline,
  ElementMarks,
  ElementPicker,
  QuoteBubbles,
  SketchDrawer,
  TargetOutline,
} from './overlays'
import {
  Boundary,
  Button,
  Checkbox,
  Chip,
  Composer,
  DateTime,
  type IconName,
  Icon,
  IconButton,
  Spinner,
  Textarea,
  Toasts,
  Toggle,
  ToolButton,
  toast,
} from './ui'
import { activityOf, isOngoing, stepKey } from './activity'
import {
  SHORTCUT_LIST,
  SHORTCUTS,
  type KeyboardLayout,
  type Shortcut,
  ariaShortcut,
  fieldOf,
  readKeyboard,
  shortcutLabel,
  shortcutOf,
} from './shortcuts'
import {
  NEEDS_YOU_REACH,
  PANEL_IN_MS,
  PANEL_OUT_MS,
  REDUCED_MOTION,
  scrollBehavior,
} from './styles'
import { useDark } from './theme'
import ant from './assets/ant.webp'
import antThinking from './assets/ant-thinking.webp'

const REPOSITORY = 'https://github.com/annotant/annotant'

const PANEL_WIDTH = 380
const MIN_PANEL_WIDTH = 320
const MAX_PANEL_RATIO = 0.8

// How close to its end, in pixels, a conversation counts as read to the end.
const NEAR_END = 40
// How long a smooth scroll to the end may take: the button stays away meanwhile.
const GLIDE_MS = 800

const clampWidth = (value: number) =>
  Math.round(
    Math.min(Math.max(value, MIN_PANEL_WIDTH), window.innerWidth * MAX_PANEL_RATIO),
  )
const PENDING_CENTER_MS = 5000
const FLASH_MS = 1500
const UI_KEY = 'annotant:ui'
const CENTER_KEY = 'annotant:center'
// What the reader had in progress when the page reloaded (the app's dev server
// does, on an agent's edit): the comment being written, and the tool in use.
const DRAFT_KEY = 'annotant:draft'
// Its images and its drawing's picture, apart: written as they change, not on each key typed.
const PICTURES_KEY = 'annotant:draft-pictures'
const TOOL_KEY = 'annotant:tool'

/** Where the shortcuts moving through the page's comments go, in the panel's order. */
const STEPS = { next: 1, previous: -1 } as const satisfies Partial<
  Record<Shortcut, number>
>

type View = 'page' | 'all'
type StatusFilter = 'all' | 'open' | 'asking' | 'resolved'

const STATUS_CHIPS: Record<Status, string> = {
  open: 'Open',
  claimed: 'In progress',
  asking: 'Needs you',
  answered: 'Answered',
  stopped: 'Stopped',
  resolved: 'Resolved',
}

const STEP_ICONS: Record<string, IconName> = {
  read: 'file-text',
  edit: 'pencil',
  write: 'file-plus',
  multiedit: 'pencil',
  bash: 'terminal',
  search: 'search',
  mcp: 'plug',
  web: 'globe',
  skill: 'lightning',
  start: 'lightning',
  thinking: 'bulb',
  message: 'chat',
}

const SLIDE_MS = 250
/**
 * How long after the hooks were sent a comment an agent may take to claim it
 * before the widget says it waits for a free agent: three run at a time, and a
 * start alone often takes ten seconds.
 */
const BUSY_AFTER_MS = 15_000
/**
 * How long before the widget says no agent has started: the session watching
 * may refuse agents (background tasks turned off), or have three long ones.
 */
const NO_AGENT_AFTER_MS = 60_000

function StepLine({
  step,
  className,
}: {
  step: ReviewProgress | undefined
  className: string
}) {
  const failed = !isOngoing(step)
  return (
    <div
      className={`${className}${failed ? ' an-current-line--failed' : ''}`}
      title={step?.error}
      aria-hidden="true"
    >
      <span className="an-step-icon">
        <Icon name={step ? (STEP_ICONS[step.kind] ?? 'wrench') : 'lightning'} />
      </span>
      {/* The dots inside the text: cut with it, they leave one ellipsis, not two. */}
      <span className="an-current-text">
        {activityOf(step)}
        {!failed && (
          <span className="an-dots" aria-hidden="true">
            <i>.</i>
            <i>.</i>
            <i>.</i>
          </span>
        )}
      </span>
    </div>
  )
}

/**
 * The latest step only, never the list: a new one pushes the previous one out
 * to the right and comes in from the left.
 */
function CurrentStep({ step }: { step: ReviewProgress | undefined }) {
  const key = stepKey(step)
  const previous = useRef(step)
  const [leaving, setLeaving] = useState<ReviewProgress>()

  // A layout effect, so the incoming line never paints once in place before
  // it starts sliding.
  useLayoutEffect(() => {
    const before = previous.current
    if (stepKey(before) === key) return undefined
    setLeaving(before)
    const timer = setTimeout(() => setLeaving(undefined), SLIDE_MS)
    return () => clearTimeout(timer)
  }, [key])
  // After the one above, so it compares against the previous render's step.
  useLayoutEffect(() => {
    previous.current = step
  })

  return (
    <div className="an-current" data-testid="an-progress">
      {/* Read alone: the lines below hold the step sliding away too, and
          hide the error in their title. */}
      <span className="an-visually-hidden" aria-live="polite">
        {step?.error ? `${activityOf(step)}: ${step.error}` : activityOf(step)}
      </span>
      {leaving && (
        <StepLine
          key={`out-${stepKey(leaving)}`}
          step={leaving}
          className="an-current-line an-current-line--out"
        />
      )}
      <StepLine
        key={key}
        step={step}
        className={`an-current-line${leaving ? ' an-current-line--in' : ''}`}
      />
    </div>
  )
}

/** What an open comment says, by how long ago the hooks were sent it. */
const WAITS = [
  { after: 0, text: 'Claude has your comment, an agent is starting…' },
  {
    after: BUSY_AFTER_MS,
    text: 'Claude has your comment, waiting for a free agent…',
    title:
      'Annotant runs three agents at a time; one starts on your comment as soon as another ends.',
  },
  {
    after: NO_AGENT_AFTER_MS,
    text: 'No agent has started. Check the Claude Code session watching.',
    title:
      'The server handed your comment over a minute ago and no agent claimed it: the session running /annotant says why, or run it again.',
  },
]

/** The same, for the reader's reply in the thread. */
const REPLY_WAITS = [
  { after: 0, text: 'Claude has your reply, an agent is picking it up…' },
  {
    after: BUSY_AFTER_MS,
    text: 'Claude has your reply, waiting for a free agent…',
    title:
      'Annotant runs three agents at a time; one picks up your reply as soon as another ends.',
  },
  {
    after: NO_AGENT_AFTER_MS,
    text: 'No agent has picked up your reply. Check the Claude Code session watching.',
    title:
      'The server handed your reply over a minute ago and no agent claimed it: the session running /annotant says why, or run it again.',
  },
]

/**
 * An open comment while a session watches: sent, then handed over to the
 * hooks, then, while no agent claims it, waiting for one, then not started.
 * Each return to `open` starts again, with its message's `notifiedAt`; `reply` when
 * it is the reader's reply.
 */
function Waiting({
  notifiedAt,
  reply,
}: {
  notifiedAt: string | undefined
  reply: boolean
}) {
  const waits = reply ? REPLY_WAITS : WAITS
  const since = notifiedAt ? Date.parse(notifiedAt) : undefined
  const [now, setNow] = useState(Date.now)
  const wait =
    since === undefined ? undefined : waits.findLast(({ after }) => now >= since + after)
  const next =
    since === undefined ? undefined : waits.find(({ after }) => now < since + after)
  const due = next && since !== undefined ? since + next.after : undefined

  useEffect(() => {
    if (due === undefined) return undefined
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, due - Date.now()))
    return () => clearTimeout(timer)
  }, [due])

  return (
    <div className="an-working" data-testid="an-working" title={wait?.title}>
      <Spinner />
      <span>{wait?.text ?? 'Sent…'}</span>
    </div>
  )
}

/** How far the pointer moves, in pixels, before a press is a drag. */
const DRAG = 4

/**
 * A message in the thread. Its date, under every message, would be noise: a
 * click on the message, or Enter or Space on it, shows or hides it, and screen
 * readers read it all along. The date as well as the time: a
 * thread can outlive the day it started.
 */
function Message({
  author,
  at,
  dated,
  onToggle,
  children,
}: {
  author: ReviewMessage['author']
  at: string
  dated: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const pressedAt = useRef<{ x: number; y: number }>(undefined)
  return (
    <div
      className={`an-msg an-msg--${author}`}
      tabIndex={0}
      data-testid="an-msg"
      onMouseDown={(event) => {
        pressedAt.current = { x: event.clientX, y: event.clientY }
      }}
      onClick={(event) => {
        // A link, a button or a field keeps its own action; an image is in a link.
        const { target } = event
        if (
          target instanceof Element &&
          target.closest('a, button, input, textarea, select, label')
        )
          return
        // A drag that selects the text is not a click: the widget's shadow root
        // may hide its selection from the document's, so the pointer tells too.
        const from = pressedAt.current
        if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > DRAG)
          return
        if (getSelection()?.toString()) return
        onToggle()
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || event.repeat) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onToggle()
      }}
    >
      {children}
      <DateTime className={dated ? 'an-message-time' : 'an-visually-hidden'} at={at} />
    </div>
  )
}

/**
 * Claude's question, with the answers it offers. While it waits on the reader,
 * an option answers it at once, or, when several may be picked, ticks it for
 * the Send button; afterwards, the options the reader chose stay marked.
 */
function Question({
  message,
  live,
  chosen,
  picked,
  busy,
  onToggle,
  onAnswer,
}: {
  message: ReviewMessage
  /** The thread waits on the reader's answer to this question. */
  live: boolean
  /** What the reader answered, once they did. */
  chosen: string[]
  picked: string[]
  busy: boolean
  onToggle: (label: string) => void
  /** `withText`: the reader's typed text goes with the choices. */
  onAnswer: (choices: string[], withText: boolean) => void
}) {
  const multiple = !!message.multiple
  return (
    <div className="an-ask">
      <span className="an-ask-label">Question</span>
      <span>{message.body}</span>
      {!!message.options?.length && (
        <div
          className="an-options"
          role="group"
          aria-label={multiple ? 'Pick one or more answers' : 'Pick an answer'}
          data-testid="an-options"
        >
          {message.options.map((option) => {
            const on = live
              ? picked.includes(option.label)
              : chosen.includes(option.label)
            return (
              <button
                key={option.label}
                type="button"
                className={`an-option${on ? ' an-option--on' : ''}`}
                {...(multiple ? { role: 'checkbox', 'aria-checked': on } : {})}
                disabled={!live || busy}
                onClick={() => {
                  if (multiple) onToggle(option.label)
                  else onAnswer([option.label], false)
                }}
              >
                {multiple && (
                  <span className="an-option-box">{on && <Icon name="check" />}</span>
                )}
                <span className="an-option-text">
                  <strong>{option.label}</strong>
                  {option.description && <span>{option.description}</span>}
                </span>
                {!multiple && !live && on && <Icon name="check" />}
              </button>
            )
          })}
        </div>
      )}
      {live && multiple && (
        <div className="an-actions">
          <Button
            small
            icon="send"
            disabled={busy || !picked.length}
            onClick={() => onAnswer(picked, true)}
          >
            Send
          </Button>
        </div>
      )}
    </div>
  )
}

/** Said when the images leave a drawing's picture no room: Claude gets its lines alone. */
const PICTURE_LEFT_OUT =
  "The drawing's picture was left out: the message's images take all the room."

/** The images attached so far, with those just pasted, dropped or chosen. */
const adding = (images: NewImage[] = [], added: NewImage[]) => [...images, ...added]

/** The images attached so far, but the one at `index`. */
const removing = <T,>(list: T[] = [], index: number) =>
  list.filter((_, other) => other !== index)

/** What the reader wrote or attached in a draft: Escape or a click away would lose it. */
const written = (draft: Pick<Draft, 'body' | 'images' | 'elements'>) =>
  !!draft.body.trim() || !!draft.images?.length || !!draft.elements?.length

/**
 * A draft about the page, with neither the text, the element, the area nor
 * the drawing it was about: one target per message, the next one takes its
 * place.
 */
function untargeted(draft: Draft): Draft {
  const {
    area: _,
    sketch: __,
    elements: ___,
    element: ____,
    prefix: _____,
    suffix: ______,
    occurrences: _______,
    ...rest
  } = draft
  return { ...rest, ...PAGE_LEVEL }
}

/** The reply being written, as the reader left it in its message box. */
interface FollowUp {
  id: string
  body: string
  images?: NewImage[]
  /** Its target, an element or else an area: one at most. */
  elements?: ReviewPickedElement[]
  area?: ReviewPickedArea
  /** With an area drawn freehand: its picture, sent with the images for Claude. */
  sketch?: NewImage
}

/** The reply `current` is for thread `id`, with `target` in place of its own. */
function retargetedReply(
  current: FollowUp | undefined,
  id: string,
  target: Pick<FollowUp, 'elements' | 'area' | 'sketch'>,
): FollowUp {
  const own = current?.id === id ? current : undefined
  const { elements: _, area: __, sketch: ___, ...rest } = own ?? { id, body: '' }
  return { ...rest, ...target }
}

/** The message box being written in, when an element in the page is picked for a new comment. */
const DRAFT = 'draft'

/** Draft keys: each draft gets a message box of its own, its reads with it. */
let drafts = 0

interface Draft extends ReviewAnchor {
  /** Which draft this is, from its start. */
  key: number
  body: string
  /** The images pasted or dropped in the message box. */
  images?: NewImage[]
  /** The element picked in the page for it, its target: one at most, never with `area`. */
  elements?: ReviewPickedElement[]
  /** With an area drawn freehand: its picture, sent with the images for Claude. */
  sketch?: NewImage
  app?: boolean
  /** The page the draft was started on: the app may navigate before it is saved. */
  route: string
  url: string
}

/** A draft as the tab keeps it: it gets a new key once it is back. */
type SavedDraft = Omit<Draft, 'key'>

/**
 * The tool in use, with the lines of a drawing so far, on the page, and the
 * thread whose reply a drawing is for (`for`).
 */
type SavedTool =
  | { tool: 'pick' }
  | { tool: 'area'; for?: string }
  | { tool: 'sketch'; lines?: DrawnPoint[][]; for?: string }

// What the tab holds may come from another build of the widget (`npm run
// watch` reloads the page on each), or from the page's own scripts: read in a
// shape the widget cannot draw, it would take the widget down on each load.
type Fields = Record<string, unknown>
const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isList = (value: unknown, item: (entry: unknown) => boolean) =>
  Array.isArray(value) && value.every(item)
const isText = (value: unknown) => typeof value === 'string'
const isNumber = (value: unknown) => typeof value === 'number'
const isImage = (value: unknown) =>
  isFields(value) && isText(value['type']) && isText(value['data'])
const isPoint = (value: unknown) =>
  isFields(value) && isNumber(value['x']) && isNumber(value['y'])
const isNode = (value: unknown) =>
  isFields(value) && isText(value['selector']) && isText(value['tag'])
const isPicked = (value: unknown) =>
  isNode(value) && isFields(value) && isText(value['route'])
const isArea = (value: unknown) =>
  isFields(value) &&
  ['top', 'left', 'width', 'height'].every((side) => isNumber(value[side])) &&
  isList(value['covers'], isNode) &&
  isList(value['crosses'], isNode) &&
  isFields(value['viewport']) &&
  (value['within'] === undefined || isNode(value['within'])) &&
  (value['strokes'] === undefined || isList(value['strokes'], Array.isArray))

function isSavedDraft(value: unknown): value is SavedDraft {
  return (
    isFields(value) &&
    ['route', 'url', 'body', 'section', 'quote'].every((field) => isText(value[field])) &&
    isNumber(value['occurrence']) &&
    (value['elements'] === undefined || isList(value['elements'], isPicked)) &&
    (value['area'] === undefined || isArea(value['area']))
  )
}

const isSavedPictures = (value: unknown): value is Pick<Draft, 'images' | 'sketch'> =>
  isFields(value) &&
  (value['images'] === undefined || isList(value['images'], isImage)) &&
  (value['sketch'] === undefined || isImage(value['sketch']))

const isSavedTool = (value: unknown): value is SavedTool =>
  isFields(value) &&
  (value['for'] === undefined || isText(value['for'])) &&
  (value['tool'] === 'area' ||
    value['tool'] === 'pick' ||
    (value['tool'] === 'sketch' &&
      (value['lines'] === undefined ||
        isList(value['lines'], (line) => isList(line, isPoint)))))

/** The draft the tab kept, with its pictures when they could be kept too. */
function readDraft(): SavedDraft | undefined {
  const draft = readSession<unknown>(DRAFT_KEY)
  if (!isSavedDraft(draft)) return undefined
  const pictures = readSession<unknown>(PICTURES_KEY)
  return isSavedPictures(pictures) ? { ...draft, ...pictures } : draft
}

interface PendingCenter {
  anchor: ReviewAnchor
  path: string
  id?: string
}

interface UiState {
  open: boolean
  /** Kept by this tab before the layout was kept for all of them. */
  docked?: boolean
  width?: number
  view: View
  threadId?: string
  statusFilter: StatusFilter
}

const PAGE_LEVEL: ReviewAnchor = { quote: '', occurrence: 0, section: '' }

/**
 * A draft kept before the page reloaded, as it comes back: once what it is on
 * (its selected text, its area, the elements picked) is on the page again.
 * `late`, past waiting for them, it comes back without the elements still
 * missing, and as a comment on the page if its selected text or area is gone;
 * `null` when nothing the reader wrote or attached is left. `undefined` while
 * it waits. A draft of another page comes back as it was kept.
 */
function restoredDraft(
  root: Element,
  saved: SavedDraft,
  late: boolean,
): SavedDraft | null | undefined {
  const here = window.location.pathname
  if (saved.route !== here) return saved
  const anchored = saved.area
    ? areaReady(root, saved.area)
    : !saved.quote || !!rangeFromAnchor(root, saved)
  const found = (element: ReviewPickedElement) =>
    element.route !== here || !!elementFromAnchor(root, { ...PAGE_LEVEL, element })
  const elements = saved.elements ?? []
  if (anchored && elements.every(found)) return saved
  if (!late) return undefined
  const { route, url, body, images } = saved
  const base: SavedDraft = anchored
    ? { ...saved }
    : { ...PAGE_LEVEL, route, url, body, ...(images ? { images } : {}) }
  delete base.elements
  const left = elements.filter(found)
  const back = left.length ? { ...base, elements: left } : base
  return written(back) ? back : null
}

/** The model Claude worked on the comment with, and the classifier's label. */
function ModelLabel({ comment }: { comment: ReviewComment }) {
  const model = modelOf(comment)
  if (!model) return null
  return (
    <span
      className="an-model"
      data-testid="an-model"
      title={
        model.complexity
          ? `Claude works on ${model.id}: the comment was sorted ${model.complexity}`
          : `Claude works on ${model.id}`
      }
    >
      {model.complexity ? `${model.name} · ${model.complexity}` : model.name}
    </span>
  )
}

/** The page `url` shows, or '' when there is none: a hand-edited comment may hold anything. */
function pagePath(url: string | undefined): string {
  if (!url) return ''
  try {
    const { pathname, search, hash } = new URL(url)
    return pathname + search + hash
  } catch {
    return ''
  }
}

function scopeLabel(comment: { route: string; url?: string }): string {
  return comment.route === APP_ROUTE
    ? 'Whole app'
    : `Whole page · ${pagePath(comment.url) || comment.route}`
}

/**
 * What a drawn area covers, in a few words: the element a drawing points at,
 * else the elements inside it, else those it cuts through.
 */
function areaContents(area: ReviewArea): string {
  if (area.pointsAt) {
    const { tag, text } = area.pointsAt
    return `points at <${tag}>${text ? ` ${text}` : ''}`
  }
  const nodes = area.covers.length ? area.covers : area.crosses
  const shown = nodes.slice(0, 3).map((node) => `<${node.tag}>`)
  const hidden = nodes.length - shown.length
  const more = area.truncated ? ` +${hidden}…` : hidden ? ` +${hidden}` : ''
  if (shown.length)
    return `${area.covers.length ? 'covers' : 'across'} ${shown.join(' ')}${more}`
  return area.within ? `in <${area.within.tag}>` : 'on the page'
}

const linesOf = (count: number) => (count === 1 ? '1 line' : `${count} lines`)

/** An element, as a target card names it: its text, quoted, else its tag. */
const named = (node: ReviewNode) => (node.text ? `"${node.text}"` : `<${node.tag}>`)

/**
 * What a drawn area holds, as its target card says it: the element a
 * drawing points at, else the texts of the elements inside it, else of those
 * it cuts through.
 */
function areaHolds(area: ReviewArea): string {
  if (area.pointsAt) return `points at ${named(area.pointsAt)}`
  const nodes = area.covers.length ? area.covers : area.crosses
  if (!nodes.length) return area.within ? `in ${named(area.within)}` : 'on the page'
  // A button and the text in it are named alike: once.
  const names = [...new Set(nodes.map(named))]
  const more = names.length > 3 || area.truncated ? ', …' : ''
  return `${area.covers.length ? 'covers' : 'across'} ${names.slice(0, 3).join(', ')}${more}`
}

function areaSummary(area: ReviewArea): string {
  const what = area.strokes
    ? `A drawing of ${linesOf(area.strokes.length)} over ${area.width} × ${area.height} px`
    : `An area of ${area.width} × ${area.height} px`
  return `${what}, drawn in a ${area.viewport.width} × ${area.viewport.height} window`
}

/**
 * A press on the widget stays in it: a menu of the page closing on a press
 * outside it (Radix, MUI) stays open, so its items can be picked. A button
 * leaves the focus where it is, for the menus closing when the focus leaves.
 */
function keepPress(event: SyntheticEvent) {
  event.stopPropagation()
  const target = event.target
  if (
    event.type === 'mousedown' &&
    target instanceof Element &&
    target.closest('button')
  ) {
    event.preventDefault()
  }
}

/** The element with the focus, within the shadow roots it is in. */
function focusedElement() {
  let focused = document.activeElement
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement
  return focused instanceof HTMLElement && focused !== document.body ? focused : undefined
}

export default function App({ root }: { root: Element }) {
  const route = useRoute()
  const dark = useDark(useThemeSetting())
  const [saved] = useState(() => readSession<UiState>(UI_KEY))
  const [open, setOpen] = useState(saved?.open ?? false)
  // Open since the page loaded, as the tab kept it: it shows up in place, without sliding in.
  const [restored, setRestored] = useState(open)
  // Closed, but still on screen while it leaves.
  const [leaving, setLeaving] = useState(false)
  const [savedLayout] = useState(readLayout)
  const [docked, setDocked] = useState(savedLayout.docked ?? saved?.docked ?? false)
  // The width chosen, kept as is: the window, maybe narrower, only caps the one shown.
  const [chosenWidth, setWidth] = useState(
    savedLayout.width ?? saved?.width ?? PANEL_WIDTH,
  )
  const [windowSize, setWindow] = useState(viewport)
  // Where the reader put the closed widget's tools, kept as is: the window only keeps them on screen.
  const [strip, setStrip] = useState(savedLayout.strip)
  const [stripSize, setStripSize] = useState<Size>()
  // Where the tools are while they are dragged, from the window's top left corner.
  const [moving, setMoving] = useState<{ left: number; top: number }>()
  const width = clampWidth(chosenWidth)
  const [view, setView] = useState<View>(saved?.view ?? 'page')
  const [threadId, setThreadId] = useState(saved?.threadId)
  /** The messages whose date shows, as `<comment>/<message>`: message ids repeat across threads. */
  const [dated, setDated] = useState<ReadonlySet<string>>(new Set())
  const toggleDate = (key: string) =>
    setDated((keys) => {
      const next = new Set(keys)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    saved?.statusFilter ?? 'open',
  )
  const [dragging, setDragging] = useState(false)
  const [draft, setDraft] = useState<Draft>()
  // The draft kept before the page reloaded, until it is back or given up.
  const [restoring, setRestoring] = useState(readDraft)
  const [savedTool] = useState(() => {
    const tool = readSession<unknown>(TOOL_KEY)
    return isSavedTool(tool) ? tool : undefined
  })
  const [activeId, setActiveId] = useState<string>()
  const [selectionButton, setSelectionButton] = useState<{
    top: number
    left: number
  }>()
  const [picking, setPicking] = useState(savedTool?.tool === 'pick')
  // The thread whose reply an element in the page is being picked for, or the draft's (`DRAFT`).
  const [attachingTo, setAttachingTo] = useState<string>()
  // What the reader draws over the page: a rectangle, or freehand.
  const [drawing, setDrawing] = useState<false | 'area' | 'sketch'>(
    savedTool?.tool === 'area' || savedTool?.tool === 'sketch' ? savedTool.tool : false,
  )
  // The thread whose reply the drawing is for; else it is the draft's, or starts one.
  const [drawingFor, setDrawingFor] = useState(
    savedTool && savedTool.tool !== 'pick' ? savedTool.for : undefined,
  )
  // The lines a drawing starts from: those drawn before the page reloaded, for
  // the drawing it brings back only (a new one starts from none).
  const [sketchFrom, setSketchFrom] = useState(
    savedTool?.tool === 'sketch' ? savedTool.lines : undefined,
  )
  const [target, setTarget] = useState<Element>()
  // A drawn area shown again: while its chip is hovered, or for a moment once it is clicked.
  const [targetArea, setTargetArea] = useState<ReviewArea>()
  const [flashArea, setFlashArea] = useState<ReviewArea>()
  const [pendingCenter, setPendingCenter] = useState(
    readSession<PendingCenter>(CENTER_KEY),
  )
  const [flash, setFlash] = useState<Element>()
  const [resend, setResend] = useState<{ id: string; body: string }>()
  const [followUp, setFollowUp] = useState<FollowUp>()
  // The options ticked so far, under the question (`question`, its message id)
  // that takes several: another question of the thread starts with none.
  const [picked, setPicked] = useState<{
    id: string
    question: string
    labels: string[]
  }>()
  const [created, setCreated] = useState<ReviewComment>()
  const [busy, setBusy] = useState(false)
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const [below, setBelow] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  // Whether the open conversation follows what arrives.
  const following = useRef(true)
  const inThread = useRef(false)
  // Scrolls the body to its end, set while the body is mounted.
  const scrollToEnd = useRef<() => void>(undefined)
  const hintRow = useRef<HTMLDivElement>(null)
  // The hint row's height with the gap above it, as last measured under the box.
  const hintHeight = useRef(0)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pendingAnchor = useRef<ReviewAnchor>(undefined)
  const paddingAnimation = useRef<Animation>(undefined)
  // Puts back the page's own inline padding, while the docked panel squeezes it.
  const restorePadding = useRef<() => void>(undefined)
  const layout = useRef({ open, docked })
  // Where the focus was when the panel opened: it goes back there once the panel closes.
  const opener = useRef<HTMLElement>(undefined)
  const refocus = useRef(false)
  const dock = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const [toTitle, setToTitle] = useState(0)
  const widget = useRef<HTMLDivElement>(null)
  // The list of the keyboard shortcuts, in the panel.
  const [showKeys, setShowKeys] = useState(false)

  const openPanel = useCallback(() => {
    if (!layout.current.open) opener.current = focusedElement()
    setOpen(true)
  }, [])

  // Once the browser says what the keys type, the shortcuts' labels name them so.
  const [keyboard, setKeyboard] = useState<KeyboardLayout>()
  useEffect(() => {
    void readKeyboard().then(setKeyboard)
  }, [])
  const keysOf = (shortcut: Shortcut) => shortcutLabel(shortcut, { keyboard })
  const ariaKeysOf = (shortcut: Shortcut) => ariaShortcut(shortcut, { keyboard })

  const page = useComments(route)
  const comments = page.comments
  // Closed, for the strip's badge: a thread of any page may need the reader.
  const allShown = !open || view === 'all'
  const all = useAllComments(allShown)
  const asking = all.comments.filter(isAsking)
  const needYou = asking.length
  // The strip's Comments, named with what its badge counts.
  const commentsName =
    needYou > 0
      ? `Comments, ${needYou} ${needYou === 1 ? 'thread needs' : 'threads need'} you`
      : 'Comments'
  // Some agent is on a comment right now. Not from the list of every comment
  // once it stops reloading: it would say so long after.
  const working = [...comments, ...(allShown ? all.comments : [])].some(
    (comment) => comment.state === 'working',
  )
  const watching = page.reachable

  useEffect(() => {
    writeSession(UI_KEY, { open, view, threadId, statusFilter })
  }, [open, view, threadId, statusFilter])

  // Each on its own, so that a tab writes only what was changed in it.
  useEffect(() => writeLayout('docked', docked), [docked])
  useEffect(() => writeLayout('width', chosenWidth), [chosenWidth])
  useEffect(() => writeLayout('strip', strip), [strip])

  // Not while the draft kept is still to come back: it would be forgotten.
  useEffect(() => {
    if (restoring) return
    if (!draft) {
      writeSession(DRAFT_KEY, undefined)
      return
    }
    const { key: _, images: __, sketch: ___, ...kept } = draft
    writeSession(DRAFT_KEY, kept)
  }, [draft, restoring])

  // Too big for the tab's storage, the images are left out, then the drawing's
  // picture: the draft comes back without them.
  const draftImages = draft?.images
  const draftSketch = draft?.sketch
  useEffect(() => {
    if (restoring) return
    const pictures = {
      ...(draftImages?.length ? { images: draftImages } : {}),
      ...(draftSketch ? { sketch: draftSketch } : {}),
    }
    if (!draftImages?.length && !draftSketch) writeSession(PICTURES_KEY, undefined)
    else if (!writeSession(PICTURES_KEY, pictures) && draftSketch)
      writeSession(PICTURES_KEY, { sketch: draftSketch })
  }, [draftImages, draftSketch, restoring])

  // Back once its selected text, its area and its elements are on the page
  // again, for 5 s at most: the app may render after the widget. Never over a
  // draft started meanwhile.
  useEffect(() => {
    if (!restoring) return undefined
    const deadline = Date.now() + PENDING_CENTER_MS
    let frame = 0
    const attempt = () => {
      const back = restoredDraft(root, restoring, Date.now() > deadline)
      if (back === undefined) {
        frame = requestAnimationFrame(attempt)
        return
      }
      if (back) setDraft((current) => current ?? { ...back, key: (drafts += 1) })
      setRestoring(undefined)
    }
    attempt()
    return () => cancelAnimationFrame(frame)
  }, [root, restoring])

  // A drawing keeps its lines as they change (`keepLines`), its tool with them.
  useEffect(() => {
    if (drawing === 'sketch') return
    writeSession(
      TOOL_KEY,
      drawing
        ? { tool: drawing, ...(drawingFor ? { for: drawingFor } : {}) }
        : picking
          ? { tool: 'pick' }
          : undefined,
    )
  }, [drawing, drawingFor, picking])

  // The quote of the comment being written stays marked once the selection is gone,
  // on its own page only: the app may navigate before it is saved.
  const draftHere = draft?.route === route
  const draftQuote = view === 'page' && draftHere ? draft.quote : undefined
  const { occurrence = 0, prefix, suffix, occurrences } = draft ?? {}
  useEffect(() => {
    const drafted = draftQuote
      ? {
          section: '',
          quote: draftQuote,
          occurrence,
          ...(prefix ? { prefix } : {}),
          ...(suffix ? { suffix } : {}),
          ...(occurrences ? { occurrences } : {}),
        }
      : undefined
    // Once per frame: a page that streams its content changes many times a frame.
    let frame = 0
    const paint = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => paintHighlights(root, drafted))
    }
    paintHighlights(root, drafted)
    const observer = new MutationObserver(paint)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      clearHighlights()
    }
  }, [root, draftQuote, occurrence, prefix, suffix, occurrences])

  useEffect(() => {
    const select = () => {
      const selection = window.getSelection()
      if (!selection) return
      const quoted = quoteFromSelection(root, selection)
      if (!quoted) {
        setSelectionButton(undefined)
        return
      }
      pendingAnchor.current = quoted.anchor
      // The quote's first character: a drag may start past the end of the line above.
      const rect = startRect(quoted.range ?? selection.getRangeAt(0))
      setSelectionButton({ top: rect.top - 40, left: rect.left })
    }
    // Once per frame: a drag changes the selection many times a frame.
    let frame = 0
    const onSelectionChange = () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0
        select()
      })
    }
    const onScroll = () => setSelectionButton(undefined)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('scroll', onScroll, true)
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- read in the frame's callback, which the rule does not follow
  }, [root])

  // Floating: the panel floats over the page, which is left untouched. Docked: the page is squeezed,
  // in step with the panel as it opens, closes, widens or narrows; at once while it is dragged.
  // Through `html`'s padding, which hosts leave alone: libraries pad `body` for a modal's scrollbar.
  useEffect(() => {
    const html = document.documentElement
    const from = getComputedStyle(html).paddingRight
    paddingAnimation.current?.cancel()
    restorePadding.current?.()
    restorePadding.current =
      open && docked ? setInlineStyle(html, 'padding-right', `${width}px`) : undefined
    const moved = open !== layout.current.open || docked !== layout.current.docked
    layout.current = { open, docked }
    if (!moved || matchMedia(REDUCED_MOTION).matches) return
    if (getComputedStyle(html).paddingRight === from) return
    paddingAnimation.current = html.animate([{ paddingRight: from, offset: 0 }], {
      duration: open ? PANEL_IN_MS : PANEL_OUT_MS,
      easing: open ? 'ease-out' : 'ease-in',
    })
  }, [open, docked, width])

  useEffect(
    () => () => {
      paddingAnimation.current?.cancel()
      restorePadding.current?.()
      restorePadding.current = undefined
    },
    [],
  )

  useEffect(() => {
    if (!leaving) return undefined
    const timer = setTimeout(() => setLeaving(false), PANEL_OUT_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  const close = () => {
    setOpen(false)
    setRestored(false)
    setAttachingTo(undefined)
    setLeaving(true)
    refocus.current = true
  }

  // Back to the button that opened the panel, or to the strip's Comments when it is gone with the panel.
  useEffect(() => {
    if (open || !refocus.current) return
    refocus.current = false
    const back = opener.current?.isConnected
      ? opener.current
      : dock.current?.querySelector<HTMLElement>('.an-comments')
    opener.current = undefined
    back?.focus()
  }, [open])

  useEffect(() => {
    if (toTitle) title.current?.focus()
  }, [toTitle])

  const toggleDocked = () => {
    setDocked(!docked)
    setWidth(docked ? PANEL_WIDTH : clampWidth(window.innerWidth / 2))
  }

  useEffect(() => {
    const fit = () => setWindow(viewport())
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  // The tools' size, to keep all of them on screen: it changes as a tool in progress shows its Cancel.
  useEffect(() => {
    const tools = dock.current
    if (open || !tools) return undefined
    const measure = () =>
      setStripSize((size) =>
        size?.width === tools.offsetWidth && size.height === tools.offsetHeight
          ? size
          : { width: tools.offsetWidth, height: tools.offsetHeight },
      )
    measure()
    const resizes = new ResizeObserver(measure)
    resizes.observe(tools)
    return () => resizes.disconnect()
  }, [open])

  // The count of the threads that need the reader sticks out of the strip's corner: on screen too.
  const shownStrip =
    strip && stripSize
      ? fitPlace(strip, stripSize, windowSize, needYou > 0 ? NEEDS_YOU_REACH : 0)
      : strip

  /** Puts the tools at `box`, from the corner nearest to it, within the window. */
  const placeStrip = (box: Box) => {
    const bounds = viewport()
    setStrip(fitPlace(placeOf(box, bounds), box, bounds))
  }

  // By the grip only, so that the tools keep their clicks: the click ending a drag lands on it.
  const startMove = (event: ReactMouseEvent) => {
    const tools = dock.current
    if (event.button !== 0 || !tools) return
    const from = tools.getBoundingClientRect()
    const grab = { x: event.clientX - from.left, y: event.clientY - from.top }
    const size = { width: from.width, height: from.height }
    let to: { left: number; top: number } | undefined
    const html = document.documentElement
    const restoreCursor = setInlineStyle(html, 'cursor', 'grabbing')
    const restoreSelect = setInlineStyle(html, 'user-select', 'none')
    const onMove = (move: MouseEvent) => {
      to = fitBox(move.clientX - grab.x, move.clientY - grab.y, size, viewport())
      setMoving(to)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      restoreCursor()
      restoreSelect()
      if (to) placeStrip({ ...to, ...size })
      setMoving(undefined)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const moveByKey = (event: ReactKeyboardEvent) => {
    const step = event.shiftKey ? 50 : 10
    const by = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key]
    const box = dock.current?.getBoundingClientRect()
    if (!by || !box) return
    // Not the page's, nor the widget's shortcuts on the arrows.
    event.preventDefault()
    event.stopPropagation()
    const [dx = 0, dy = 0] = by
    placeStrip({
      left: box.left + dx,
      top: box.top + dy,
      width: box.width,
      height: box.height,
    })
  }

  const resizeTo = (move: MouseEvent) => {
    setWidth(clampWidth(window.innerWidth - move.clientX))
  }

  const startResize = (event: ReactMouseEvent) => {
    event.preventDefault()
    setDragging(true)
    const html = document.documentElement
    const restoreCursor = setInlineStyle(html, 'cursor', 'col-resize')
    const restoreSelect = setInlineStyle(html, 'user-select', 'none')
    const onUp = () => {
      setDragging(false)
      document.removeEventListener('mousemove', resizeTo)
      document.removeEventListener('mouseup', onUp)
      restoreCursor()
      restoreSelect()
    }
    document.addEventListener('mousemove', resizeTo)
    document.addEventListener('mouseup', onUp)
  }

  // One flash at a time, an element's or an area's: the timer clears both.
  const flashOn = useCallback((element?: Element, area?: ReviewArea) => {
    setFlash(element)
    setFlashArea(area)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => {
      setFlash(undefined)
      setFlashArea(undefined)
    }, FLASH_MS)
  }, [])

  const spotlight = useCallback(
    (element: Element, id?: string) => {
      element.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
      if (id) setActiveId(id)
      flashOn(element)
    },
    [flashOn],
  )

  const spotlightArea = useCallback(
    (area: ReviewArea, id?: string) => {
      scrollToArea(root, area)
      if (id) setActiveId(id)
      flashOn(undefined, area)
    },
    [root, flashOn],
  )

  useEffect(() => () => clearTimeout(flashTimer.current), [])

  // The jump is for the page that loads right after the chip's click: whether this
  // is its page or the app sent the reader elsewhere, it must not wait for a later visit.
  useEffect(() => {
    writeSession(CENTER_KEY, undefined)
  }, [])
  if (pendingCenter && route !== pendingCenter.path) setPendingCenter(undefined)

  useEffect(() => {
    if (!pendingCenter || route !== pendingCenter.path) return undefined
    const deadline = Date.now() + PENDING_CENTER_MS
    let frame = 0
    const { anchor, id } = pendingCenter
    const attempt = () => {
      const { area } = anchor
      const late = Date.now() > deadline
      // An area waits for the page to be laid out; past the deadline, it shows where it was.
      const element = area ? undefined : elementFromAnchor(root, anchor)
      if (!late && !element && !(area && areaReady(root, area))) {
        frame = requestAnimationFrame(attempt)
        return
      }
      if (area) spotlightArea(area, id)
      else if (element) spotlight(element, id)
      setPendingCenter(undefined)
    }
    attempt()
    return () => cancelAnimationFrame(frame)
  }, [pendingCenter, root, route, spotlight, spotlightArea])

  const startDraft = useCallback(
    (
      anchor: ReviewAnchor,
      body = '',
      images?: NewImage[],
      elements?: ReviewPickedElement[],
    ) => {
      setDraft({
        ...anchor,
        key: (drafts += 1),
        body,
        ...(images?.length ? { images } : {}),
        ...(elements?.length ? { elements } : {}),
        route: window.location.pathname,
        // Never the hash, where a sign-in may leave its token.
        url: window.location.origin + window.location.pathname + window.location.search,
      })
      setView('page')
      setThreadId(undefined)
      openPanel()
      setPicking(false)
      setAttachingTo(undefined)
      setDrawing(false)
      setSelectionButton(undefined)
      window.getSelection()?.removeAllRanges()
    },
    [openPanel],
  )

  // Drawn or pointed at from a page-level draft, or over another area, the area
  // or the element takes the place of its target, after what the reader had
  // written and attached; a draft on a text starts over.
  const kept = view === 'page' && draft && draftHere && !draft.quote ? draft : undefined
  const keptBody = kept?.body ?? ''
  const keptImages = kept?.images

  /** Drawn for a reply, the area is its target; else the draft's, or a new one's. */
  const placeArea = useCallback(
    (anchor: ReviewAnchor, sketch?: NewImage) => {
      const { area } = anchor
      if (drawingFor && area) {
        setDrawing(false)
        setDrawingFor(undefined)
        setFollowUp((current) =>
          retargetedReply(current, drawingFor, {
            area: { ...area, route: window.location.pathname },
            ...(sketch ? { sketch } : {}),
          }),
        )
        return
      }
      startDraft({ ...anchor, ...(sketch ? { sketch } : {}) }, keptBody, keptImages)
    },
    [drawingFor, startDraft, keptBody, keptImages],
  )
  const drawArea = useCallback(
    (rect: ReviewBox) => placeArea(anchorFromArea(root, rect)),
    [root, placeArea],
  )
  // Drawn freehand, the area is the lines' box, and Claude gets their picture too,
  // wider: what an arrow points at is in it.
  const drawSketch = useCallback(
    (lines: DrawnPoint[][]) => {
      const drawn = anchorFromDrawing(root, lines)
      if (!drawn) return
      const { anchor, rect, reach, strokes } = drawn
      placeArea(anchor, drawingImage(reach, rect, strokes, root))
    },
    [root, placeArea],
  )

  /** An element pointed at in the page, as a new comment's message holds it: on the page it is on. */
  const pickedOf = useCallback(
    (element: Element): ReviewPickedElement | undefined => {
      const { element: found } = anchorFromElement(root, element)
      return found && { ...found, route: window.location.pathname }
    },
    [root],
  )

  // Pointing at an element is a shortcut: a draft whose message box holds it.
  const pickElement = useCallback(
    (element: Element) => {
      const added = pickedOf(element)
      if (!kept) {
        startDraft(PAGE_LEVEL, '', undefined, added && [added])
        return
      }
      setDraft(added ? { ...untargeted(kept), elements: [added] } : kept)
      setView('page')
      setThreadId(undefined)
      openPanel()
      setPicking(false)
    },
    [pickedOf, kept, startDraft, openPanel],
  )

  const cancelPick = useCallback(() => setPicking(false), [])

  const cancelDraw = useCallback(() => {
    setDrawing(false)
    setDrawingFor(undefined)
  }, [])

  const keepLines = useCallback(
    (lines: DrawnPoint[][]) => {
      writeSession(TOOL_KEY, {
        tool: 'sketch',
        ...(lines.length ? { lines } : {}),
        ...(drawingFor ? { for: drawingFor } : {}),
      })
    },
    [drawingFor],
  )

  /** `forThread`: the drawing is the target of that thread's reply. */
  const startDrawing = (tool: 'area' | 'sketch', forThread?: string) => {
    setSketchFrom(undefined)
    setPicking(false)
    setAttachingTo(undefined)
    setSelectionButton(undefined)
    setDrawingFor(forThread)
    setDrawing(tool)
  }

  const run = async (task: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await task()
      return true
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Request failed', true)
      return false
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!draft || !written(draft)) return
    const {
      key: _,
      app,
      body,
      images: attached,
      elements,
      sketch,
      route: startedOn,
      url,
      ...anchor
    } = draft
    // The drawing's picture goes last, while the message has room for it, and
    // the area says so: the agent never takes one of the reader's for it.
    const pictured = !!sketch && fits([...(attached ?? []), sketch])
    if (sketch && !pictured) toast(PICTURE_LEFT_OUT)
    const images = pictured ? [...(attached ?? []), sketch] : attached
    // With a target, the comment is about its page; else the box says which.
    const targeted = !!elements?.length || !!anchor.area || !!anchor.quote
    await run(async () => {
      const comment = await createComment({
        anchor:
          pictured && anchor.area
            ? { ...anchor, area: { ...anchor.area, pictured: true } }
            : anchor,
        body,
        route: app && !targeted ? APP_ROUTE : startedOn,
        url,
        ...(images?.length ? { images } : {}),
        ...(elements?.length ? { elements } : {}),
      })
      setCreated(comment)
      setDraft(undefined)
      setThreadId(comment.id)
      setActiveId(comment.id)
      toast('Comment saved')
    })
  }

  const jump = (comment: ReviewComment) => {
    setActiveId(comment.id)
    setThreadId(comment.id)
    scrollToComment(root, comment.anchor)
  }

  /** A bubble on the page: its thread, in the panel, opened if it was closed. */
  const openFromPage = (comment: ReviewComment) => {
    // Like Escape, never at the cost of what the reader is writing.
    if (draft && written(draft)) return
    setDraft(undefined)
    setView('page')
    openPanel()
    jump(comment)
    // The bubble stays on the page: the focus goes to the thread it opened.
    setToTitle((times) => times + 1)
  }

  const thread = threadId
    ? (comments.find((comment) => comment.id === threadId) ??
      all.comments.find((comment) => comment.id === threadId) ??
      (created?.id === threadId ? created : undefined))
    : undefined

  const drafting = view === 'page' && !!draft
  const openedId = drafting ? undefined : thread?.id
  // The thread the message box replies to: only once Claude is done or asks.
  const replying =
    !drafting &&
    thread &&
    (thread.state === 'resolved' || isAsking(thread) || answered(thread))
      ? thread
      : undefined
  const ownReply = replying && followUp?.id === replying.id ? followUp : undefined
  const reply = ownReply?.body ?? ''
  const replyImages = ownReply?.images ?? []
  const replyElements = ownReply?.elements ?? []
  const replyArea = ownReply?.area
  const replyingId = replying?.id
  // The message box an element is picked for: the draft's, or the reply's.
  const writingIn = drafting ? DRAFT : replyingId

  // The picker goes with the message box it picks for: off while the reader is elsewhere.
  const picksFor = open && attachingTo === writingIn ? writingIn : undefined

  /** The element picked is the message's target, in place of the one it had. */
  const attachElement = useCallback(
    (element: Element) => {
      setAttachingTo(undefined)
      const added = pickedOf(element)
      if (!added) return
      if (writingIn === DRAFT) {
        setDraft((current) => current && { ...untargeted(current), elements: [added] })
        return
      }
      if (!writingIn) return
      setFollowUp((current) => retargetedReply(current, writingIn, { elements: [added] }))
    },
    [pickedOf, writingIn],
  )

  /**
   * A message box's target slot: with no target, what to point at; else the
   * target's card, its action picking another in its place, and ✕.
   */
  const targetSlot = (
    forThread: string | undefined,
    element: ReviewPickedElement | undefined,
    area: ReviewArea | undefined,
    areaRoute: string,
    remove: () => void,
  ) => {
    const box = forThread ?? DRAFT
    const pickHere = () => {
      setDrawing(false)
      setAttachingTo(picksFor === box ? undefined : box)
    }
    if (element) {
      const onThisPage = element.route === route
      const show = () =>
        setTarget(
          onThisPage ? elementFromAnchor(root, { ...PAGE_LEVEL, element }) : undefined,
        )
      return (
        <div
          className="an-target"
          data-testid="an-picked"
          onMouseEnter={show}
          onMouseLeave={() => setTarget(undefined)}
        >
          <div className="an-target-text">
            <span className="an-target-title">
              <code>&lt;{element.tag}&gt;</code>
              <span>{element.text || element.selector}</span>
            </span>
            <span className="an-target-detail">{element.selector}</span>
          </div>
          <Button
            small
            variant="tertiary"
            aria-pressed={picksFor === box}
            title={`Point at another element (${keysOf('pick')})`}
            onClick={pickHere}
          >
            Repick
          </Button>
          <IconButton
            icon="x"
            label={`Remove the element <${element.tag}>`}
            onClick={() => {
              setTarget(undefined)
              remove()
            }}
          />
        </div>
      )
    }
    if (area) {
      const drawn = !!area.strokes
      const show = () => setTargetArea(areaRoute === route ? area : undefined)
      return (
        <div
          className="an-target"
          data-testid="an-target-area"
          title={areaSummary(area)}
          onMouseEnter={show}
          onMouseLeave={() => setTargetArea(undefined)}
        >
          <div className="an-target-text">
            <span className="an-target-title">
              <Icon name={drawn ? 'pencil' : 'frame'} />
              <code>
                {drawn
                  ? linesOf(area.strokes?.length ?? 0)
                  : `${area.width} × ${area.height}`}
              </code>
            </span>
            <span className="an-target-detail">{areaHolds(area)}</span>
          </div>
          <Button
            small
            variant="tertiary"
            onClick={() => startDrawing(drawn ? 'sketch' : 'area', forThread)}
          >
            {drawn ? 'Redraw' : 'Reframe'}
          </Button>
          <IconButton
            icon="x"
            label={drawn ? 'Remove the drawing' : 'Remove the area'}
            onClick={() => {
              setTargetArea(undefined)
              remove()
            }}
          />
        </div>
      )
    }
    return (
      <div className="an-target-empty">
        <span>Point at:</span>
        <button
          type="button"
          className="an-target-tool"
          aria-pressed={picksFor === box}
          title={`Point at an element in the page (${keysOf('pick')})`}
          aria-keyshortcuts={ariaKeysOf('pick')}
          onClick={pickHere}
        >
          Element
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          className="an-target-tool"
          title="Draw an area over the page"
          onClick={() => startDrawing('area', forThread)}
        >
          Area
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          className="an-target-tool"
          title="Draw on the page"
          onClick={() => startDrawing('sketch', forThread)}
        >
          Drawing
        </button>
      </div>
    )
  }

  // The comment the reader is writing, shown again rather than lost, as Escape keeps it.
  const showDraft = useCallback(() => {
    setDrawing(false)
    setView('page')
    setThreadId(undefined)
    openPanel()
  }, [openPanel])

  /** Comments, from its shortcut or the strip's (when threads need the reader): the panel, on those threads if any. */
  const openComments = () => {
    // A tool in progress stops: the panel would open over it, inert while the reader draws.
    setDrawing(false)
    setPicking(false)
    if (needYou > 0) {
      setView('all')
      setStatusFilter('asking')
      // A single thread: opened at once, the filtered list behind it.
      setThreadId(needYou === 1 ? asking[0]?.id : undefined)
    }
    openPanel()
    // The strip is gone with the panel: the focus goes into it.
    setToTitle((times) => times + 1)
  }

  /**
   * The strip's Comments: the threads that need the reader if any, else a new
   * comment on the page, or the one the reader was writing, its box focused.
   */
  const commentFromStrip = () => {
    if (needYou > 0) {
      openComments()
      return
    }
    setPicking(false)
    if (draft && written(draft)) showDraft()
    else startDraft(PAGE_LEVEL)
  }

  /** What each keyboard shortcut does, with the state of this render. */
  const onShortcut = useRef<(shortcut: Shortcut) => void>(undefined)
  useLayoutEffect(() => {
    onShortcut.current = (shortcut) => {
      if (shortcut === 'comment') {
        if (draft && written(draft)) showDraft()
        else if (selectionButton && pendingAnchor.current)
          startDraft(pendingAnchor.current)
        else startDraft(PAGE_LEVEL)
      } else if (shortcut === 'pick') {
        // While the reader writes, the element goes into their message, as with its button.
        if (open && writingIn) {
          setDrawing(false)
          setAttachingTo(picksFor ? undefined : writingIn)
          return
        }
        setDrawing(false)
        setPicking((value) => !value)
      } else if (shortcut === 'panel') {
        if (open) close()
        else openComments()
      } else {
        if (draft && written(draft)) {
          showDraft()
          return
        }
        // Not loaded yet, or not there to load: no list to move through.
        if (!page.loaded) return
        if (!page.reachable) {
          toast('No Claude session is watching. Run /annotant:annotant.', true)
          return
        }
        // In the panel's order, newest first, around from one end to the other.
        const listed = comments.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
        if (!listed.length) {
          toast('No comments on this page')
          return
        }
        const at =
          view === 'page' && !drafting
            ? listed.findIndex(({ id }) => id === threadId)
            : -1
        const step = STEPS[shortcut]
        const index =
          at < 0
            ? step > 0
              ? 0
              : listed.length - 1
            : (at + step + listed.length) % listed.length
        const to = listed[index]
        if (to) openFromPage(to)
      }
    }
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The page's own handler took the keys first.
      if (event.defaultPrevented || event.repeat) return
      const shortcut = shortcutOf(event)
      if (!shortcut) return
      // The page's fields keep their keys; in the widget's, the arrows select text.
      const field = fieldOf(event, widget.current)
      if (field === 'page' || (field && (shortcut === 'next' || shortcut === 'previous')))
        return
      event.preventDefault()
      onShortcut.current?.(shortcut)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const cancelAttach = useCallback(() => setAttachingTo(undefined), [])
  const asked = replying && isAsking(replying) ? replying.messages.at(-1) : undefined
  const offered = !!asked?.options?.length
  const ticked = (comment: ReviewComment, question: ReviewMessage) =>
    picked?.id === comment.id && picked.question === question.id ? picked.labels : []

  // From the state at the time of the click: two quick clicks both count.
  const toggle = (comment: ReviewComment, question: ReviewMessage, label: string) =>
    setPicked((current) => {
      const labels =
        current?.id === comment.id && current.question === question.id
          ? current.labels
          : []
      return {
        id: comment.id,
        question: question.id,
        labels: labels.includes(label)
          ? labels.filter((other) => other !== label)
          : [...labels, label],
      }
    })

  // To the conversation's end, and following it from there: the reader's own
  // message may not grow the body, as it takes the place of the message box.
  // Only while a conversation is open: a send ends after the reader may have left it.
  const toLatest = () => {
    if (!inThread.current) return
    following.current = true
    scrollToEnd.current?.()
  }

  /**
   * The reader's answer: the options they chose, then what they typed, unless
   * `withText` is false. One click on a single answer sends it alone: a draft
   * the reader was still writing stays in the box.
   */

  const sendReply = (comment: ReviewComment, choices: string[], withText = true) =>
    void run(async () => {
      const own = withText && followUp?.id === comment.id ? followUp : undefined
      const text = own?.body.trim() ?? ''
      const attached = own?.images ?? []
      const elements = own?.elements ?? []
      const sketch = own?.sketch
      // As a new comment's: the drawing's picture last, while the message has room.
      const pictured = !!sketch && fits([...attached, sketch])
      if (sketch && !pictured) toast(PICTURE_LEFT_OUT)
      const images = pictured ? [...attached, sketch] : attached
      const area =
        own?.area && (pictured ? { ...own.area, pictured: true as const } : own.area)
      await updateComment(comment.id, {
        ...(choices.length ? { choices } : {}),
        ...(text ? { followUp: text } : {}),
        ...(images.length ? { images } : {}),
        ...(elements.length ? { elements } : area ? { area } : {}),
      })
      if (own) setFollowUp(undefined)
      setPicked(undefined)
      setAttachingTo(undefined)
      toLatest()
    })

  // A conversation opens on its latest message; any other view, at its top.
  const screen = openedId ? `thread:${openedId}` : drafting ? 'draft' : view
  useLayoutEffect(() => {
    if (!scroller) return
    inThread.current = screen.startsWith('thread:')
    scroller.scrollTo({ top: inThread.current ? scroller.scrollHeight : 0 })
    following.current = true
  }, [scroller, screen])

  // Measured once per frame at most: on scroll, on resize of the body or of
  // its end (the message box grows as the reader types), and when a message
  // grows the content without resizing either.
  useEffect(() => {
    if (!scroller) return undefined
    // At the end before the content grows, it follows; scrolled up past the
    // threshold, it stays. Only the reader scrolls up: following never does,
    // though the browser may nudge it up a little as the content moves.
    const left = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    let last = scroller.scrollTop
    // How far the body scrolls, as last measured: it follows only when that grows.
    let extent = scroller.scrollHeight - scroller.clientHeight
    // A scroll to the end under way, until it gets there or has had time to:
    // short of the end by then, the reader cut it short.
    let gliding = false
    let glideTimer: ReturnType<typeof setTimeout> | undefined
    const stopGliding = () => {
      gliding = false
      clearTimeout(glideTimer)
    }
    scrollToEnd.current = () => {
      const smooth = !matchMedia(REDUCED_MOTION).matches
      if (smooth) {
        stopGliding()
        gliding = true
        glideTimer = setTimeout(() => {
          gliding = false
          if (left() > NEAR_END) following.current = false
          schedule()
        }, GLIDE_MS)
      }
      scroller.scrollTo({
        top: scroller.scrollHeight - scroller.clientHeight,
        behavior: smooth ? 'smooth' : 'auto',
      })
    }
    const track = () => {
      if (left() <= 1) stopGliding()
      if (left() <= NEAR_END) following.current = true
      else if (!gliding && scroller.scrollTop < last) following.current = false
      last = scroller.scrollTop
    }
    const check = () => {
      const top = scroller.scrollHeight - scroller.clientHeight
      const grew = top > extent
      extent = top
      if (inThread.current && following.current && grew && left() > 1) {
        scrollToEnd.current?.()
      }
      // On its way down, the view needs no button to get there.
      setBelow(!gliding && left() > NEAR_END)
      const end = scroller.querySelector<HTMLElement>('.an-body-end')
      if (!end) return
      const row = hintRow.current
      const endStyle = getComputedStyle(end)
      if (row) hintHeight.current = row.offsetHeight + parseFloat(endStyle.rowGap)
      // Where the end of the body would sit with the hint row under the box,
      // whether the row is there now or in the foot: measured from the content
      // before it, as a stuck end sits wherever the scroll puts it.
      const before = end.previousElementSibling
      const origin = scroller.getBoundingClientRect().top - scroller.scrollTop
      const start = before
        ? before.getBoundingClientRect().bottom -
          origin +
          parseFloat(getComputedStyle(scroller).rowGap)
        : parseFloat(getComputedStyle(scroller).paddingTop)
      const height =
        parseFloat(endStyle.marginTop) + end.offsetHeight + (row ? 0 : hintHeight.current)
      setOverflowing(start + height > scroller.clientHeight)
    }
    let frame = 0
    const schedule = () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0
        check()
      })
    }
    const onScroll = () => {
      track()
      schedule()
    }
    check()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    const resizes = new ResizeObserver(schedule)
    resizes.observe(scroller)
    const end = scroller.querySelector('.an-body-end')
    if (end) resizes.observe(end)
    const mutations = new MutationObserver(schedule)
    mutations.observe(scroller, { childList: true, subtree: true, characterData: true })
    return () => {
      cancelAnimationFrame(frame)
      stopGliding()
      scrollToEnd.current = undefined
      scroller.removeEventListener('scroll', onScroll)
      resizes.disconnect()
      mutations.disconnect()
    }
  }, [scroller])

  // The page view lists only this page's comments: leaving a draft or a thread
  // for an empty one showed a blank panel, so fall back to the open comments.
  /** The open thread came from a card pressed with the keyboard. */
  const [openedByKeys, setOpenedByKeys] = useState(false)

  const backToList = () => {
    // The button or the message box it came from goes: the focus stays in the panel.
    if (panel.current?.contains(focusedElement() ?? null))
      setToTitle((times) => times + 1)
    setThreadId(undefined)
    setDraft(undefined)
    if (view === 'page' && comments.length === 0) {
      setView('all')
      setStatusFilter('open')
    }
  }

  const composing = drafting || !!replying
  // The draft is about its text, its element or its area: the page is its scope.
  const draftTargeted = !!draft?.quote || !!draft?.area || !!draft?.elements?.length
  const sendHint = <span className="an-send-hint">Enter to send</span>
  const cancelDraft = (
    <Button small variant="tertiary" className="an-composer-cancel" onClick={backToList}>
      Cancel
    </Button>
  )

  // The element the message being written will mark stays outlined, as its
  // text would, when it is on this page.
  const [writtenFor] = (drafting ? draft.elements : replyElements) ?? []
  const outlined =
    target ??
    flash ??
    (writtenFor?.route === route
      ? elementFromAnchor(root, { ...PAGE_LEVEL, element: writtenFor })
      : undefined)
  // The area the message being written was drawn on stays outlined, as its text would.
  const outlinedArea =
    targetArea ??
    flashArea ??
    (drafting && draftHere
      ? draft.area
      : replyArea?.route === route
        ? replyArea
        : undefined)

  const centerOn = (anchor: ReviewAnchor, id?: string) => {
    const element = elementFromAnchor(root, anchor)
    if (element) spotlight(element, id)
  }

  const goToPage = (href: string, anchor: ReviewAnchor, id?: string) => {
    const url = new URL(href, window.location.href)
    writeSession(CENTER_KEY, { anchor, path: url.pathname, id })
    window.location.assign(url.pathname + url.search)
  }

  /** `href` is the comment's page, visited first when it is not this one. */
  const elementChip = (anchor: ReviewAnchor, href?: string, id?: string) => {
    if (!anchor.element) return null
    const onThisPage = !href || new URL(href, window.location.href).pathname === route
    const show = () => setTarget(onThisPage ? elementFromAnchor(root, anchor) : undefined)
    return (
      <button
        type="button"
        className="an-element"
        title={anchor.element.selector}
        data-testid="an-element"
        onMouseEnter={show}
        onMouseLeave={() => setTarget(undefined)}
        onFocus={show}
        onBlur={() => setTarget(undefined)}
        onClick={(event) => {
          event.stopPropagation()
          if (onThisPage) return centerOn(anchor, id)
          setTarget(undefined)
          goToPage(href, anchor, id)
        }}
      >
        <code>&lt;{anchor.element.tag}&gt;</code>
        <span>{anchor.element.text || anchor.element.selector}</span>
      </button>
    )
  }

  /** Like `elementChip`: hovered or focused, the area shows again on the page; clicked, the page scrolls to it. */
  const areaChip = (anchor: ReviewAnchor, href?: string, id?: string) => {
    const { area } = anchor
    if (!area) return null
    const onThisPage = !href || new URL(href, window.location.href).pathname === route
    const show = () => setTargetArea(onThisPage ? area : undefined)
    return (
      <button
        type="button"
        className="an-element an-area-chip"
        title={areaSummary(area)}
        data-testid="an-area-chip"
        onMouseEnter={show}
        onMouseLeave={() => setTargetArea(undefined)}
        onFocus={show}
        onBlur={() => setTargetArea(undefined)}
        onClick={(event) => {
          event.stopPropagation()
          if (onThisPage) return spotlightArea(area, id)
          setTargetArea(undefined)
          goToPage(href, anchor, id)
        }}
      >
        <Icon name={area.strokes ? 'pencil' : 'frame'} />
        <code>
          {area.strokes ? (
            linesOf(area.strokes.length)
          ) : (
            <>
              {area.width} × {area.height}
            </>
          )}
        </code>
        <span>{areaContents(area)}</span>
      </button>
    )
  }

  const anchorDetails = (comment: ReviewComment) => {
    const { anchor } = comment
    return (
      <>
        {anchor.section && <span className="an-section">{anchor.section}</span>}
        {anchor.quote && <blockquote className="an-quote">{anchor.quote}</blockquote>}
        {elementChip(anchor, pagePath(comment.url) || comment.route, comment.id)}
        {areaChip(anchor, pagePath(comment.url) || comment.route, comment.id)}
        {!anchor.quote && !anchor.element && !anchor.area && (
          <span className="an-section">{scopeLabel(comment)}</span>
        )}
      </>
    )
  }

  const deleteButton = (comment: ReviewComment) =>
    !isActive(comment) && (
      <IconButton
        className="an-delete"
        icon="trash"
        label="Delete this discussion"
        danger
        data-testid="an-delete"
        onClick={(event) => {
          event.stopPropagation()
          if (comment.id === threadId) setThreadId(undefined)
          void run(() => deleteComment(comment.id))
        }}
      />
    )

  /** Draws `comment` with `draw`, or says it cannot, and still offers to delete it. */
  const guarded = (comment: ReviewComment, draw: () => ReactNode) => (
    <Boundary
      key={comment.id}
      resetOn={comment}
      fallback={
        <article className="an-item an-summary" data-testid="annotant-error">
          <div className="an-summary-head">
            <span className="an-idle">This comment could not be shown.</span>
            {deleteButton(comment)}
          </div>
        </article>
      }
    >
      {draw}
    </Boundary>
  )

  const renderItem = (comment: ReviewComment) => (
    <article key={comment.id} className="an-item an-discussion">
      <div className="an-item-top">
        <div>
          {anchorDetails(comment)}
          <ModelLabel comment={comment} />
        </div>
        {deleteButton(comment)}
      </div>
      <div className="an-chat">
        {comment.messages.map((message, index, messages) =>
          message.author === 'claude' ? (
            // Its steps were only there to wait on it: an answer shows alone.
            <Message
              key={message.id}
              author="claude"
              at={message.at}
              dated={dated.has(`${comment.id}/${message.id}`)}
              onToggle={() => toggleDate(`${comment.id}/${message.id}`)}
            >
              {message.question ? (
                <Question
                  message={message}
                  live={index === messages.length - 1 && isAsking(comment)}
                  chosen={messages[index + 1]?.choices ?? []}
                  picked={ticked(comment, message)}
                  busy={busy}
                  onToggle={(label) => toggle(comment, message, label)}
                  onAnswer={(choices, withText) => sendReply(comment, choices, withText)}
                />
              ) : (
                <div className="an-bubble an-bubble--claude">{message.body}</div>
              )}
            </Message>
          ) : (
            <Message
              key={message.id}
              author="reader"
              at={message.at}
              dated={dated.has(`${comment.id}/${message.id}`)}
              onToggle={() => toggleDate(`${comment.id}/${message.id}`)}
            >
              {message.images?.length ? (
                <div className="an-images">
                  {message.images.map((name, image) => (
                    <a
                      key={name}
                      href={imageUrl(comment.id, name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open the image"
                    >
                      <img
                        src={imageUrl(comment.id, name)}
                        alt={`Attached image ${image + 1}`}
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              ) : null}
              {message.elements?.length || message.area ? (
                // Its target, above its bubble: older messages may hold several elements.
                <div className="an-msg-elements" data-testid="an-msg-elements">
                  {message.elements?.map((element, place) => (
                    // oxlint-disable-next-line react/no-array-index-key -- the message's elements never move
                    <Fragment key={place}>
                      {elementChip({ ...PAGE_LEVEL, element }, element.route, comment.id)}
                    </Fragment>
                  ))}
                  {message.area &&
                    areaChip(
                      { ...PAGE_LEVEL, area: message.area },
                      message.area.route,
                      comment.id,
                    )}
                </div>
              ) : null}
              {message.body && (
                <div className="an-bubble an-bubble--reader">{message.body}</div>
              )}
            </Message>
          ),
        )}
      </div>
      {isActive(comment) &&
        (comment.state === 'working' ? (
          <div data-testid="an-working">
            <CurrentStep step={comment.progress?.at(-1)} />
          </div>
        ) : watching ? (
          <Waiting notifiedAt={openingOf(comment)?.notifiedAt} reply={isReply(comment)} />
        ) : (
          <div className="an-idle" data-testid="an-unwatched">
            No Claude session is watching. Run /annotant:annotant.
          </div>
        ))}
      {paused(comment) && (
        <div className="an-stopped" data-testid="an-cancelled">
          <strong>
            {gaveUp(comment)
              ? 'Claude stopped without finishing.'
              : 'Claude was stopped.'}
          </strong>{' '}
          {comment.cancellation?.changed.length ? (
            <>
              It had already changed{' '}
              {comment.cancellation.changed.map((file, index) => (
                <Fragment key={file}>
                  {index > 0 && ', '}
                  <code>{file}</code>
                </Fragment>
              ))}
              . Those changes are still in the working tree.
            </>
          ) : comment.cancellation?.steps ? (
            `It had looked around (${comment.cancellation.steps} steps) but changed no file.`
          ) : (
            'It had not started yet.'
          )}
        </div>
      )}
      {paused(comment) && (
        <form
          className="an-form"
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault()
            const body = (
              resend?.id === comment.id ? resend.body : latestText(comment)
            ).trim()
            // With its images or elements, the comment may go again with no words.
            if (!body && !latestAttached(comment)) return
            void run(async () => {
              await updateComment(comment.id, { text: body, cancelled: false })
              setResend(undefined)
              toLatest()
            })
          }}
        >
          <Textarea
            aria-label="Edit the comment before sending it again"
            value={resend?.id === comment.id ? resend.body : latestText(comment)}
            onChange={(event) => setResend({ id: comment.id, body: event.target.value })}
          />
          <div className="an-actions">
            <Button small type="submit" icon="send" disabled={busy}>
              Send again
            </Button>
          </div>
        </form>
      )}
      <div className="an-actions">
        {isActive(comment) ? (
          <Button
            small
            variant="secondary"
            data-testid="an-cancel"
            onClick={(event) => {
              event.stopPropagation()
              void run(() => updateComment(comment.id, { cancelled: true }))
            }}
          >
            Cancel
          </Button>
        ) : (
          (isAsking(comment) || answered(comment) || paused(comment)) && (
            <Button
              small
              variant="tertiary"
              onClick={(event) => {
                event.stopPropagation()
                void run(() => updateComment(comment.id, { status: 'resolved' }))
              }}
            >
              Resolve
            </Button>
          )
        )}
      </div>
    </article>
  )

  const renderSummary = (comment: ReviewComment, showPage: boolean) => {
    const status = statusOf(comment)
    const href =
      pagePath(comment.url) || (comment.route === APP_ROUTE ? '' : comment.route)
    const messages = comment.messages.length
    const model = modelOf(comment)
    return (
      <article
        key={comment.id}
        data-testid="an-summary"
        className={`an-item an-summary ${comment.state === 'resolved' ? 'an-item--faded' : ''} ${comment.id === activeId ? 'an-item--active' : ''}`}
        onClick={(event) => {
          // A click of no press, from Enter or Space: the card goes, the focus goes to the thread.
          setOpenedByKeys(event.detail === 0)
          if (showPage) setThreadId(comment.id)
          else jump(comment)
        }}
      >
        {/* For the keyboard: behind the card, its click reaches the card's. */}
        <button
          type="button"
          className="an-summary-open"
          aria-label={gist(comment.messages[0]) || 'Open the discussion'}
        />
        <div className="an-summary-head">
          <Chip tone={status}>{STATUS_CHIPS[status]}</Chip>
          {!href ? (
            <span className="an-label">Whole app</span>
          ) : showPage ? (
            <a
              className="an-page"
              href={href}
              title={comment.url ?? href}
              onClick={(event) => event.stopPropagation()}
            >
              <span>{href}</span>
              <Icon name="external" />
            </a>
          ) : (
            <span className="an-label" title={comment.anchor.section}>
              {comment.anchor.section}
            </span>
          )}
          <DateTime at={comment.createdAt} />
          {deleteButton(comment)}
        </div>
        <p>{gist(comment.messages[0])}</p>
        {(messages > 2 || model) && (
          <span className="an-author">
            <ModelLabel comment={comment} />
            {model && messages > 2 && ' · '}
            {messages > 2 && `${messages} messages`}
          </span>
        )}
      </article>
    )
  }

  const filtered = all.comments
    .filter(
      (comment) =>
        statusFilter === 'all' ||
        (statusFilter === 'asking'
          ? isAsking(comment)
          : (comment.state === 'resolved') === (statusFilter === 'resolved')),
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))

  const allCommentsView = () => (
    <>
      <Toggle
        label="Filter by status"
        value={statusFilter}
        onChange={setStatusFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'open', label: 'Open' },
          { value: 'asking', label: 'Needs you' },
          { value: 'resolved', label: 'Resolved' },
        ]}
      />
      {!all.loaded ? (
        <Spinner size={24} />
      ) : filtered.length === 0 ? (
        <div className="an-empty" data-testid="annotant-empty">
          <Button icon="plus" onClick={() => startDraft(PAGE_LEVEL)}>
            New comment
          </Button>
        </div>
      ) : (
        filtered.map((comment) => guarded(comment, () => renderSummary(comment, true)))
      )}
    </>
  )

  return (
    <div
      ref={widget}
      className="an"
      data-theme={dark ? 'dark' : 'light'}
      // Not the ups: the area drawer and the panel's resize end on the page's.
      onPointerDown={keepPress}
      onMouseDown={keepPress}
      onClick={keepPress}
      onTouchStart={keepPress}
      onTouchEnd={keepPress}
    >
      <ElementMarks root={root} comments={comments} onOpen={openFromPage} />
      <AreaMarks root={root} comments={comments} onOpen={openFromPage} />
      <QuoteBubbles root={root} comments={comments} onOpen={openFromPage} />
      {outlined && <TargetOutline element={outlined} />}
      {outlinedArea && !drawing && <AreaOutline root={root} area={outlinedArea} />}
      {picking && (
        <ElementPicker root={root} onPick={pickElement} onCancel={cancelPick} />
      )}
      {picksFor && (
        <ElementPicker
          root={root}
          hint="Click an element to add it to your message. Escape cancels."
          onPick={attachElement}
          onCancel={cancelAttach}
        />
      )}
      {selectionButton && (
        <Button
          small
          icon="chat"
          className="an-selection an-live"
          data-testid="an-selection"
          title={`Comment on the selected text (${keysOf('comment')})`}
          aria-keyshortcuts={ariaKeysOf('comment')}
          style={{ top: selectionButton.top, left: selectionButton.left }}
          onClick={() => pendingAnchor.current && startDraft(pendingAnchor.current)}
        >
          Comment
        </Button>
      )}

      {/* Under the dock, whose Cancel must stay within reach, and under the panel,
          which is inert while it draws. */}
      {drawing === 'area' && (
        <AreaDrawer root={root} onDraw={drawArea} onCancel={cancelDraw} />
      )}
      {drawing === 'sketch' && (
        <SketchDrawer
          lines={sketchFrom}
          onLines={keepLines}
          onDraw={drawSketch}
          onCancel={cancelDraw}
        />
      )}
      {!open && (
        // Icons only, their names in the tooltips: a tool in progress shows its Cancel.
        <div
          ref={dock}
          role="group"
          aria-label="Annotant tools"
          className="an-dock an-live"
          data-moving={moving ? true : undefined}
          style={
            moving
              ? { ...moving, right: 'auto', bottom: 'auto' }
              : shownStrip && placeStyle(shownStrip)
          }
        >
          <button
            type="button"
            className="an-grip"
            aria-label="Move Annotant tools"
            title="Move (drag, or the arrow keys). Double-click to put back"
            onMouseDown={startMove}
            onKeyDown={moveByKey}
            onDoubleClick={() => setStrip(undefined)}
          >
            <Icon name="grip" />
          </button>
          <ToolButton
            icon="frame"
            label="Draw area"
            active={drawing === 'area'}
            onClick={() =>
              drawing === 'area' ? setDrawing(false) : startDrawing('area')
            }
          />
          <ToolButton
            icon="pencil"
            label="Draw"
            active={drawing === 'sketch'}
            onClick={() =>
              drawing === 'sketch' ? setDrawing(false) : startDrawing('sketch')
            }
          />
          <ToolButton
            icon="cursor"
            label="Point at element"
            active={picking}
            title={`${picking ? 'Stop pointing' : 'Point at an element'} (${keysOf('pick')})`}
            aria-keyshortcuts={ariaKeysOf('pick')}
            onClick={() => {
              setDrawing(false)
              setPicking((value) => !value)
            }}
          />
          <span className="an-dock-rule" aria-hidden="true" />
          <button
            type="button"
            className="an-comments"
            aria-label={commentsName}
            title={`${commentsName} (${keysOf('panel')})`}
            aria-keyshortcuts={ariaKeysOf('panel')}
            onClick={commentFromStrip}
          >
            <Icon name="chat" />
            {needYou > 0 && (
              <span className="an-needs-you" aria-hidden="true">
                {needYou}
              </span>
            )}
          </button>
        </div>
      )}

      {(open || leaving) && (
        <section
          ref={panel}
          className={`an-panel an-live ${docked ? 'an-panel--docked' : ''}`}
          style={{ width }}
          data-closing={!open || undefined}
          data-restored={restored || undefined}
          data-drawing={drawing || undefined}
          // While the reader draws, the message box must not take Escape or Enter.
          inert={!open || !!drawing}
          aria-label="Annotant"
          data-testid="annotant-panel"
          onKeyDownCapture={(event) => {
            // The list of shortcuts goes first, before the message box's Escape. The
            // picker's comes before both: its own listener, on the document, hears it after.
            if (event.nativeEvent.isComposing) return
            if (event.key !== 'Escape' || !showKeys || picksFor || picking) return
            event.preventDefault()
            event.stopPropagation()
            setShowKeys(false)
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.defaultPrevented) return
            if (event.key === '?' && !fieldOf(event.nativeEvent)) {
              event.preventDefault()
              setShowKeys((shown) => !shown)
              return
            }
            // After the message box's Escape, and the picker's (see above).
            if (event.key !== 'Escape' || picksFor || picking) return
            close()
          }}
        >
          <div
            className="an-resize"
            data-dragging={dragging || undefined}
            title="Drag to resize"
            onMouseDown={startResize}
          />
          <header className="an-header">
            <div className="an-title">
              {(thread || drafting) && (
                <IconButton
                  icon="arrow-left"
                  label="Back to the list"
                  autoFocus={openedByKeys}
                  onClick={backToList}
                />
              )}
              <h2 ref={title} tabIndex={-1}>
                {drafting
                  ? 'New comment'
                  : thread
                    ? 'Comment'
                    : view === 'all'
                      ? 'All comments'
                      : 'Comments'}
              </h2>
            </div>
            <div className="an-header-actions">
              {ANNOTANT_DEBUG && <DebugToggle />}
              {view !== 'all' && (
                <IconButton
                  icon="chats"
                  label="All comments"
                  onClick={() => {
                    setView('all')
                    setStatusFilter('open')
                    setThreadId(undefined)
                    setDraft(undefined)
                  }}
                />
              )}
              <IconButton
                icon="plus"
                label="New comment"
                keys={keysOf('comment')}
                aria-keyshortcuts={ariaKeysOf('comment')}
                disabled={drafting}
                onClick={() => startDraft(PAGE_LEVEL)}
              />
              <IconButton
                icon={docked ? 'collapse-horizontal' : 'expand-horizontal'}
                label={docked ? 'Narrow panel' : 'Widen panel to half the page'}
                onClick={toggleDocked}
              />
              <IconButton
                icon="x"
                label="Close"
                keys={keysOf('panel')}
                aria-keyshortcuts={ariaKeysOf('panel')}
                onClick={close}
              />
            </div>
          </header>
          <div className="an-body" ref={setScroller}>
            {showKeys && (
              <section
                className="an-keys"
                aria-label="Keyboard shortcuts"
                data-testid="an-keys"
              >
                <dl>
                  {SHORTCUT_LIST.map((shortcut) => (
                    <Fragment key={shortcut}>
                      <dt>
                        <kbd>{keysOf(shortcut)}</kbd>
                      </dt>
                      <dd>{SHORTCUTS[shortcut].does}</dd>
                    </Fragment>
                  ))}
                  <dt>
                    <kbd>↑ ↓ ← →</kbd>
                  </dt>
                  <dd>
                    Pointing at an element, out of a text box: to its parent, first child
                    or siblings
                  </dd>
                  <dt>
                    <kbd>Enter</kbd>
                  </dt>
                  <dd>
                    Pointing at an element, out of a text box: pick the one outlined
                  </dd>
                  <dt>
                    <kbd>Escape</kbd>
                  </dt>
                  <dd>
                    Stop pointing or drawing; else close this list; else leave an empty
                    message; else close the panel
                  </dd>
                  <dt>
                    <kbd>?</kbd>
                  </dt>
                  <dd>Show or hide this list</dd>
                </dl>
              </section>
            )}
            <Boundary
              // Somewhere else in the panel, it draws again.
              key={`${view} ${threadId ?? ''} ${drafting}`}
              fallback={
                <div className="an-empty" data-testid="annotant-error">
                  <span className="an-idle">This could not be shown.</span>
                </div>
              }
            >
              {() => (
                <>
                  {view === 'all' &&
                    (thread
                      ? guarded(thread, () => renderItem(thread))
                      : allCommentsView())}
                  {drafting && (draft.section || draft.quote || !draftTargeted) && (
                    <div className="an-form">
                      {draft.section && (
                        <span className="an-section">{draft.section}</span>
                      )}
                      {draft.quote && (
                        <blockquote className="an-quote">{draft.quote}</blockquote>
                      )}
                      {/* With no target, the comment is about this page, or the whole app. */}
                      {!draftTargeted && (
                        <div className="an-draft-scope">
                          <Checkbox
                            checked={!draft.app}
                            onChange={(checked) => setDraft({ ...draft, app: !checked })}
                          >
                            Only on {pagePath(draft.url) || draft.route}
                          </Checkbox>
                        </div>
                      )}
                    </div>
                  )}
                  {view === 'page' &&
                    !drafting &&
                    thread &&
                    guarded(thread, () => renderItem(thread))}
                  {view === 'page' &&
                    !drafting &&
                    !thread &&
                    comments
                      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
                      .map((comment) =>
                        guarded(comment, () => renderSummary(comment, false)),
                      )}
                </>
              )}
            </Boundary>
            {/* The end of the body: the message box follows the content, and
                sticks to the panel's bottom once the content overflows. */}
            <div className="an-body-end">
              {below && openedId && (
                <button
                  type="button"
                  className="an-scroll-down"
                  aria-label="Scroll to the latest message"
                  title="Scroll to the latest message"
                  onClick={toLatest}
                >
                  <Icon name="chevron-down" />
                </button>
              )}
              {drafting && (
                <Composer
                  key={draft.key}
                  autoFocus
                  value={draft.body}
                  images={draft.images ?? []}
                  // The selected text is the target, shown above: none other.
                  {...(draft.quote
                    ? {}
                    : {
                        target: targetSlot(
                          undefined,
                          draft.elements?.[0],
                          draft.area,
                          draft.route,
                          () => setDraft((current) => current && untargeted(current)),
                        ),
                      })}
                  targeted={!!draft.elements?.length}
                  placeholder="What should change?"
                  sendLabel="Save"
                  disabled={busy}
                  onChange={(body) =>
                    setDraft((current) => current && { ...current, body })
                  }
                  onAttach={(added) =>
                    setDraft(
                      (current) =>
                        current && { ...current, images: adding(current.images, added) },
                    )
                  }
                  onDetach={(index) =>
                    setDraft(
                      (current) =>
                        current && {
                          ...current,
                          images: removing(current.images, index),
                        },
                    )
                  }
                  onSubmit={() => void save()}
                  // While it picks an element, Escape is the picker's alone.
                  onEscape={() => !picksFor && !written(draft) && backToList()}
                />
              )}
              {replying && (
                <Composer
                  key={replying.id}
                  value={reply}
                  images={replyImages}
                  target={targetSlot(
                    replying.id,
                    replyElements[0],
                    replyArea,
                    replyArea?.route ?? route,
                    () =>
                      setFollowUp((current) => retargetedReply(current, replying.id, {})),
                  )}
                  targeted={!!replyElements.length || !!replyArea}
                  placeholder={
                    offered
                      ? 'Or answer in your own words…'
                      : isAsking(replying)
                        ? 'Answer Claude…'
                        : 'Follow up, clarify, ask for a change…'
                  }
                  disabled={busy}
                  onChange={(value) =>
                    setFollowUp((current) => ({
                      ...(current?.id === replying.id ? current : {}),
                      id: replying.id,
                      body: value,
                    }))
                  }
                  onAttach={(added) =>
                    setFollowUp((current) => {
                      const own = current?.id === replying.id ? current : undefined
                      return {
                        ...own,
                        id: replying.id,
                        body: own?.body ?? '',
                        images: adding(own?.images, added),
                      }
                    })
                  }
                  onDetach={(index) =>
                    setFollowUp(
                      (current) =>
                        current && {
                          ...current,
                          images: removing(current.images, index),
                        },
                    )
                  }
                  // Options already ticked go with the text.
                  onSubmit={() =>
                    sendReply(replying, asked && offered ? ticked(replying, asked) : [])
                  }
                  // Like a new comment's: never at the cost of what the reader wrote.
                  onEscape={() =>
                    !picksFor &&
                    !reply &&
                    !replyImages.length &&
                    !replyElements.length &&
                    !replyArea &&
                    backToList()
                  }
                />
              )}
              {composing && !overflowing && (
                <div className="an-composer-foot" ref={hintRow}>
                  {drafting ? cancelDraft : <span />}
                  {sendHint}
                </div>
              )}
            </div>
          </div>
          <footer className="an-panel-foot">
            <span className="an-composer-brand">
              <img src={working ? antThinking : ant} alt="" draggable={false} />
              <a href={REPOSITORY} target="_blank" rel="noopener noreferrer">
                Annotant v{ANNOTANT_VERSION}
              </a>
            </span>
            {composing && overflowing && (
              <span className="an-panel-foot-hint">
                {drafting && cancelDraft}
                {sendHint}
              </span>
            )}
          </footer>
        </section>
      )}
      {ANNOTANT_DEBUG && (
        <DebugPanel
          held={[...comments, ...(created ? [created] : [])]}
          {...(openedId ? { current: openedId } : {})}
        />
      )}
      <Toasts />
    </div>
  )
}
