import {
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
  anchorFromElement,
  anchorFromSelection,
  areaReady,
  elementFromAnchor,
  rangeFromAnchor,
  scrollToArea,
  startRect,
} from './anchors'
import {
  createComment,
  deleteComment,
  imageUrl,
  updateComment,
  useAllComments,
  useComments,
  useRoute,
} from './api'
import {
  APP_ROUTE,
  type NewImage,
  type ReviewAnchor,
  type ReviewArea,
  type ReviewBox,
  type ReviewComment,
  type ReviewMessage,
  type ReviewProgress,
  type Status,
  answered,
  gist,
  isActive,
  isAsking,
  isReply,
  latestImages,
  latestText,
  modelOf,
  paused,
  statusOf,
} from './domain'
import { MAX_IMAGES } from './images'
import { DebugPanel, DebugToggle } from './debug'
import { readSession, writeSession } from './session'
import { setInlineStyle } from './inline'
import { clearHighlights, paintHighlights, scrollToComment } from './highlights'
import {
  AreaDrawer,
  AreaMarks,
  AreaOutline,
  ElementMarks,
  ElementPicker,
  QuoteBubbles,
  TargetOutline,
} from './overlays'
import {
  Boundary,
  Button,
  Checkbox,
  Chip,
  Composer,
  type IconName,
  Icon,
  IconButton,
  Spinner,
  Textarea,
  Toasts,
  Toggle,
  toast,
} from './ui'
import { activityOf, isOngoing, stepKey } from './activity'
import { PANEL_IN_MS, PANEL_OUT_MS } from './styles'
import buddy from './assets/buddy.webp'
import buddyThinking from './assets/buddy-thinking.webp'

const REPOSITORY = 'https://github.com/neolitec/code-buddy'

const PANEL_WIDTH = 380
const MIN_PANEL_WIDTH = 320
const MAX_PANEL_RATIO = 0.8

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
// How close to its end, in pixels, a conversation counts as read to the end.
const NEAR_END = 40
// How long a smooth scroll to the end may take: the button stays away meanwhile.
const GLIDE_MS = 800

const clampWidth = (value: number) =>
  Math.round(
    Math.min(Math.max(value, MIN_PANEL_WIDTH), window.innerWidth * MAX_PANEL_RATIO),
  )
const CENTER: ScrollIntoViewOptions = { behavior: 'smooth', block: 'center' }
const PENDING_CENTER_MS = 5000
const FLASH_MS = 1500
const UI_KEY = 'code-buddy:ui'
const CENTER_KEY = 'code-buddy:center'

type View = 'page' | 'all'
type StatusFilter = 'all' | 'open' | 'resolved'

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
      className={`${className}${failed ? ' cb-current-line--failed' : ''}`}
      title={step?.error}
    >
      <span className="cb-step-icon">
        <Icon name={step ? (STEP_ICONS[step.kind] ?? 'wrench') : 'lightning'} />
      </span>
      {/* The dots inside the text: cut with it, they leave one ellipsis, not two. */}
      <span className="cb-current-text">
        {activityOf(step)}
        {!failed && (
          <span className="cb-dots" aria-hidden="true">
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
    <div className="cb-current" data-testid="cb-progress" aria-live="polite">
      {leaving && (
        <StepLine
          key={`out-${stepKey(leaving)}`}
          step={leaving}
          className="cb-current-line cb-current-line--out"
        />
      )}
      <StepLine
        key={key}
        step={step}
        className={`cb-current-line${leaving ? ' cb-current-line--in' : ''}`}
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
      'Code Buddy runs three agents at a time; one starts on your comment as soon as another ends.',
  },
  {
    after: NO_AGENT_AFTER_MS,
    text: 'No agent has started. Check the Claude Code session watching.',
    title:
      'The server handed your comment over a minute ago and no agent claimed it: the session running /code-buddy says why, or run it again.',
  },
]

