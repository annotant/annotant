import { modelName } from './activity'

/** Route of a comment about the whole app; it is listed on every page. */
export const APP_ROUTE = '*'

/** Where a comment stands, as lib/format.mjs defines it. */
export type ReviewState =
  'open' | 'working' | 'asking' | 'answered' | 'stopped' | 'resolved'

export interface ReviewElement {
  /** Selector from `body`, unique when it was recorded. */
  selector: string
  tag: string
  /** Visible text, normalised and truncated. */
  text: string
  /** Outer HTML, whitespace-collapsed and truncated, for a human reader. */
  html: string
}

/**
 * An element the reader picked in the page with a message of the thread, on
 * `route`, the page they were on, which may be another than the comment's.
 */
export interface ReviewPickedElement extends ReviewElement {
  route: string
}

/** An element an area covers or cuts through: enough to find it in the code. */
export type ReviewNode = Omit<ReviewElement, 'html'>

/** A box, in CSS pixels. */
export interface ReviewBox {
  top: number
  left: number
  width: number
  height: number
}

interface ReviewSize {
  width: number
  height: number
}

/**
 * The smallest element holding a whole drawn area: the area is found again in
 * it, its width scaled with the holder's, on another viewport or after a
 * layout change.
 */
interface ReviewHolder extends ReviewNode {
  /** Where the area's corner lies in the holder's content, its scroll included. */
  offset: { top: number; left: number }
  /** The holder's size when the area was drawn; never 0. */
  size: ReviewSize
}

/**
 * The element a drawing is placed from: where its area's corner lies from the
 * element's corner, its scroll aside, and the element's size then; never 0.
 */
interface ReviewPin extends ReviewNode {
  offset: { top: number; left: number }
  size: ReviewSize
}

/** A line drawn freehand: its points, `[x, y]` from the area's corner, in CSS pixels. */
export type ReviewStroke = [number, number][]

/**
 * The most strokes a drawing keeps, points a stroke keeps, and points in all,
 * as the server caps them: a drawing stays well under what a request holds.
 */
export const MAX_STROKES = 40
export const MAX_STROKE_POINTS = 400
export const MAX_DRAWING_POINTS = 4000

/** A rectangle the reader drew over the page, or the box of a drawing; never empty. */
export interface ReviewArea extends ReviewBox {
  /** The viewport's size and scroll when it was drawn; `top` and `left` are from the page's corner. */
  viewport: ReviewSize & { scrollX: number; scrollY: number }
  within?: ReviewHolder
  /**
   * Elements wholly inside the area, the outermost ones only: 10 at most. A
   * drawing's, and its `crosses`, are those of a wider box around its lines.
   */
  covers: ReviewNode[]
  /**
   * Elements the area cuts through: its holder's children, and the innermost
   * ones in them, such as the two buttons around a gap; 6 at most.
   */
  crosses: ReviewNode[]
  /** The area held more elements than `covers` and `crosses` keep. */
  truncated?: true
  /** Set when the reader drew freehand: the lines, the area being their box. */
  strokes?: ReviewStroke[]
  /** With `strokes`: the element the longest line points at, under its end or next along it. */
  pointsAt?: ReviewNode
  /**
   * With `strokes`: the element the lines are placed from, the largest wholly
   * in their box or else the one they point at. They follow it, their left
   * offset and width scaled to its width, not the holder's.
   */
  around?: ReviewPin
  /** With `strokes`: the last image of the comment's first message is their picture. */
  pictured?: true
}

/**
 * An area the reader drew, or lines drawn freehand, with a reply, on `route`,
 * the page they were on.
 */
export type ReviewPickedArea = ReviewArea & { route: string }

export interface ReviewAnchor {
  /** Heading the quote sits under, for a human reader of the JSON file. */
  section: string
  /** Selected text, whitespace-normalised. Empty for a page-level comment. */
  quote: string
  /** Which occurrence of the quote on the page, when it appears several times. */
  occurrence: number
  /** The page's text just before and after the quote, to tell its copies apart. */
  prefix?: string
  suffix?: string
  /** How many copies of the quote the page had then. */
  occurrences?: number
  /** Set when the reader pointed at an element instead of selecting text. */
  element?: ReviewElement
  /** Set when the reader drew a rectangle, or freehand, over the page. */
  area?: ReviewArea
}

