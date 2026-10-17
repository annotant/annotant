import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './errors.mjs'
import { withFileLock } from './filelock.mjs'
import { removeImages, saveImages } from './images.mjs'
import {
  COMPLEXITIES,
  FORMAT_VERSION,
  FormatError,
  canMove,
  currentRun,
  nextMessageId,
  nextRunId,
  openingOf,
  parseFile,
  sentKey,
  wasResolved,
} from './format.mjs'
import { isDevWidget } from './project.mjs'

/** @typedef {import('./format.mjs').Actor} Actor */
/** @typedef {import('./format.mjs').CommentV2} CommentV2 */
/** @typedef {import('./format.mjs').Complexity} Complexity */
/** @typedef {import('./images.mjs').Image} Image */
/** @typedef {import('./format.mjs').MessageV2} MessageV2 */
/** @typedef {import('./format.mjs').State} State */

export const APP_ROUTE = '*'
/** The most options a question may offer the reader. */
export const MAX_OPTIONS = 6
const PROGRESS_SHOWN = 10
const WRITE_KINDS = new Set(['edit', 'write', 'multiedit'])
// What the agent says and thinks accompanies its steps; it is not one.
const NARRATION_KINDS = new Set(['thinking', 'message'])

/** Waiting for an agent, or worked on by one: what agents and the server act on. */
export const isActive = (comment) =>
  comment.state === 'open' || comment.state === 'working'

/** Claude asked the reader a question in the thread: nothing to do until they answer. */
export const isAsking = (comment) => comment.state === 'asking'

/** A refusal a script reports to the agent and exits on, with nothing written. */
export class StoreRefusal extends Error {}

/** A model id is short (`claude-haiku-5-5`): the hooks' value, kept bounded. */
const MAX_MODEL = 100

/** @type {Record<State, string>} */
const STATE_WORDS = {
  open: 'open',
  working: 'being worked on',
  asking: "waiting on the reader's answer",
  answered: 'answered, waiting on the reader',
  stopped: 'cancelled',
  resolved: 'resolved',
}

/** Where `comment` stands, in the words the scripts print. */
export const stateOf = (comment) => STATE_WORDS[comment.state] ?? String(comment.state)

/**
 * Moves `comment` to `to`, or refuses a move outside the graph of
 * format.mjs: logs the event, and adds `message` to the thread. Every state
 * change goes through it.
 * @param {CommentV2} comment
 * @param {State} to
 * @param {{ by: Actor, run?: string, agent?: string, model?: string, complexity?: Complexity, message?: Omit<MessageV2, 'id' | 'at'> }} how
 * @returns {string} When it moved.
 */
function move(comment, to, { by, run, agent, model, complexity, message }) {
  if (!canMove(comment.state, to)) {
    throw new StoreRefusal(`comment ${comment.id} is ${stateOf(comment)}`)
  }
  const at = new Date().toISOString()
  comment.events.push({
    at,
    state: to,
    by,
    ...(run ? { run } : {}),
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
    ...(complexity ? { complexity } : {}),
  })
  comment.state = to
  if (message) comment.messages.push({ id: nextMessageId(comment), ...message, at })
  return at
}

/**
 * The comment's steps, oldest first: those of its current run, or with
 * `history`, of every run it had. A tool writes one line when it starts and
 * one when it ends or fails, both with its tool_use_id: they merge into one
 * step, in the place where it started. Sorted by time.
 * @param {{ progressDir: string }} project
 * @param {string} id
 * @param {number} [limit]
 * @param {{ history?: boolean }} [options]
 * @returns {Promise<import('./format.mjs').Step[]>}
 */
