#!/usr/bin/env node
// hook.mjs <pre|post|stop|note> --comment <id> --project <dir> [--lock-root <dir>]
// The hooks of one comment's agent: Claude Code runs them around each of its
// tools with the event as JSON on stdin. Claude Code runs no plugin mod hook
// for an agent a plugin starts, so the plugin's hooks module registers each
// comment's agent with these, the comment and the project written in.
//
// pre: refuses AskUserQuestion and Bash commands that write files, locks the
//      file an edit writes (another comment's agent may hold it), and records
//      the step for the widget.
// post: records the step done or failed; after resolve.mjs or ask.mjs, ends
//      the run: the agent's locks are released.
// stop: the agent stopped; it holds nothing.
// note: the hooks module's steps (what the agent thinks and says), as JSON
//      lines on stdin.
//
// `--lock-root`: the git repository the project is in, which the hooks module
// found; agents may edit outside the project (`editable` such as `../api`).
// A hook never fails the agent: on any error, it lets the tool run.
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { withFileLock } from './lib/filelock.mjs'
import { currentRun, parseFile } from './lib/format.mjs'
import { STATE_ROOT, project as projectAt } from './lib/project.mjs'
import { isActive, progressPath } from './lib/store.mjs'

/** @typedef {import('./lib/format.mjs').CommentV2} CommentV2 */
/** @typedef {import('./lib/format.mjs').Step} Step */
/**
 * `project`: the root of the owner's project. One table serves the whole
 * repository, which may hold several projects.
 * @typedef {{ owner: string, project?: string, at: number }} Lock
 */
/**
 * What Claude Code sends a PreToolUse, PostToolUse or PostToolUseFailure hook.
 * @typedef {object} HookInput
 * @property {string} [hook_event_name]
 * @property {string} [tool_name]
 * @property {Record<string, unknown>} [tool_input]
 * @property {string} [tool_use_id]
 * @property {string} [error]
 * @property {string} [agent_id]
 */

// A hook's time is bounded: past this, the edit is refused and retried.
const LOCK_WAIT_MS = Number(process.env.CODE_BUDDY_LOCK_WAIT_MS) || 6_000
const LOCK_POLL_MS = 200
const STALE_MS = 20 * 60 * 1000