/** How much work a comment needs, as the hooks' classifier sorts it. */
type ReviewComplexity = 'trivial' | 'standard' | 'hard'

export interface ReviewProgress {
  at: number
  /** A tool (read, edit, bash, search, mcp…), or the agent's thinking or message. */
  kind: string
  /** Thinking the API redacted has an empty label. */
  label: string
  /** Tools only: the call's id, and where it stands. */
  id?: string
  state?: 'running' | 'done' | 'failed'
  error?: string
  /** The run it belongs to: `r1`, `r2`… */
  run?: string
  /** The Claude Code agent that called the tool. */
  agent?: string
  /** `start` only: the model the agent runs on, and the classifier's label. */
  model?: string
  complexity?: ReviewComplexity
}

interface ReviewOption {
  label: string
  description?: string
}

export interface ReviewMessage {
  /** `m1`, `m2`… within the comment. */
  id: string
  author: 'reader' | 'claude'
  /** Claude only: the run that wrote it. */
  run?: string
  body: string
  at: string
  /** Claude only: a question for the reader rather than an answer. */
  question?: boolean
  /** A question only: the answers it offers; the reader may write their own instead. */
  options?: ReviewOption[]
  /** With `options`: the reader may pick several. */
  multiple?: boolean
  /**
   * Claude only: the files the run it closes changed with its file tools or
   * deleted with `rm`, relative to the project (`../` out of it), a file
   * outside the repository by its absolute path, a deleted folder with a `/`
   * at its end; absent when none.
   */
  changed?: string[]
  /** With `changed`: those of them the run created. */
  added?: string[]
  /** With `changed`: those of them the run deleted. */
  deleted?: string[]
  /**
   * With `changed`: the first line the run changed in each file it kept the
   * diff of, from 1, where the editor opens it; a file with no key opens at line 1.
   */
  firstLines?: Record<string, number>
  /** Reader only: the options they picked, also written at the start of `body`. */
  choices?: string[]
  /** Reader only: the images they attached, file names the server serves. */
  images?: string[]
  /** Reader only: the element they picked in the page with it, one at most; older messages may hold several. */
  elements?: ReviewPickedElement[]
  /** Reader only, a reply only, never with `elements`: the area they drew, or the lines, with it. */
  area?: ReviewPickedArea
  /** Reader only, on a message that opened the comment: when they sent it, anew on a re-send. */
  sentAt?: string
  /** With `sentAt`: when the server handed it over to the hooks. */
  notifiedAt?: string
  /** Reader only: sent while run `during` worked, for its agent once its next tool ran. */
  during?: string
  /** Reader only: added with no agent to read it, for the next one. */
  queued?: true
  /** With `during` or `queued`: when an agent got it. */
  readAt?: string
}

interface ReviewCancellation {
  at: string
  /** The files the cancelled agent had changed, as a message's `changed` names them. */
  changed: string[]
  steps: number
  run?: string
}

/** One move of a comment, never overwritten. */
interface ReviewEvent {
  at: string
  /** The state it moved to. */
  state: ReviewState
  by: 'reader' | 'agent' | 'server'
  /** The run it belongs to: a claim (`working`) starts one. */
  run?: string
  /** `working` only: the Claude Code agent that claimed it. */
  agent?: string
  /** `working` only: the model its agent runs on (`claude-haiku-5-5`). */
  model?: string
  /** `working` only: how the classifier sorted the comment, which picked `model`. */
  complexity?: ReviewComplexity
  /** `working` only: where the project was in git when the agent claimed it. */
  git?: GitPlace
}

/**
 * Where the project is in git: its branch, or its short `commit` on a
 * detached HEAD, and `worktree`, its checkout's folder, when it is not the
 * repository's main one.
 */
export interface GitPlace {
  branch?: string
  commit?: string
  worktree?: string
}

/**
 * Where a run changed files: recorded at its first write. `switched`: a later
 * write found the project elsewhere.
 */