/** The same, for the reader's reply in the thread. */
const REPLY_WAITS = [
  { after: 0, text: 'Claude has your reply, an agent is picking it up…' },
  {
    after: BUSY_AFTER_MS,
    text: 'Claude has your reply, waiting for a free agent…',
    title:
      'Code Buddy runs three agents at a time; one picks up your reply as soon as another ends.',
  },
  {
    after: NO_AGENT_AFTER_MS,
    text: 'No agent has picked up your reply. Check the Claude Code session watching.',
    title:
      'The server handed your reply over a minute ago and no agent claimed it: the session running /code-buddy says why, or run it again.',
  },
]

/**
 * An open comment while a session watches: sent, then handed over to the
 * hooks, then, while no agent claims it, waiting for one, then not started.
 * Each return to `open` starts again, with its own `notifiedAt`; `reply` when
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
    <div className="cb-working" data-testid="cb-working" title={wait?.title}>
      <Spinner />
      <span>{wait?.text ?? 'Sent…'}</span>
    </div>
  )
}

// The date as well as the time: a thread can outlive the day it started.
function MessageTime({ at }: { at: string }) {
  return (
    <time className="cb-message-time" dateTime={at}>
      {new Date(at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
    </time>
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
    <div className="cb-ask">
      <span className="cb-ask-label">Question</span>
      <span>{message.body}</span>
      {!!message.options?.length && (
        <div
          className="cb-options"
          role="group"
          aria-label={multiple ? 'Pick one or more answers' : 'Pick an answer'}
          data-testid="cb-options"
        >
          {message.options.map((option) => {
            const on = live
              ? picked.includes(option.label)
              : chosen.includes(option.label)
            return (
              <button
                key={option.label}
                type="button"
                className={`cb-option${on ? ' cb-option--on' : ''}`}
                {...(multiple ? { role: 'checkbox', 'aria-checked': on } : {})}
                disabled={!live || busy}
                onClick={() => {
                  if (multiple) onToggle(option.label)
                  else onAnswer([option.label], false)
                }}
              >
                {multiple && (
                  <span className="cb-option-box">{on && <Icon name="check" />}</span>
                )}
                <span className="cb-option-text">
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
        <div className="cb-actions">
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

/** The images attached so far, with those just pasted or dropped, up to the most taken. */
const adding = (images: NewImage[] = [], added: NewImage[]) =>
  [...images, ...added].slice(0, MAX_IMAGES)

/** The images attached so far, but the one at `index`. */
const removing = (images: NewImage[] = [], index: number) =>
  images.filter((_, other) => other !== index)

/** What the reader wrote or attached in a draft: Escape or a click away would lose it. */
const written = (draft: Pick<Draft, 'body' | 'images'>) =>
  !!draft.body.trim() || !!draft.images?.length

/** Draft keys: each draft gets a message box of its own, its reads with it. */
let drafts = 0

interface Draft extends ReviewAnchor {
  /** Which draft this is, from its start. */
  key: number
  body: string
  /** The images pasted or dropped in the message box. */
  images?: NewImage[]
  app?: boolean
  /** The page the draft was started on: the app may navigate before it is saved. */
  route: string
  url: string
}

interface PendingCenter {
  anchor: ReviewAnchor
  path: string
  id?: string
}

interface UiState {
  open: boolean
  docked: boolean
  width: number
  view: View
  threadId?: string
  statusFilter: StatusFilter
}

const PAGE_LEVEL: ReviewAnchor = { quote: '', occurrence: 0, section: '' }