export async function readProgress(project, id, limit, { history = false } = {}) {
  let lines
  try {
    const file = history ? historyPath(project, id) : progressPath(project, id)
    lines = (await readFile(file, 'utf8')).trim().split('\n')
  } catch {
    return []
  }
  const steps = []
  const byTool = new Map()
  for (const line of lines) {
    let step
    try {
      step = JSON.parse(line)
    } catch {
      continue
    }
    const started = step.id ? byTool.get(step.id) : undefined
    if (started) {
      Object.assign(started, step, { at: started.at })
    } else {
      steps.push(step)
      if (step.id) byTool.set(step.id, step)
    }
  }
  // By time: the hooks module writes what the agent thinks while hook.mjs
  // writes its tools, and either may land first.
  steps.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  return limit ? steps.slice(-limit) : steps
}

/** @param {string} file */
const readOrEmpty = (file) => readFile(file, 'utf8').catch(() => '')

/**
 * The comment's step files as they are on disk, one JSON line per step: the
 * runs that ended, then the one in progress. Empty when it has none.
 * @param {{ progressDir: string }} project
 * @param {string} id
 */
export async function stepFiles(project, id) {
  return (
    (await readOrEmpty(historyPath(project, id))) +
    (await readOrEmpty(progressPath(project, id)))
  )
}

/** The step file of comment `id`'s current run. */
export const progressPath = (project, id) => path.join(project.progressDir, `${id}.jsonl`)
/**
 * The agent the hooks module started for comment `id`, the model it runs on and
 * the classifier's label, as JSON: its claim records them on the run.
 */
export const routePath = (project, id) =>
  path.join(project.progressDir, '..', 'routes', `${id}.json`)

/**
 * What routePath holds, or nothing when the hooks module wrote none.
 * @param {{ progressDir: string }} project
 * @param {string} id
 * @returns {Promise<{ agent?: string, model?: string, complexity?: string }>}
 */
export async function readRoute(project, id) {
  try {
    const route = JSON.parse(await readFile(routePath(project, id), 'utf8'))
    return typeof route === 'object' && route !== null ? route : {}
  } catch {
    return {}
  }
}
// Every step of the runs that ended, for the widget's debug panel; kept with a
// dev build of the widget only (createStore's `history`).
const historyPath = (project, id) => path.join(project.progressDir, `${id}.history.jsonl`)

/**
 * The reader's answer to Claude's question: the options they chose, from the
 * ones it offered, then their own words. Undefined when it holds neither,
 * unless images go with it (`imaged`): an image alone is a reply.
 * @param {any} comment
 * @param {string | undefined} text
 * @param {string[] | undefined} choices
 * @param {boolean} imaged
 * @returns {{ body: string, choices?: string[] } | undefined}
 */
function readerReply(comment, text, choices, imaged) {
  const asked = isAsking(comment) ? comment.messages?.at(-1) : undefined
  /** @type {string[]} */
  const offered = asked?.options?.map((option) => option.label) ?? []
  const valid = offered.filter((label) => choices?.includes(label))
  const chosen = asked?.multiple ? valid : valid.slice(0, 1)
  const body = [chosen.join(', '), text ?? ''].filter(Boolean).join('\n\n')
  if (!body && !imaged) return undefined
  return chosen.length ? { body, choices: chosen } : { body }
}

export const normaliseQuote = (text) => text.replace(/\s+/g, ' ').trim()

/**
 * @param {{ commentsFile: string, progressDir: string }} project
 * @param {{ history?: boolean }} [options] `history`: keep each run's steps
 *   for the debug panel when the run ends, instead of dropping them; on with a
 *   dev build of the widget only.
 */