interface ReviewWrite extends GitPlace {
  run: string
  at: string
  switched?: GitPlace
}

export interface ReviewComment {
  id: string
  route: string
  /** Full URL when the comment was written, query string and hash included. */
  url?: string
  anchor: ReviewAnchor
  /** Always the last event's. */
  state: ReviewState
  createdAt: string
  /** The whole thread, oldest first: the reader's comment, then the exchange. */
  messages: ReviewMessage[]
  events: ReviewEvent[]
  /** Last cancelled run; kept after a re-send so the next agent sees it. */
  cancellation?: ReviewCancellation
  /** Where each run that changed files wrote them, in git. */
  writes?: ReviewWrite[]
  /** Latest tool calls of the agent working on it; never stored in the file. */
  progress?: ReviewProgress[]
  /** Working only: its agent has changed, or is changing, a file in this run; never stored in the file. */
  edited?: true
  /**
   * Working only: the files this run has changed so far, as a message's
   * `changed`, `added` and `deleted` name them; never stored in the file.
   */
  changed?: string[]
  added?: string[]
  deleted?: string[]
  /** Every step of every run, with `history=1` only: the debug panel's. */
  history?: ReviewProgress[]
  /**
   * With `history=1` only: the lines the server printed about it for the
   * hooks since it started, oldest first; never stored in the file.
   */
  lines?: ReviewLine[]
}

/** A line the server printed for the hooks, as it printed it. */
interface ReviewLine {
  at: string
  line: string
}

/** An image the reader attaches to a message, before it is sent. */
export interface NewImage {
  /** One of the types of scripts/lib/image-limits.json. */
  type: string
  /** Its bytes, in base64. */
  data: string
}

export type NewReviewComment = Pick<ReviewComment, 'route' | 'url' | 'anchor'> & {
  body: string
  images?: NewImage[]
  elements?: ReviewPickedElement[]
}

/** What the reader asks of a comment; the server turns it into a move. */
export interface ReviewCommentPatch {
  /** Resolves it, the reader being satisfied. */
  status?: 'resolved'
  /** true stops the current run; false re-sends the comment to a new agent. */
  cancelled?: boolean
  /** Reopens a resolved comment, or answers Claude's question, with the reader's next message. */
  followUp?: string
  /** Answers Claude's question with options it offered, before any `followUp` text. */
  choices?: string[]
  /**
   * The images the reader attached to their reply: with `followUp` or
   * `choices`, or alone; ignored with only `status` or `cancelled`.
   */
  images?: NewImage[]
  /** The elements the reader picked in the page with their reply, as `images`. */
  elements?: ReviewPickedElement[]
  /** The area the reader drew with their reply, as `images`; never with `elements`. */
  area?: ReviewPickedArea
  /** With `cancelled: false`: replaces the reader's latest text before re-sending. */
  text?: string
}

type Lifecycle = Pick<ReviewComment, 'state'>

/**
 * The element the reader picked last, in their latest message that holds
 * one, when it is still to mark: picked since the thread was last
 * resolved, on a thread not resolved now. It takes the place of the comment's
 * anchor on the page.
 */
export function pickedMark(
  // Without its thread when the server sent it broken: the page's marks are
  // drawn out of the panel's guard, and the others' must still show.
  comment: Pick<ReviewComment, 'state' | 'events'> & { messages?: ReviewMessage[] },
): ReviewPickedElement | undefined {
  if (comment.state === 'resolved') return undefined
  const resolved = comment.events.findLast((event) => event.state === 'resolved')
  const picked = comment.messages?.findLast(
    (message) => message.author === 'reader' && message.elements?.length,
  )
  if (!picked || (resolved && picked.at <= resolved.at)) return undefined
  return picked.elements?.[0]
}

/**
 * The element page `route` marks for a comment: the one picked last, when it
 * was picked there, else the element it is anchored to, until its thread is
 * first resolved.
 */
export function markedElement(
  comment: Parameters<typeof pickedMark>[0] & Pick<ReviewComment, 'anchor'>,
  route: string,
): ReviewElement | undefined {
  const picked = pickedMark(comment)
  if (picked) return picked.route === route ? picked : undefined
  return wasResolved(comment) ? undefined : comment.anchor.element
}

