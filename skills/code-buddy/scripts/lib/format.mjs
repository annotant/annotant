// The comments file's format: what every part that reads it agrees on. The
// store writes it; the server, the hooks and the widget read it. Described,
// with the step files, in docs/comments-file.md.

/** The version this code reads and writes; any other is refused. */
export const FORMAT_VERSION = 2

/**
 * Where a comment stands. `open`: waiting for an agent; `working`: an agent
 * claimed it; `asking`: Claude waits on the reader's answer; `answered`:
 * Claude answered a follow-up, and the reader follows up again or resolves it;
 * `stopped`: the reader stopped the run; `resolved`: done.
 * @typedef {'open' | 'working' | 'asking' | 'answered' | 'stopped' | 'resolved'} State
 */

/** @type {readonly State[]} */
export const STATES = ['open', 'working', 'asking', 'answered', 'stopped', 'resolved']

/**
 * The moves a comment may make, from each state. An agent claims (`working`),
 * asks, resolves, or once the comment was resolved, answers (`answered`): only
 * the reader resolves it again. The reader stops, answers, sends again,
 * follows up or resolves it themselves.
 * @type {Readonly<Record<State, readonly State[]>>}
 */
export const TRANSITIONS = {
  open: ['working', 'stopped', 'resolved'],
  working: ['asking', 'answered', 'resolved', 'stopped'],
  asking: ['open', 'resolved'],
  answered: ['open', 'resolved'],
  stopped: ['open', 'resolved'],
  resolved: ['open'],
}

/** @typedef {'reader' | 'agent' | 'server'} Actor */

/**
 * How much work a comment needs, as the hooks' classifier sorts it before
 * its agent starts: `trivial` (copy, spacing, colour, a visible property of
 * one element), `standard` (a component's behaviour, a new element, a small
 * feature) or `hard` (several components or pages, data or API changes, or a
 * product decision). `.code-buddy.json`'s `models` maps each to a model.
 * @typedef {'trivial' | 'standard' | 'hard'} Complexity
 */

/** @type {readonly Complexity[]} */
export const COMPLEXITIES = ['trivial', 'standard', 'hard']

/**
 * @typedef {AreaNode & { html: string }} Element `selector` is from `body`,
 * unique when it was recorded; `text` and `html` (the outer HTML) are
 * whitespace-collapsed and truncated.
 */

/**
 * An element the reader picked in the page while writing a message of the
 * thread: found in the code as the comment's own element is, on `route`, the
 * page they were on, which may be another than the comment's.
 * @typedef {Element & { route: string }} PickedElement
 */

/** The most elements one message may hold. */
export const MAX_PICKED = 5

/**
 * Where on the page a comment is.
 * @typedef {object} Anchor
 * @property {string} section The heading the quote sits under.
 * @property {string} quote The selected text; empty for a page-level comment.
 * @property {number} occurrence Which occurrence of the quote on the page.
 * @property {Element} [element] Set when the reader pointed at an element.
 * @property {Area} [area] Set when the reader drew a rectangle over the page.
 */

/**
 * An element a drawn area covers or crosses: no HTML, an area may hold many;
 * its text is cut to 80 characters.
 * @typedef {{ selector: string, tag: string, text: string }} AreaNode
 * @typedef {{ top: number, left: number, width: number, height: number }} Box
 * @typedef {{ width: number, height: number }} Size
 */

/**
 * The smallest element holding a drawn area: where the area's corner lies in
 * its content (scroll included), and its size then, never 0, to scale the
 * area's width with it on another viewport.
 * @typedef {AreaNode & { offset: { top: number, left: number }, size: Size }} Holder
 */

/**
 * A rectangle the reader drew, from the page's corner, in CSS pixels, never
 * empty. `covers` keeps at most 10 elements and `crosses` 6; `truncated` says
 * the area held more.
 * @typedef {Box & {
 *   viewport: Size & { scrollX: number, scrollY: number },
 *   within?: Holder,
 *   covers: AreaNode[],
 *   crosses: AreaNode[],
 *   truncated?: true,
 * }} Area
 */

/**
 * @typedef {object} Option
 * @property {string} label
 * @property {string} [description]
 */

/**
 * One message of the thread; the first is the reader's comment.
 * @typedef {object} MessageV2
 * @property {string} id `m1`, `m2`… within the comment.
 * @property {'reader' | 'claude'} author
 * @property {string} body
 * @property {string} at
 * @property {string} [run] Claude only: the run that wrote it.
 * @property {boolean} [question] Claude only: a question rather than an answer.
 * @property {Option[]} [options] A question only: the answers it offers.
 * @property {boolean} [multiple] With `options`: the reader may pick several.
 * @property {string[]} [choices] Reader only: the options they picked.
 * @property {string[]} [images] Reader only: the images they attached, file
 *   names in `images/<comment id>/` beside the comments file (images.mjs).
 * @property {PickedElement[]} [elements] Reader only: the elements they picked
 *   in the page with it.
 */