export function createStore(project, { history: keepHistory = isDevWidget() } = {}) {
  const file = project.commentsFile
  const progressFile = (id) => progressPath(project, id)

  /**
   * Drops the run's steps, kept first in the comment's history when asked,
   * each tagged with `run` when the hooks did not tag it.
   * @param {string} id
   * @param {string} [run]
   */
  async function endRun(id, run) {
    if (keepHistory) {
      const lines = (await readFile(progressFile(id), 'utf8').catch(() => ''))
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const step = JSON.parse(line)
            return [`${JSON.stringify(run && !step.run ? { ...step, run } : step)}\n`]
          } catch {
            return []
          }
        })
      if (lines.length) await appendFile(historyPath(project, id), lines.join(''))
    }
    await rm(progressFile(id), { force: true })
  }
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve()

  /**
   * Runs `task` after the previous one, so reads and writes never interleave.
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  const serialise = (task) => {
    const next = queue.then(task, task)
    queue = next.catch(() => undefined)
    return next
  }

  /**
   * A read-modify-write: in order within this process, and under the file lock
   * against the others.
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  const exclusive = (task) => serialise(() => withFileLock(file, task))

  /**
   * The comments; a file in another format is refused, and left untouched.
   * @returns {Promise<CommentV2[]>}
   */
  async function readAll() {
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return []
      throw error
    }
    try {
      return parseFile(text, file).comments
    } catch (error) {
      if (error instanceof FormatError) throw new StoreRefusal(error.message)
      throw error
    }
  }

  // Written to a temp file first: the watcher and the agents' scripts read it concurrently.
  /** @param {CommentV2[]} comments */
  async function writeAll(comments) {
    await mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    const content = { version: FORMAT_VERSION, comments }
    await writeFile(temp, `${JSON.stringify(content, null, 2)}\n`)
    await rename(temp, file)
  }

  /**
   * Runs `work`, which files images of comment `id`: failing, it removes
   * those `filed()` names by then, or all of the comment's when it returns
   * undefined, and throws the work's error.
   * @param {string} id
   * @param {() => string[] | undefined} filed
   * @param {() => Promise<void>} work
   */
  async function filing(id, filed, work) {
    try {
      await work()
    } catch (error) {
      await removeImages(project, id, filed())
      throw error
    }
  }

  /**
   * Runs `change` on the comment `id`, under the lock, and writes the result.
   * Throwing a StoreRefusal from it writes nothing.
   * @template T
   * @param {string} id
   * @param {(comment: CommentV2) => Promise<T> | T} change
   * @returns {Promise<T>}
   */
  const changeOne = (id, change) =>
    exclusive(async () => {
      const comments = await readAll()
      const comment = comments.find((entry) => entry.id === id)
      if (!comment) throw new StoreRefusal(`no comment with id ${id}`)
      const result = await change(comment)
      await writeAll(comments)
      return result
    })

  /**
   * @param {string} id
   * @param {string} at When the reader stopped it: the `stopped` event's time.
   * @param {string} [run]
   * @returns {Promise<import('./format.mjs').Cancellation>}
   */
  async function cancellationOf(id, at, run) {
    const steps = await readProgress(project, id)
    await endRun(id, run)
    return {
      at,
      changed: [
        ...new Set(
          steps
            // A failed write changed nothing; one cut short by the stop may have.
            .filter((s) => WRITE_KINDS.has(s.kind) && s.state !== 'failed')
            .map((s) => s.label),
        ),
      ],
      steps: steps.filter((s) => !NARRATION_KINDS.has(s.kind)).length,
      ...(run ? { run } : {}),
    }
  }

  return {
    readAll,

    /**
     * An agent starts working on the comment: a new run, which records the
     * agent's id, the model it runs on and the classifier's label when the
     * hooks gave them. Claimed again while working, it stays in the run it is
     * in.
     * @param {string} id
     * @param {{ agent?: string, model?: string, complexity?: string }} [options]
     * @returns {Promise<{ comment: CommentV2, run: string }>}
     */
    claim(id, { agent, model, complexity } = {}) {
      return changeOne(id, (comment) => {
        const working = currentRun(comment)
        if (working) return { comment, run: working }
        if (comment.state !== 'open') {
          throw new StoreRefusal(`comment ${id} is ${stateOf(comment)}`)
        }
        const run = nextRunId(comment)
        move(comment, 'working', {
          by: 'agent',
          run,
          agent,
          model: model?.slice(0, MAX_MODEL),
          complexity: COMPLEXITIES.find((known) => known === complexity),
        })
        return { comment, run }
      })
    },

    /**
     * Files Claude's answer under the comment, with the run that wrote it.
     * The first answer resolves it; once it was resolved, a later one leaves
     * it `answered`, and only the reader resolves it again. A
     * question leaves the comment waiting on the reader: asked only in the
     * manager's chat, it used to leave a thread open with no answer and no
     * agent, showing "Waiting for Claude" to a reader who was the one being
     * waited on. The run's steps are dropped: the comments file holds the
     * discussion, not the agent's log.
     * A question may offer `options`, the reader picking one, or several when
     * `multiple`; they can always answer in their own words instead.
     * @param {string} id
     * @param {string} body
     * @param {{ question?: boolean, options?: { label: string, description?: string }[], multiple?: boolean }} [options]
     */
    answer(id, body, { question = false, options, multiple = false } = {}) {
      return changeOne(id, async (comment) => {
        // An agent answers only a comment it may work on: the graph also lets
        // the reader resolve one that waits on them.
        if (!isActive(comment)) {
          throw new StoreRefusal(`comment ${id} is ${stateOf(comment)}`)
        }
        // Answered without a claim: the run starts here.
        if (comment.state === 'open') {
          move(comment, 'working', { by: 'agent', run: nextRunId(comment) })
        }
        const run = currentRun(comment)
        move(
          comment,
          question ? 'asking' : wasResolved(comment) ? 'answered' : 'resolved',
          {
            by: 'agent',
            run,
            message: {
              ...(run ? { run } : {}),
              author: 'claude',
              body,
              ...(question ? { question: true } : {}),
              ...(question && options?.length ? { options } : {}),
              ...(question && options?.length && multiple ? { multiple: true } : {}),
            },
          },
        )
        await endRun(id, run)
        return comment
      })
    },

    /**
     * @param {string} [route]
     * @param {{ history?: boolean }} [options] `history`: every step of every
     *   run, for the widget's debug panel.
     */
    list(route, { history = false } = {}) {
      return serialise(async () => {
        const comments = (await readAll()).filter(
          (c) => route === undefined || c.route === route || c.route === APP_ROUTE,
        )
        return Promise.all(
          comments.map(async (c) => {
            /** @type {CommentV2 & { progress?: unknown[], history?: unknown[] }} */
            const listed = { ...c }
            // Only a run in progress has steps to show.
            if (c.state === 'working') {
              const progress = await readProgress(project, c.id, PROGRESS_SHOWN)
              if (progress.length) listed.progress = progress
            }
            if (history) {
              // The runs that ended, then the one in progress.
              const steps = [
                ...(await readProgress(project, c.id, undefined, { history })),
                ...(await readProgress(project, c.id)),
              ]
              if (steps.length) listed.history = steps
            }
            return listed
          }),
        )
      })
    },

    /**
     * The reader's new comment: their words, and the images they attached,
     * open the thread.
     * @param {{ route: string, url?: string, anchor: import('./format.mjs').Anchor, body: string, images?: Image[] }} input
     * @returns {Promise<CommentV2>}
     */
    create({ route, url, anchor, body, images = [] }) {
      return exclusive(async () => {
        const comments = await readAll()
        const at = new Date().toISOString()
        const id = randomUUID()
        /** @type {CommentV2} */
        const comment = {
          id,
          route,
          ...(url ? { url } : {}),
          anchor,
          state: 'open',
          createdAt: at,
          messages: [
            {
              id: 'm1',
              author: 'reader',
              body,
              at,
              sentAt: at,
            },
          ],
          events: [{ at, state: 'open', by: 'reader' }],
        }
        // Unsaved, the comment leaves no image behind.
        await filing(
          id,
          () => undefined,
          async () => {
            const names = await saveImages(project, id, 'm1', images)
            if (names.length && comment.messages[0]) comment.messages[0].images = names
            await writeAll([...comments, comment])
          },
        )
        return comment
      })
    },

    /**
     * The reader's move, as the widget sends it: stop the run (`cancelled:
     * true`), send it again (`cancelled: false`, with new words in `text`),
     * answer or follow up (`followUp`, `choices`, with the `images` the
     * reader attached), or resolve it (`status`).
     * A stop or a re-send the comment is past changes nothing: a double
     * click, or a click on a button a poll late, is not an error. Undefined
     * when there is no such comment.
     * @param {string} id
     * @param {{ cancelled?: boolean, followUp?: string, choices?: string[], images?: Image[], text?: string, status?: 'resolved' }} patch
     * @returns {Promise<CommentV2 | undefined>}
     */
    update(id, { cancelled, followUp, choices, images = [], text, status }) {
      return exclusive(async () => {
        const comments = await readAll()
        const comment = comments.find((entry) => entry.id === id)
        if (!comment) return undefined
        const run = currentRun(comment)
        // Too late once Claude asked or answered: the stop does nothing, as
        // the Cancel button the reader clicked was there a poll ago.
        if (cancelled === true && isActive(comment)) {
          const at = move(comment, 'stopped', { by: 'reader', run })
          comment.cancellation = await cancellationOf(id, at, run)
        }
        if (cancelled === false && comment.state === 'stopped') {
          const sentAt = move(comment, 'open', { by: 'reader' })
          const last = openingOf(comment)
          if (last) {
            // Sent anew: a hand-over of its own, which the server notifies again.
            const { notifiedAt: _, ...unsent } = last
            /** @type {MessageV2} */
            let resent = { ...unsent, sentAt }
            if (text !== undefined && (text || last.images?.length)) {
              // New words, or none on a message with images, which go alone; the
              // options the reader had chosen go either way.
              const { choices: __, ...kept } = resent
              resent = { ...kept, body: text }
            }
            comment.messages[comment.messages.indexOf(last)] = resent
          }
        }
        const reply = readerReply(comment, followUp, choices, images.length > 0)
        /** @type {string[]} */
        let names = []
        // Unsaved, the reply leaves no image behind.
        await filing(
          id,
          () => names,
          async () => {
            if (reply) {
              const sentAt = move(comment, 'open', {
                by: 'reader',
                message: { author: 'reader', ...reply },
              })
              // Written once the move is taken: a refused one leaves no file behind.
              const message = comment.messages.at(-1)
              if (message) message.sentAt = sentAt
              if (message) names = await saveImages(project, id, message.id, images)
              if (message && names.length) message.images = names
            }
            if (status === 'resolved' && comment.state !== 'resolved') {
              move(comment, 'resolved', { by: 'reader', run })
              // Resolved by the reader: no answer to file the steps under.
              await endRun(id, run)
            }
            await writeAll(comments)
          },
        )
        return comment
      })
    },

    /**
     * The server printed the hooks' line for the message `key` (format.mjs's
     * sentKey) opens: dates its hand-over, once. Nothing when the comment no
     * longer waits for that message (sent again, deleted) or it was dated
     * already, as a restart prints the line again.
     * @param {string} id
     * @param {string} key
     * @returns {Promise<boolean>} Whether it dated it.
     */
    notify(id, key) {
      return exclusive(async () => {
        const comments = await readAll()
        const comment = comments.find((entry) => entry.id === id)
        const message = comment && isActive(comment) ? openingOf(comment) : undefined
        if (!message || message.notifiedAt || sentKey(message) !== key) return false
        message.notifiedAt = new Date().toISOString()
        await writeAll(comments)
        return true
      })
    },

    remove(id) {
      return exclusive(async () => {
        const comments = await readAll()
        const remaining = comments.filter((c) => c.id !== id)
        if (remaining.length === comments.length) return false
        await writeAll(remaining)
        await rm(progressFile(id), { force: true })
        await rm(historyPath(project, id), { force: true })
        await removeImages(project, id)
        return true
      })
    },
  }
}