/**
 * Resolved once already: Claude's later answers wait on the reader, and the
 * page no longer marks what the comment is about.
 */
export const wasResolved = (comment: Pick<ReviewComment, 'events'>) =>
  comment.events.some((event) => event.state === 'resolved')

/**
 * The reader's message an open comment waits on, whose `notifiedAt` says
 * when the server handed it over: their latest, unless added while it was
 * open or worked on (`during`, `queued`) and not sent on since (`sentAt`).
 */
export const openingOf = (comment: Pick<ReviewComment, 'messages'>) =>
  comment.messages.findLast(
    (message) =>
      message.author === 'reader' &&
      (!!message.sentAt || (!message.during && !message.queued)),
  )

/**
 * Open again on the reader's reply: it waits on their message after the
 * comment, which the server sends the hooks as `FOLLOWUP`, for the thread's
 * agent when it still has one. A comment re-sent with only the reader's
 * comment to go on is `NEW`.
 */
export const isReply = (comment: Pick<ReviewComment, 'messages'>) => {
  const opening = openingOf(comment)
  return !!opening && opening !== comment.messages[0]
}

/**
 * A message the reader added while the comment was open or worked on that no
 * agent got yet: the agent at work gets it after its next step, the next
 * agent in the thread.
 */
export const isPending = (message: Pick<ReviewMessage, 'during' | 'queued' | 'readAt'>) =>
  (!!message.during || !!message.queued) && !message.readAt

/**
 * The thread in the order the reader sees it: a message added while the
 * comment was worked on takes its place once an agent got it, so an answer
 * written without it comes first; one no agent got yet comes last.
 */
export function threadOrder<
  M extends Pick<ReviewMessage, 'at' | 'during' | 'queued' | 'readAt'>,
>(messages: readonly M[]): M[] {
  const placed = (message: M) =>
    message.during || message.queued
      ? message.readAt
        ? Date.parse(message.readAt)
        : Number.POSITIVE_INFINITY
      : Date.parse(message.at)
  // Stable: messages placed at the same time keep the file's order.
  return messages.toSorted((a, b) => placed(a) - placed(b))
}

/** Waiting for an agent, or worked on by one. */
export function isActive(comment: Lifecycle) {
  return comment.state === 'open' || comment.state === 'working'
}

/** True while Claude waits on the reader: the next move is theirs. */
export function isAsking(comment: Lifecycle) {
  return comment.state === 'asking'
}

/**
 * The panel's order: the threads that need the reader first, then the
 * others, each newest first.
 */
export const byPanelOrder = (
  a: Pick<ReviewComment, 'state' | 'createdAt'>,
  b: Pick<ReviewComment, 'state' | 'createdAt'>,
) => Number(isAsking(b)) - Number(isAsking(a)) || b.createdAt.localeCompare(a.createdAt)

/**
 * A comment whose run stopped, until the reader sends it again: they stopped
 * it, or its agent ended without finishing.
 */
export const paused = (comment: Lifecycle) => comment.state === 'stopped'

/** Stopped by its agent: it ended its turn neither answering nor asking. */
export const gaveUp = (comment: Pick<ReviewComment, 'state' | 'events'>) =>
  paused(comment) && comment.events.at(-1)?.by === 'agent'

/**
 * Its agent changed files, in the run at work or in the one stopped: the
 * page may no longer be what the reader commented on.
 */
export const outdated = (
  comment: Pick<ReviewComment, 'state' | 'edited' | 'cancellation'>,
) => !!comment.edited || (paused(comment) && !!comment.cancellation?.changed.length)

/** Claude answered a follow-up: the reader follows up again or resolves it. */
export const answered = (comment: Lifecycle) => comment.state === 'answered'

/** Each state's chip, in the panel and the debug panel; `working` is "In progress". */
const STATUSES = {
  open: 'open',
  working: 'claimed',
  asking: 'asking',
  answered: 'answered',
  stopped: 'stopped',
  resolved: 'resolved',
} as const satisfies Record<ReviewState, string>