/**
 * One move of the comment, never overwritten.
 * @typedef {object} EventV2
 * @property {string} at
 * @property {State} state The state it moved to.
 * @property {Actor} by
 * @property {string} [run] The run it belongs to: started by `working`.
 * @property {string} [agent] `working` only: the Claude Code agent that
 *   claimed it (`main` for a session's main loop), when the hooks ran.
 * @property {string} [model] `working` only: the model its agent runs on, as
 *   Claude Code resolved it (`claude-haiku-5-5`), when the hooks ran.
 * @property {Complexity} [complexity] `working` only: how the hooks'
 *   classifier sorted the comment, which picked `model`.
 */

/**
 * What a stopped run had done.
 * @typedef {object} Cancellation
 * @property {string} at
 * @property {string[]} changed Files it had written, relative to the repository.
 * @property {number} steps
 * @property {string} [run]
 */

/**
 * @typedef {object} CommentV2
 * @property {string} id
 * @property {string} route `*` for the whole app.
 * @property {string} [url]
 * @property {Anchor} anchor
 * @property {State} state Always the last event's.
 * @property {string} createdAt The reader's comment's time: lists sort by it.
 * @property {MessageV2[]} messages The whole thread, the reader's comment first.
 * @property {EventV2[]} events
 * @property {Cancellation} [cancellation] The last stopped run.
 */

/**
 * One line of a comment's step files (`<id>.jsonl`, `<id>.history.jsonl`),
 * never in the comments file. A tool writes one when it starts and one when it
 * ends or fails, with the same `id`: readers merge them into one step.
 * @typedef {object} Step
 * @property {number} at Milliseconds since the epoch.
 * @property {string} kind `start`, `read`, `edit`, `write`, `multiedit`,
 *   `bash`, `search`, `web`, `mcp`, `skill`, `tool`, `thinking` or `message`.
 * @property {string} label Empty for thinking the API redacted.
 * @property {string} [id] Tools only: Claude Code's tool_use_id.
 * @property {'running' | 'done' | 'failed'} [state] Tools only.
 * @property {string} [error] Why it failed.
 * @property {string} [run] The run it belongs to.
 * @property {string} [agent] The Claude Code agent that called the tool.
 * @property {string} [model] `start` only: the model the agent runs on.
 * @property {Complexity} [complexity] `start` only: the classifier's label.
 */

/**
 * @typedef {object} CommentsFile
 * @property {typeof FORMAT_VERSION} version
 * @property {CommentV2[]} comments
 */

/** A comments file this code does not read: nothing in it is touched. */
export class FormatError extends Error {}

/**
 * The comments file's content, or a FormatError saying what to do.
 * @param {string} text
 * @param {string} [file] Named in the message.
 * @returns {CommentsFile}
 */
export function parseFile(text, file = '.code-buddy/comments.json') {
  const data = JSON.parse(text)
  if (Array.isArray(data)) {
    throw new FormatError(`old comments format: delete ${file}`)
  }
  if (data?.version !== FORMAT_VERSION || !Array.isArray(data.comments)) {
    throw new FormatError(
      `unknown comments format (version ${JSON.stringify(data?.version)}): ` +
        `this Code Buddy reads version ${FORMAT_VERSION}`,
    )
  }
  return data
}

/**
 * @param {State} from
 * @param {State} to
 */
export const canMove = (from, to) => TRANSITIONS[from]?.includes(to) ?? false

/**
 * The next id of the sequence `prefix`1, `prefix`2… after those in `ids`.
 * @param {string} prefix
 * @param {(string | undefined)[]} ids
 */
function nextId(prefix, ids) {
  const used = ids.map((id) =>
    id?.startsWith(prefix) ? Number(id.slice(prefix.length)) || 0 : 0,
  )
  return `${prefix}${Math.max(0, ...used) + 1}`
}

/** @param {Pick<CommentV2, 'messages'>} comment */
export const nextMessageId = (comment) =>
  nextId(
    'm',
    comment.messages.map((message) => message.id),
  )

/** A new run starts with each claim. @param {Pick<CommentV2, 'events'>} comment */
export const nextRunId = (comment) =>
  nextId(
    'r',
    comment.events.map((event) => event.run),
  )

/**
 * Resolved once already: Claude's later answers wait on the reader, and the
 * page no longer marks the anchor.
 * @param {Pick<CommentV2, 'events'>} comment
 */
export const wasResolved = (comment) =>
  comment.events.some((event) => event.state === 'resolved')

/** The run in progress: the one the last event belongs to, while working. */
export const currentRun = (/** @type {Pick<CommentV2, 'state' | 'events'>} */ comment) =>
  comment.state === 'working' ? comment.events.at(-1)?.run : undefined