/** The model Claude worked on the comment with, and the classifier's label. */
function ModelLabel({ comment }: { comment: ReviewComment }) {
  const model = modelOf(comment)
  if (!model) return null
  return (
    <span
      className="cb-model"
      data-testid="cb-model"
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

/** What a drawn area covers, in a few words: the elements inside it, else those it cuts through. */
function areaContents(area: ReviewArea): string {
  const nodes = area.covers.length ? area.covers : area.crosses
  const shown = nodes.slice(0, 3).map((node) => `<${node.tag}>`)
  const hidden = nodes.length - shown.length
  const more = area.truncated ? ` +${hidden}…` : hidden ? ` +${hidden}` : ''
  if (shown.length)
    return `${area.covers.length ? 'covers' : 'across'} ${shown.join(' ')}${more}`
  return area.within ? `in <${area.within.tag}>` : 'on the page'
}

function areaSummary(area: ReviewArea): string {
  return `An area of ${area.width} × ${area.height} px, drawn in a ${area.viewport.width} × ${area.viewport.height} window`
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

export default function App({ root }: { root: Element }) {
  const route = useRoute()
  const [saved] = useState(() => readSession<UiState>(UI_KEY))
  const [open, setOpen] = useState(saved?.open ?? false)
  // Closed, but still on screen while it leaves.
  const [leaving, setLeaving] = useState(false)
  const [docked, setDocked] = useState(saved?.docked ?? false)
  const [width, setWidth] = useState(saved?.width ?? PANEL_WIDTH)
  const [view, setView] = useState<View>(saved?.view ?? 'page')
  const [threadId, setThreadId] = useState(saved?.threadId)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    saved?.statusFilter ?? 'open',
  )
  const [dragging, setDragging] = useState(false)
  const [draft, setDraft] = useState<Draft>()
  const [activeId, setActiveId] = useState<string>()
  const [selectionButton, setSelectionButton] = useState<{
    top: number
    left: number
  }>()
  const [picking, setPicking] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [target, setTarget] = useState<Element>()
  // A drawn area shown again: while its chip is hovered, or for a moment once it is clicked.
  const [targetArea, setTargetArea] = useState<ReviewArea>()
  const [flashArea, setFlashArea] = useState<ReviewArea>()
  const [pendingCenter, setPendingCenter] = useState(
    readSession<PendingCenter>(CENTER_KEY),
  )
  const [flash, setFlash] = useState<Element>()
  const [resend, setResend] = useState<{ id: string; body: string }>()
  const [followUp, setFollowUp] = useState<{
    id: string
    body: string
    images?: NewImage[]
  }>()
  // The options ticked so far, under a question that takes several.
  const [picked, setPicked] = useState<{ id: string; labels: string[] }>()
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

  const page = useComments(route)
  const comments = page.comments
  const all = useAllComments(open && view === 'all')
  // Some agent is on a comment right now.
  const working = [...comments, ...all.comments].some(
    (comment) => comment.state === 'working',
  )
  const watching = page.reachable

  useEffect(() => {
    writeSession(UI_KEY, { open, docked, width, view, threadId, statusFilter })
  }, [open, docked, width, view, threadId, statusFilter])

  // The quote of the comment being written stays marked once the selection is gone,
  // on its own page only: the app may navigate before it is saved.
  const draftHere = draft?.route === route
  const draftQuote = view === 'page' && draftHere ? draft.quote : undefined
  const draftOccurrence = draft?.occurrence ?? 0
  useEffect(() => {
    const drafted = draftQuote
      ? { section: '', quote: draftQuote, occurrence: draftOccurrence }
      : undefined
    const paint = () => paintHighlights(root, drafted)
    paint()
    const observer = new MutationObserver(paint)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      clearHighlights()
    }
  }, [root, draftQuote, draftOccurrence])

  useEffect(() => {
    const onSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection) return
      const anchor = anchorFromSelection(root, selection)
      if (!anchor) {
        setSelectionButton(undefined)
        return
      }
      pendingAnchor.current = anchor
      // The quote's first character: a drag may start past the end of the line above.
      const rect = startRect(rangeFromAnchor(root, anchor) ?? selection.getRangeAt(0))
      setSelectionButton({ top: rect.top - 40, left: rect.left })
    }
    const onScroll = () => setSelectionButton(undefined)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('scroll', onScroll, true)
    }
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
    setLeaving(true)
  }

  const toggleDocked = () => {
    setDocked(!docked)
    setWidth(docked ? PANEL_WIDTH : clampWidth(window.innerWidth / 2))
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
      element.scrollIntoView(CENTER)
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
      writeSession(CENTER_KEY, undefined)
      setPendingCenter(undefined)
    }
    attempt()
    return () => cancelAnimationFrame(frame)
  }, [pendingCenter, root, route, spotlight, spotlightArea])

  const startDraft = useCallback(
    (anchor: ReviewAnchor, body = '', images?: NewImage[]) => {
      setDraft({
        ...anchor,
        key: (drafts += 1),
        body,
        ...(images?.length ? { images } : {}),
        route: window.location.pathname,
        // Never the hash, where a sign-in may leave its token.
        url: window.location.origin + window.location.pathname + window.location.search,
      })
      setView('page')
      setThreadId(undefined)
      setOpen(true)
      setPicking(false)
      setDrawing(false)
      setSelectionButton(undefined)
      window.getSelection()?.removeAllRanges()
    },
    [],
  )

  const pickElement = useCallback(
    (element: Element) => startDraft(anchorFromElement(root, element)),
    [root, startDraft],
  )

  const cancelPick = useCallback(() => setPicking(false), [])

  // Drawn from a page-level draft, or over another area, the area joins what the
  // reader had written and attached; a draft on a text or an element starts over,
  // as when picking.
  const kept =
    view === 'page' && draft && draftHere && !draft.quote && !draft.element
      ? draft
      : undefined
  const keptBody = kept?.body ?? ''
  const keptImages = kept?.images
  const drawArea = useCallback(
    (rect: ReviewBox) => startDraft(anchorFromArea(root, rect), keptBody, keptImages),
    [root, startDraft, keptBody, keptImages],
  )

  const cancelDraw = useCallback(() => setDrawing(false), [])

  const startDrawing = () => {
    setPicking(false)
    setSelectionButton(undefined)
    setDrawing(true)
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
    const { key: _, app, body, images, route: startedOn, url, ...anchor } = draft
    await run(async () => {
      const comment = await createComment({
        anchor,
        body,
        route: app ? APP_ROUTE : startedOn,
        url,
        ...(images?.length ? { images } : {}),
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
    setOpen(true)
    jump(comment)
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
  const reply = replying && followUp?.id === replying.id ? followUp.body : ''
  const replyImages = (replying && followUp?.id === replying.id && followUp.images) || []
  const asked = replying && isAsking(replying) ? replying.messages.at(-1) : undefined
  const offered = !!asked?.options?.length
  const ticked = (comment: ReviewComment) =>
    picked?.id === comment.id ? picked.labels : []

  // From the state at the time of the click: two quick clicks both count.
  const toggle = (comment: ReviewComment, label: string) =>
    setPicked((current) => {
      const labels = current?.id === comment.id ? current.labels : []
      return {
        id: comment.id,
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
      const images = own?.images ?? []
      await updateComment(comment.id, {
        ...(choices.length ? { choices } : {}),
        ...(text ? { followUp: text } : {}),
        ...(images.length ? { images } : {}),
      })
      if (own) setFollowUp(undefined)
      setPicked(undefined)
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
      const end = scroller.querySelector<HTMLElement>('.cb-body-end')
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
    const end = scroller.querySelector('.cb-body-end')
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
  const backToList = () => {
    setThreadId(undefined)
    setDraft(undefined)
    if (view === 'page' && comments.length === 0) {
      setView('all')
      setStatusFilter('open')
    }
  }

  const composing = drafting || !!replying
  const sendHint = <span className="cb-send-hint">Enter to send</span>
  const cancelDraft = (
    <Button small variant="tertiary" className="cb-composer-cancel" onClick={backToList}>
      Cancel
    </Button>
  )

  // The element the comment being written is about stays outlined, as its text would.
  const outlined =
    target ??
    flash ??
    (drafting && draftHere ? elementFromAnchor(root, draft) : undefined)
  // And so does the area it was drawn on.
  const outlinedArea =
    targetArea ?? flashArea ?? (drafting && draftHere ? draft.area : undefined)

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
    return (
      <span
        className="cb-element"
        title={anchor.element.selector}
        data-testid="cb-element"
        onMouseEnter={() =>
          setTarget(onThisPage ? elementFromAnchor(root, anchor) : undefined)
        }
        onMouseLeave={() => setTarget(undefined)}
        onClick={(event) => {
          event.stopPropagation()
          if (onThisPage) return centerOn(anchor, id)
          setTarget(undefined)
          goToPage(href, anchor, id)
        }}
      >
        <code>&lt;{anchor.element.tag}&gt;</code>
        <span>{anchor.element.text || anchor.element.selector}</span>
      </span>
    )
  }

  /** Like `elementChip`: hovered, the area shows again on the page; clicked, the page scrolls to it. */
  const areaChip = (anchor: ReviewAnchor, href?: string, id?: string) => {
    const { area } = anchor
    if (!area) return null
    const onThisPage = !href || new URL(href, window.location.href).pathname === route
    return (
      <span
        className="cb-element cb-area-chip"
        title={areaSummary(area)}
        data-testid="cb-area-chip"
        onMouseEnter={() => setTargetArea(onThisPage ? area : undefined)}
        onMouseLeave={() => setTargetArea(undefined)}
        onClick={(event) => {
          event.stopPropagation()
          if (onThisPage) return spotlightArea(area, id)
          setTargetArea(undefined)
          goToPage(href, anchor, id)
        }}
      >
        <Icon name="frame" />
        <code>
          {area.width} × {area.height}
        </code>
        <span>{areaContents(area)}</span>
      </span>
    )
  }

  const anchorDetails = (comment: ReviewComment) => {
    const { anchor } = comment
    return (
      <>
        {anchor.section && <span className="cb-section">{anchor.section}</span>}
        {anchor.quote && <blockquote className="cb-quote">{anchor.quote}</blockquote>}
        {elementChip(anchor, pagePath(comment.url) || comment.route, comment.id)}
        {areaChip(anchor, pagePath(comment.url) || comment.route, comment.id)}
        {!anchor.quote && !anchor.element && !anchor.area && (
          <span className="cb-section">{scopeLabel(comment)}</span>
        )}
      </>
    )
  }

  const deleteButton = (comment: ReviewComment) =>
    !isActive(comment) && (
      <IconButton
        className="cb-delete"
        icon="trash"
        label="Delete this discussion"
        danger
        data-testid="cb-delete"
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
        <article className="cb-item cb-summary" data-testid="code-buddy-error">
          <div className="cb-summary-head">
            <span className="cb-idle">This comment could not be shown.</span>
            {deleteButton(comment)}
          </div>
        </article>
      }
    >
      {draw}
    </Boundary>
  )

  const renderItem = (comment: ReviewComment) => (
    <article key={comment.id} className="cb-item cb-discussion">
      <div className="cb-item-top">
        <div>
          {anchorDetails(comment)}
          <ModelLabel comment={comment} />
        </div>
        {deleteButton(comment)}
      </div>
      <div className="cb-chat">
        {comment.messages.map((message, index, messages) =>
          message.author === 'claude' ? (
            // Its steps were only there to wait on it: an answer shows alone.
            <div key={message.id} className="cb-msg cb-msg--claude">
              {message.question ? (
                <Question
                  message={message}
                  live={index === messages.length - 1 && isAsking(comment)}
                  chosen={messages[index + 1]?.choices ?? []}
                  picked={ticked(comment)}
                  busy={busy}
                  onToggle={(label) => toggle(comment, label)}
                  onAnswer={(choices, withText) => sendReply(comment, choices, withText)}
                />
              ) : (
                <div className="cb-bubble cb-bubble--claude">{message.body}</div>
              )}
              <MessageTime at={message.at} />
            </div>
          ) : (
            <div key={message.id} className="cb-msg cb-msg--reader">
              {message.images?.length ? (
                <div className="cb-images">
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
              {message.body && (
                <div className="cb-bubble cb-bubble--reader">{message.body}</div>
              )}
              <MessageTime at={message.at} />
            </div>
          ),
        )}
      </div>
      {isActive(comment) &&
        (comment.state === 'working' ? (
          <div data-testid="cb-working">
            {comment.understood && (
              <div className="cb-understood" data-testid="cb-understood">
                <strong>Understood:</strong> {comment.understood}
              </div>
            )}
            <CurrentStep step={comment.progress?.at(-1)} />
          </div>
        ) : watching ? (
          <Waiting notifiedAt={comment.notifiedAt} reply={isReply(comment)} />
        ) : (
          <div className="cb-idle" data-testid="cb-unwatched">
            No Claude session is watching. Run /code-buddy:code-buddy.
          </div>
        ))}
      {paused(comment) && (
        <div className="cb-stopped" data-testid="cb-cancelled">
          <strong>Claude was stopped.</strong>{' '}
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
          className="cb-form"
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault()
            const body = (
              resend?.id === comment.id ? resend.body : latestText(comment)
            ).trim()
            // With its images, the comment may go again with no words.
            if (!body && !latestImages(comment).length) return
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
          <div className="cb-actions">
            <Button small type="submit" icon="send" disabled={busy}>
              Send again
            </Button>
          </div>
        </form>
      )}
      <div className="cb-actions">
        {isActive(comment) ? (
          <Button
            small
            variant="secondary"
            data-testid="cb-cancel"
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
        data-testid="cb-summary"
        className={`cb-item cb-summary ${comment.state === 'resolved' ? 'cb-item--faded' : ''} ${comment.id === activeId ? 'cb-item--active' : ''}`}
        onClick={() => (showPage ? setThreadId(comment.id) : jump(comment))}
      >
        <div className="cb-summary-head">
          <Chip tone={status}>{STATUS_CHIPS[status]}</Chip>
          {!href ? (
            <span className="cb-label">Whole app</span>
          ) : showPage ? (
            <a
              className="cb-page"
              href={href}
              title={comment.url ?? href}
              onClick={(event) => event.stopPropagation()}
            >
              <span>{href}</span>
              <Icon name="external" />
            </a>
          ) : (
            <span className="cb-label" title={comment.anchor.section}>
              {comment.anchor.section}
            </span>
          )}
          <time dateTime={comment.createdAt}>
            {new Date(comment.createdAt).toLocaleString(undefined, {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </time>
          {deleteButton(comment)}
        </div>
        <p>{gist(comment.messages[0])}</p>
        {(messages > 2 || model) && (
          <span className="cb-author">
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
        (comment.state === 'resolved') === (statusFilter === 'resolved'),
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))

  const allCommentsView = () => (
    <>
      <Toggle
        value={statusFilter}
        onChange={setStatusFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'open', label: 'Open' },
          { value: 'resolved', label: 'Resolved' },
        ]}
      />
      {!all.loaded ? (
        <Spinner size={24} />
      ) : filtered.length === 0 ? (
        <div className="cb-empty" data-testid="code-buddy-empty">
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
      className="cb"
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
      {selectionButton && (
        <Button
          small
          icon="chat"
          className="cb-selection cb-live"
          data-testid="cb-selection"
          style={{ top: selectionButton.top, left: selectionButton.left }}
          onClick={() => pendingAnchor.current && startDraft(pendingAnchor.current)}
        >
          Comment
        </Button>
      )}

      {/* Under the dock, whose Cancel must stay within reach, and under the panel,
          which is inert while it draws. */}
      {drawing && <AreaDrawer root={root} onDraw={drawArea} onCancel={cancelDraw} />}
      {!open && (
        <div className="cb-dock cb-live">
          <Button variant="secondary" icon="chat" onClick={() => startDraft(PAGE_LEVEL)}>
            Comment
          </Button>
          <Button
            variant="secondary"
            icon={drawing ? 'x' : 'frame'}
            onClick={() => (drawing ? setDrawing(false) : startDrawing())}
          >
            {drawing ? 'Cancel' : 'Draw area'}
          </Button>
          <Button
            icon={picking ? 'x' : 'cursor'}
            onClick={() => {
              setDrawing(false)
              setPicking((value) => !value)
            }}
          >
            {picking ? 'Cancel' : 'Point at element'}
          </Button>
        </div>
      )}

      {(open || leaving) && (
        <section
          className={`cb-panel cb-live ${docked ? 'cb-panel--docked' : ''}`}
          style={{ width }}
          data-closing={!open || undefined}
          data-drawing={drawing || undefined}
          // While the reader draws, the message box must not take Escape or Enter.
          inert={!open || drawing}
          data-testid="code-buddy-panel"
        >
          <div
            className="cb-resize"
            data-dragging={dragging || undefined}
            title="Drag to resize"
            onMouseDown={startResize}
          />
          <header className="cb-header">
            <div className="cb-title">
              {(thread || drafting) && (
                <IconButton
                  icon="arrow-left"
                  label="Back to the list"
                  onClick={backToList}
                />
              )}
              <h2>
                {drafting
                  ? 'New comment'
                  : thread
                    ? 'Comment'
                    : view === 'all'
                      ? 'All comments'
                      : 'Comments'}
              </h2>
            </div>
            <div className="cb-header-actions">
              {CODE_BUDDY_DEBUG && <DebugToggle />}
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
                disabled={drafting}
                onClick={() => startDraft(PAGE_LEVEL)}
              />
              <IconButton
                icon={docked ? 'collapse-horizontal' : 'expand-horizontal'}
                label={docked ? 'Narrow panel' : 'Widen panel to half the page'}
                onClick={toggleDocked}
              />
              <IconButton icon="x" label="Close" onClick={close} />
            </div>
          </header>
          <div className="cb-body" ref={setScroller}>
            <Boundary
              // Somewhere else in the panel, it draws again.
              key={`${view} ${threadId ?? ''} ${drafting}`}
              fallback={
                <div className="cb-empty" data-testid="code-buddy-error">
                  <span className="cb-idle">This could not be shown.</span>
                </div>
              }
            >
              {() => (
                <>
                  {view === 'all' &&
                    (thread
                      ? guarded(thread, () => renderItem(thread))
                      : allCommentsView())}
                  {drafting && (
                    <div className="cb-form">
                      {draft.section && (
                        <span className="cb-section">{draft.section}</span>
                      )}
                      {draft.quote && (
                        <blockquote className="cb-quote">{draft.quote}</blockquote>
                      )}
                      {elementChip(draft)}
                      {draft.area && (
                        <div className="cb-area-draft">
                          {areaChip(draft)}
                          <IconButton
                            icon="x"
                            label="Remove the area"
                            onClick={() => {
                              const { area: _, ...rest } = draft
                              setTargetArea(undefined)
                              setDraft({ ...rest, ...PAGE_LEVEL })
                            }}
                          />
                        </div>
                      )}
                      {!draft.quote && !draft.element && !draft.area && (
                        <div className="cb-draft-scope">
                          <Checkbox
                            checked={!draft.app}
                            onChange={(checked) => setDraft({ ...draft, app: !checked })}
                          >
                            Linked to the current page ({pagePath(draft.url)})
                          </Checkbox>
                          <Button
                            small
                            variant="tertiary"
                            icon="frame"
                            onClick={startDrawing}
                          >
                            Draw an area
                          </Button>
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
            <div className="cb-body-end">
              {below && openedId && (
                <button
                  type="button"
                  className="cb-scroll-down"
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
                  onEscape={() => !written(draft) && backToList()}
                />
              )}
              {replying && (
                <Composer
                  key={replying.id}
                  value={reply}
                  images={replyImages}
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
                  onSubmit={() => sendReply(replying, offered ? ticked(replying) : [])}
                />
              )}
              {composing && !overflowing && (
                <div className="cb-composer-foot" ref={hintRow}>
                  {drafting ? cancelDraft : <span />}
                  {sendHint}
                </div>
              )}
            </div>
          </div>
          <footer className="cb-panel-foot">
            <span className="cb-composer-brand">
              <img src={working ? buddyThinking : buddy} alt="" draggable={false} />
              <a href={REPOSITORY} target="_blank" rel="noopener noreferrer">
                Code Buddy v{CODE_BUDDY_VERSION}
              </a>
            </span>
            {composing && overflowing && (
              <span className="cb-panel-foot-hint">
                {drafting && cancelDraft}
                {sendHint}
              </span>
            )}
          </footer>
        </section>
      )}
      {CODE_BUDDY_DEBUG && (
        <DebugPanel
          held={[...comments, ...(created ? [created] : [])]}
          {...(openedId ? { current: openedId } : {})}
        />
      )}
      <Toasts />
    </div>
  )
}