/** A chip's tone: where a comment stands, as the panel shows it. */
export type Status = (typeof STATUSES)[ReviewState]

/** Where a comment stands, as its chip in the panel shows it. */
export const statusOf = (comment: Lifecycle): Status => STATUSES[comment.state]

// The message a re-send sends again: the one the comment was open for.
const latestOwn = openingOf

/** The reader's latest words: their comment, or what they wrote since. */
export function latestText(comment: Pick<ReviewComment, 'messages'>): string {
  return latestOwn(comment)?.body ?? ''
}

/** Whether the reader's latest message holds images, elements or an area: it may go without words. */
export function latestAttached(comment: Pick<ReviewComment, 'messages'>): boolean {
  const own = latestOwn(comment)
  return !!own?.images?.length || !!own?.elements?.length || !!own?.area
}

/** What a message says, in one line: its words, or the images, elements or area that are all it holds. */
export function gist(
  message: Pick<ReviewMessage, 'body' | 'images' | 'elements' | 'area'> | undefined,
): string {
  if (!message) return ''
  if (message.body) return message.body
  const images = message.images?.length ?? 0
  const elements = message.elements?.length ?? 0
  const parts = [
    images && (images === 1 ? 'an image' : `${images} images`),
    elements && (elements === 1 ? 'an element' : `${elements} elements`),
    message.area && (message.area.strokes ? 'a drawing' : 'an area'),
  ].filter(Boolean)
  const said = parts.join(' and ')
  return said.charAt(0).toUpperCase() + said.slice(1)
}

export function normaliseQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * The model of the comment's latest run, and why it was picked; none when
 * that run recorded none: an earlier run's would name a model not at work.
 */
export function modelOf(comment: Pick<ReviewComment, 'events'>) {
  const event = comment.events.findLast((one) => one.state === 'working')
  return event?.model
    ? { id: event.model, name: modelName(event.model), complexity: event.complexity }
    : undefined
}

/** A place's name: its branch, or its commit on a detached HEAD. */
export const placeName = (place: GitPlace) => place.branch ?? place.commit ?? ''

/** A worktree's label: its folder's name; the full path goes in a title. */
export const folderName = (worktree: string) =>
  worktree.split(/[\\/]/).findLast(Boolean) ?? worktree

/** The kinds of step that write a file, as scripts/lib/store.mjs counts them. */
const WRITE_KINDS = new Set(['edit', 'write', 'multiedit', 'delete'])

/**
 * The run at work's last finished write among the steps shown, and whether a
 * step came after it (its hooks had kept the file as it wrote it by then):
 * what its diffs load again on. None when no such write is among them.
 */
export const lastWrite = (steps: readonly ReviewProgress[] | undefined) => {
  const at =
    steps?.findLastIndex(
      (one) =>
        WRITE_KINDS.has(one.kind) && one.state !== 'running' && one.state !== 'failed',
    ) ?? -1
  const step = steps?.[at]
  return step && `${step.id ?? ''}@${step.at}${at < (steps?.length ?? 0) - 1 ? '+' : ''}`
}

// The rule of scripts/lib/git.mjs, which records the moves.
const samePlace = (a: GitPlace, b: GitPlace) =>
  a.branch === b.branch && a.commit === b.commit && a.worktree === b.worktree

/**
 * Where run `run` changed files, with where it started when that was
 * elsewhere (`from`), and where a later write found the project (`switched`):
 * either says the branch changed during the run. None when the run recorded
 * no write.
 */
export function writtenOn(
  comment: Pick<ReviewComment, 'events' | 'writes'>,
  run: string | undefined,
) {
  // A hand-edited file may hold anything: none rather than a broken thread.
  const writes = Array.isArray(comment.writes) ? comment.writes : []
  const write = run ? writes.find((one) => one.run === run) : undefined
  if (!write) return undefined
  const started = comment.events.find(
    (event) => event.state === 'working' && event.run === run,
  )?.git
  return {
    place: write,
    ...(started && !samePlace(started, write) && { from: started }),
    ...(write.switched && { switched: write.switched }),
  }
}