const BUILD = /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?build\b|\b(?:next|vite)\s+build\b/
const WORD = String.raw`[^\s;&|()<>]+`
// The agent's scripts, called by any path.
const CLAIM = new RegExp(String.raw`\bclaim\.mjs\s+(${WORD})`)
const RESOLVE = new RegExp(String.raw`\b(?:resolve|ask)\.mjs\s+(${WORD})`)
// A Bash command that writes files takes no lock: refused, the agent must use
// Edit or Write. Best effort, on the usual forms. What an inline script writes
// cannot be told: always refused.
const SCRIPT_WRITES = [
  /\bopen\([^)]*,\s*['"][wax]b?\+?['"]/,
  /\.write_(?:text|bytes)\(/,
  /\b(?:writeFile|appendFile)(?:Sync)?\s*\(/,
]
// An in-place editor, cat or tee names its files: refused only when one may be
// in the repository (a relative path, after some `cd`, may be).
const IN_PLACE = /\b(?:sed|perl)\s+(?:-\S+\s+)*-[\w-]*i/
const CAT_INTO = /\bcat\s*>>?\s*(\S+)/
const TEE = /\btee\b((?:\s+[^\s|;&<>]+)*)/
const MAX_LABEL = 80

/** @param {string} name */
function flag(name) {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

const short = (text = '', max = MAX_LABEL) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text
const unquote = (/** @type {string} */ value) => value.replace(/^["']|["']$/g, '')
/** `file` under `root`, relative; undefined outside it. */
function within(root, file) {
  const relative = path.relative(root, file)
  return relative.startsWith('..') || path.isAbsolute(relative) ? undefined : relative
}

/**
 * A tool's string argument.
 * @param {Record<string, unknown>} input
 * @param {string} key
 */
function textOf(input, key) {
  const value = input[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * The file a tool writes, `@build` for a build, or undefined.
 * @param {string} tool
 * @param {Record<string, unknown>} input
 */
function writeTarget(tool, input) {
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit')
    return textOf(input, 'file_path')
  if (tool === 'NotebookEdit') return textOf(input, 'notebook_path')
  if (tool === 'Bash' && BUILD.test(textOf(input, 'command') ?? '')) return '@build'
  return undefined
}

/** The hook log the hooks module writes too: on while its marker exists. */
async function debug(agent, comment, message) {
  try {
    await readFile(path.join(STATE_ROOT, 'debug'))
  } catch {
    return
  }
  const line = `${new Date().toISOString()} ${agent} ${comment} ${message}\n`
  await appendFile(path.join(STATE_ROOT, 'hook.log'), line).catch(() => undefined)
}

/**
 * The hooks of one comment's agent.
 * @param {{ comment: string, root: string, lockRoot: string, agent: string }} options
 */
function hooksFor({ comment, root, lockRoot, agent }) {
  const project = projectAt(root)
  const log = (/** @type {string} */ message) => debug(agent, comment, message)
  const scripts = path.dirname(new URL(import.meta.url).pathname)
  const table = path.join(
    STATE_ROOT,
    'locks',
    `${createHash('sha1').update(lockRoot).digest('hex').slice(0, 12)}.json`,
  )

  /**
   * @param {{ commentsFile: string }} [where] another project of the repository
   * @returns {Promise<CommentV2[] | undefined>}
   */
  async function comments(where = project) {
    try {
      return parseFile(await readFile(where.commentsFile, 'utf8')).comments
    } catch {
      return undefined
    }
  }
  /** The comment, null when deleted, undefined when the file cannot be read. */
  async function readComment() {
    const all = await comments()
    return all && (all.find((one) => one.id === comment) ?? null)
  }
  /** The ids of the comments an agent may work on; undefined when unknown. */
  async function activeIds() {
    const all = await comments()
    return all && new Set(all.filter(isActive).map((one) => one.id))
  }

  /**
   * Whether comment `owner` of the project at `where` may still be at work:
   * when its comments cannot be read, it may.
   * @param {string} owner
   * @param {string} [where]
   */
  async function mayWork(owner, where = root) {
    let all
    try {
      all = await comments(where === root ? project : projectAt(where))
    } catch {}
    return all === undefined || all.some((one) => one.id === owner && isActive(one))
  }

  /**
   * Changes the lock table, one process at a time.
   * @template T
   * @param {(locks: Record<string, Lock>) => T | Promise<T>} change
   */
  async function withLocks(change) {
    await mkdir(path.dirname(table), { recursive: true })
    return withFileLock(table, async () => {
      /** @type {Record<string, Lock>} */
      let locks = {}
      try {
        locks = JSON.parse(await readFile(table, 'utf8'))
      } catch {}
      const before = JSON.stringify(locks)
      const result = await change(locks)
      if (JSON.stringify(locks) !== before) await writeFile(table, JSON.stringify(locks))
      return result
    })
  }

  /** The comment holding `target`, or undefined once this one holds it. */
  async function tryLock(target) {
    return withLocks(async (locks) => {
      const held = locks[target]
      if (held && held.owner !== comment) {
        const stale =
          Date.now() - held.at > STALE_MS || !(await mayWork(held.owner, held.project))
        if (!stale) return held.owner
      }
      locks[target] = { owner: comment, project: root, at: Date.now() }
      return undefined
    })
  }

  async function releaseAll() {
    return withLocks((locks) => {
      const released = Object.keys(locks).filter((key) => locks[key]?.owner === comment)
      for (const key of released) delete locks[key]
      return released
    })
  }

  /** @param {string} target */
  function unlock(target) {
    return withLocks((locks) => {
      if (locks[target]?.owner === comment) delete locks[target]
    })
  }

  /**
   * Into the run in progress only: before the claim, and once the reader
   * stopped the comment, there is none.
   * @param {Step[]} steps
   */
  async function record(steps) {
    const found = await readComment()
    const run = found ? currentRun(found) : undefined
    if (!run || !steps.length) return
    await mkdir(project.progressDir, { recursive: true })
    await appendFile(
      progressPath(project, comment),
      steps.map((step) => `${JSON.stringify({ ...step, run, agent })}\n`).join(''),
    )
    for (const step of steps) {
      const state = step.state ? ` ${step.state}` : ''
      await log(`recorded ${step.kind}${state} "${step.label}"`)
    }
  }

  /** A path as the reader sees it: from the project, else its name. */
  function shown(file = '') {
    const full = path.resolve(root, file)
    return within(lockRoot, full) === undefined
      ? path.basename(file)
      : path.relative(root, full)
  }

  /**
   * @param {string} tool
   * @param {Record<string, unknown>} input
   * @returns {{ kind: string, label: string }}
   */
  function describe(tool, input) {
    const text = (/** @type {string} */ key) => textOf(input, key) ?? ''
    if (tool.startsWith('mcp__')) {
      const [, server, name] = tool.split('__')
      return { kind: 'mcp', label: `${server} · ${name}` }
    }
    switch (tool) {
      case 'Read':
      case 'Edit':
      case 'Write':
      case 'MultiEdit':
        return { kind: tool.toLowerCase(), label: shown(text('file_path')) }
      case 'NotebookEdit':
        return { kind: 'edit', label: shown(text('notebook_path')) }
      case 'Bash':
        return CLAIM.test(text('command'))
          ? { kind: 'start', label: 'Started' }
          : { kind: 'bash', label: short(text('description') || text('command')) }
      case 'Grep':
      case 'Glob':
        return { kind: 'search', label: short(text('pattern')) }
      case 'WebFetch':
        return {
          kind: 'web',
          label: URL.canParse(text('url')) ? new URL(text('url')).host : 'web',
        }
      case 'WebSearch':
        return { kind: 'web', label: short(text('query')) }
      case 'Skill':
        return { kind: 'skill', label: text('skill') }
      default:
        return { kind: 'tool', label: tool }
    }
  }

  /** The agent's own scripts pass: an answer may quote anything. */
  function writesFromBash(command) {
    if (CLAIM.test(command) || RESOLVE.test(command)) return false
    if (SCRIPT_WRITES.some((pattern) => pattern.test(command))) return true
    const targets = []
    for (const segment of command.split(/&&|\|\||[;|\n]/)) {
      const words = segment.trim().split(/\s+/)
      if (IN_PLACE.test(segment)) targets.push(words.at(-1) ?? '')
      const into = CAT_INTO.exec(segment)?.[1]
      if (into) targets.push(into)
      const teed = TEE.exec(segment)?.[1]
      if (teed)
        targets.push(
          ...teed
            .trim()
            .split(/\s+/)
            .filter((word) => !word.startsWith('-')),
        )
    }
    return targets.some((target) => {
      const file = unquote(target)
      return (
        !path.isAbsolute(file) || within(lockRoot, path.normalize(file)) !== undefined
      )
    })
  }

  /** The deny message, or undefined once the agent holds the lock. */
  async function lockTarget(target, step) {
    const active = await activeIds()
    if (active && !active.has(comment)) {
      await log(`refused ${target}: the reader stopped or resolved the comment`)
      return `Comment ${comment} was cancelled, resolved or deleted by the reader. Stop now: make no further changes and reply "CANCELLED".`
    }
    const key =
      target === '@build' ? target : within(lockRoot, path.resolve(root, target))
    if (key === undefined) {
      await log(`no lock for ${target}: outside ${lockRoot}`)
      return undefined
    }
    const deadline = Date.now() + LOCK_WAIT_MS
    let waited = false
    for (;;) {
      const holder = await tryLock(key)
      if (holder === undefined) {
        await log(`locked ${key}`)
        return undefined
      }
      if (!waited) await log(`waiting for ${key}, held by comment ${holder}`)
      waited = true
      if (Date.now() >= deadline) {
        const released = await releaseAll()
        await log(
          `refused ${key}: still held by comment ${holder}; released ${released.length} lock(s)`,
        )
        await record([
          {
            ...step,
            state: 'failed',
            error: `${key} is being changed by another comment's agent`,
          },
        ])
        return (
          `${key} is being changed by the agent of comment ${holder}. ` +
          `Your ${released.length} lock(s) were released to avoid a deadlock: ` +
          're-read the files you are changing, then retry this step.'
        )
      }
      await new Promise((done) => setTimeout(done, LOCK_POLL_MS))
    }
  }

  /**
   * AskUserQuestion would reach the session's terminal, never the reader, who
   * is on the page: the agent asks in the comment's thread instead.
   */
  const askInThread = () =>
    'The reader answers in the browser, where AskUserQuestion never shows. Ask in ' +
    `the comment's thread instead: node ${JSON.stringify(path.join(scripts, 'ask.mjs'))} ` +
    `${comment} --project ${JSON.stringify(root)} ` +
    '"<question>" --option "<label>: <description>" --option "…" (2 to 6 options; ' +
    'add --multiple to let the reader pick several), then reply "QUESTION: <your question>".'

  return {
    /**
     * @param {HookInput} event
     * @returns {Promise<string | undefined>} why the tool is refused
     */
    async pre({ tool_name: tool = '', tool_input: input = {}, tool_use_id: id }) {
      if (tool === 'AskUserQuestion') {
        await log('refused AskUserQuestion: ask in the thread')
        return askInThread()
      }
      /** @type {Step} */
      const step = { at: Date.now(), ...(id && { id }), ...describe(tool, input) }
      const command = (tool === 'Bash' && textOf(input, 'command')) || ''
      if (command && writesFromBash(command)) {
        await log(`refused a Bash write: ${short(command, 120)}`)
        await record([
          {
            ...step,
            state: 'failed',
            error: 'writes files from Bash; use Edit or Write',
          },
        ])
        return (
          'This command writes files from Bash, where Code Buddy cannot lock them against ' +
          "the other comments' agents. Make the change with the Edit or Write tool instead."
        )
      }
      const target = writeTarget(tool, input)
      if (target) {
        const deny = await lockTarget(target, step)
        if (deny) return deny
      }
      await record([{ ...step, state: 'running' }])
      return undefined
    },

    /** @param {HookInput} event */
    async post({ tool_name: tool = '', tool_input: input = {}, tool_use_id: id, error }) {
      const failed = error !== undefined
      const command = (tool === 'Bash' && textOf(input, 'command')) || ''
      /** @type {Step} */
      const step = {
        at: Date.now(),
        ...(id && { id }),
        ...describe(tool, input),
        state: failed ? 'failed' : 'done',
        ...(failed && { error: short(error.trim().split('\n')[0] ?? '', 160) }),
      }
      const found = await readComment()
      if (CLAIM.test(command) && found) {
        // The Started step says which model the agent runs on: claim.mjs
        // recorded it on the run.
        const started = found.events.at(-1)
        if (started?.state === 'working') {
          if (started.model) step.model = started.model
          if (started.complexity) step.complexity = started.complexity
        }
      }
      const ended = RESOLVE.exec(command)?.[1]
      if (ended && unquote(ended) === comment && !(found && isActive(found))) {
        await endRun(step)
        return
      }
      if (BUILD.test(command)) {
        await unlock('@build')
        await log('build ended: released the build lock')
      }
      await record([step])
    },

    async stop() {
      const released = await releaseAll()
      await log(`agent stopped: released ${released.length} lock(s)`)
    },

    /** @param {Step[]} steps */
    note: record,
  }

  /**
   * The script that ended the run, done: the store archived the run's steps
   * while it still ran. Only into a history the store keeps (dev widget).
   * @param {Step} last
   */
  async function endRun(last) {
    const history = path.join(project.progressDir, `${comment}.history.jsonl`)
    const kept = (await readFile(history, 'utf8').catch(() => undefined)) !== undefined
    if (kept) await appendFile(history, `${JSON.stringify({ ...last, agent })}\n`)
    const released = await releaseAll()
    await rm(progressPath(project, comment), { force: true })
    await log(`run ended (answered or asked): released ${released.length} lock(s)`)
  }
}

async function main() {
  const [mode] = process.argv.slice(2)
  const comment = flag('--comment')
  const root = flag('--project')
  if (!mode || !comment || !root) {
    console.error(
      'usage: hook.mjs <pre|post|stop|note> --comment <id> --project <dir> [--lock-root <dir>]',
    )
    process.exit(2)
  }
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  /** @type {HookInput} */
  const event = mode === 'note' || !text.trim() ? {} : JSON.parse(text)
  const hooks = hooksFor({
    comment,
    root,
    lockRoot: flag('--lock-root') ?? root,
    agent: event.agent_id ?? flag('--agent') ?? '-',
  })
  if (mode === 'pre') {
    const deny = await hooks.pre(event)
    if (deny)
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: deny,
          },
        }),
      )
  } else if (mode === 'post') await hooks.post(event)
  else if (mode === 'stop') await hooks.stop()
  else if (mode === 'note')
    await hooks.note(
      text
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line)),
    )
}

try {
  await main()
} catch (error) {
  // Never in the agent's way: its tool runs, unlocked and unrecorded.
  await debug('-', flag('--comment') ?? '-', `hook.mjs failed: ${String(error)}`)
}
