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

export interface ReviewAnchor {
  /** Heading the quote sits under, for a human reader of the JSON file. */
  section: string
  /** Selected text, whitespace-normalised. Empty for a page-level comment. */
  quote: string
  /** Which occurrence of the quote on the page, when it appears several times. */
  occurrence: number
  /** Set when the reader pointed at an element instead of selecting text. */
  element?: ReviewElement
}

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
}

export interface ReviewOption {
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
}

export interface ReviewCancellation {
  at: string
  /** Files the cancelled agent had already written, relative to the repo. */
  changed: string[]
  steps: number
  run?: string
}

/** One move of a comment, never overwritten. */
export interface ReviewEvent {
  at: string
  /** The state it moved to. */
  state: ReviewState
  by: 'reader' | 'agent' | 'server'
  /** The run it belongs to: a claim (`working`) starts one. */
  run?: string
  /** `working` only: the Claude Code agent that claimed it. */
  agent?: string
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
  /** Open only: when the server sent it to the manager; never stored in the file. */
  notifiedAt?: string
  /**
   * With `history=1` only: the lines the server printed about it for the
   * manager since it started, oldest first; never stored in the file.
   */
  lines?: ReviewLine[]
}

/** A line the server printed for the manager, as it printed it. */
export interface ReviewLine {
  at: string
  line: string
}

export type NewReviewComment = Pick<ReviewComment, 'route' | 'url' | 'anchor'> & {
  body: string
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
 * the comment, which the server sends the manager as `FOLLOWUP`, for the
 * thread's agent when it still has one. A re-sent comment is `NEW`.
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

/** Where a comment stands, as its chip in the panel shows it. */
export function statusOf(
  comment: Lifecycle,
): 'open' | 'claimed' | 'asking' | 'answered' | 'resolved' {
  if (comment.state === 'resolved') return 'resolved'
  if (comment.state === 'asking' || comment.state === 'answered') return comment.state
  return comment.state === 'working' ? 'claimed' : 'open'
}

/** The reader's latest words: their comment, or what they wrote since. */
export function latestText(comment: Pick<ReviewComment, 'messages'>): string {
  return comment.messages.findLast((message) => message.author === 'reader')?.body ?? ''
}

export function normaliseQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
