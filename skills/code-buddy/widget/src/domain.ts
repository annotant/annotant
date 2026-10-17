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

/** The most elements one message may hold, as lib/format.mjs caps them. */
export const MAX_PICKED = 5

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

/** A rectangle the reader drew over the page; never empty. */
export interface ReviewArea extends ReviewBox {
  /** The viewport's size and scroll when it was drawn; `top` and `left` are from the page's corner. */
  viewport: ReviewSize & { scrollX: number; scrollY: number }
  within?: ReviewHolder
  /** Elements wholly inside the area, the outermost ones only: 10 at most. */
  covers: ReviewNode[]
  /**
   * Elements the area cuts through: its holder's children, and the innermost
   * ones in them, such as the two buttons around a gap; 6 at most.
   */
  crosses: ReviewNode[]
  /** The area held more elements than `covers` and `crosses` keep. */
  truncated?: true
}

export interface ReviewAnchor {
  /** Heading the quote sits under, for a human reader of the JSON file. */
  section: string
  /** Selected text, whitespace-normalised. Empty for a page-level comment. */
  quote: string
  /** Which occurrence of the quote on the page, when it appears several times. */
  occurrence: number
  /** Set when the reader pointed at an element instead of selecting text. */
  element?: ReviewElement
  /** Set when the reader drew a rectangle over the page. */
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
  /** Reader only: the options they picked, also written at the start of `body`. */
  choices?: string[]
  /** Reader only: the images they attached, file names the server serves. */
  images?: string[]
  /** Reader only: the elements they picked in the page with it. */
  elements?: ReviewPickedElement[]
}

interface ReviewCancellation {
  at: string
  /** Files the cancelled agent had already written, relative to the repo. */
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
  /** Latest tool calls of the agent working on it; never stored in the file. */
  progress?: ReviewProgress[]
  /** Every step of every run, with `history=1` only: the debug panel's. */
  history?: ReviewProgress[]
  /** Open only: when the server sent it to the hooks; never stored in the file. */
  notifiedAt?: string
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
  /** With `cancelled: false`: replaces the reader's latest text before re-sending. */
  text?: string
}

type Lifecycle = Pick<ReviewComment, 'state'>

/**
 * Resolved once already: Claude's later answers wait on the reader, and the
 * page no longer marks what the comment is about.
 */
export const wasResolved = (comment: Pick<ReviewComment, 'events'>) =>
  comment.events.some((event) => event.state === 'resolved')

/**
 * Open again on the reader's reply: the thread ends on their message after
 * the comment, which the server sends the hooks as `FOLLOWUP`, for the
 * thread's agent when it still has one. A comment re-sent with only the
 * reader's comment in its thread is `NEW`.
 */
export const isReply = (comment: Pick<ReviewComment, 'messages'>) =>
  comment.messages.length > 1 && comment.messages.at(-1)?.author === 'reader'

/** Waiting for an agent, or worked on by one. */
export function isActive(comment: Lifecycle) {
  return comment.state === 'open' || comment.state === 'working'
}

/** True while Claude waits on the reader: the next move is theirs. */
export function isAsking(comment: Lifecycle) {
  return comment.state === 'asking'
}

/** A comment whose run the reader stopped, until they send it again. */
export const paused = (comment: Lifecycle) => comment.state === 'stopped'

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

const latestOwn = (comment: Pick<ReviewComment, 'messages'>) =>
  comment.messages.findLast((message) => message.author === 'reader')

/** The reader's latest words: their comment, or what they wrote since. */
export function latestText(comment: Pick<ReviewComment, 'messages'>): string {
  return latestOwn(comment)?.body ?? ''
}

/** Whether the reader's latest message holds images or elements: it may go without words. */
export function latestAttached(comment: Pick<ReviewComment, 'messages'>): boolean {
  const own = latestOwn(comment)
  return !!own?.images?.length || !!own?.elements?.length
}

/** What a message says, in one line: its words, or the images or elements that are all it holds. */
export function gist(
  message: Pick<ReviewMessage, 'body' | 'images' | 'elements'> | undefined,
): string {
  if (!message) return ''
  if (message.body) return message.body
  const images = message.images?.length ?? 0
  const elements = message.elements?.length ?? 0
  const parts = [
    images && (images === 1 ? 'an image' : `${images} images`),
    elements && (elements === 1 ? 'an element' : `${elements} elements`),
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
