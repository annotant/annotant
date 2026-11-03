#!/usr/bin/env node
// hook.mjs <pre|post|stop|note|ended> --comment <id> --project <dir> [--lock-root <dir>] [--agent <id>]
// The hooks of one comment's agent: Claude Code runs them around each of its
// tools with the event as JSON on stdin. Claude Code runs no plugin mod hook
// for an agent a plugin starts, so the plugin's hooks module registers each
// comment's agent with these, the comment and the project written in.
//
// pre: refuses AskUserQuestion, Bash commands that write files, and an Edit,
//      Write, MultiEdit or NotebookEdit outside the project's `editable`
//      paths (when it lists them); locks the file an edit writes
//      (another comment's agent may hold it), keeps it as it is before the
//      run's first write of it (lib/diffs.mjs), as it keeps a file rm, git rm
//      or unlink names, and records the step for the widget.
// post: records the step done or failed; keeps a file the run wrote or
//      deleted as it is now; gives the agent the reader's
//      messages sent since its claim, once each, as additional context; after a file of the repository
//      written by Edit, Write, MultiEdit or NotebookEdit, or deleted (rm, git
//      rm, unlink),
//      where the project is in git, on the comment (the run's first write,
//      and a move); after resolve.mjs or ask.mjs, ends the run: the agent's
//      locks are released.
// stop: the agent stopped; it holds nothing.
// note: the hooks module's steps (what the agent thinks and says), as JSON
//      lines on stdin.
// ended: the hooks module, once the agent's turn ended: a comment it left
//      working, neither answered nor asked about, stops, so the reader can
//      send it again. Prints `STOPPED` when it did.
//
// `--lock-root`: the git repository the project is in, which the hooks module
// found; agents may edit outside the project (`editable` such as `../api`).
// A hook never fails the agent: on any error, it lets the tool run, except a
// write it cannot tell is under `editable`, which it refuses.
import { createHash } from 'node:crypto'
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { RUN_ID, diffsDir, keepAfter, keepBefore } from './lib/diffs.mjs'
import { errorCode } from './lib/errors.mjs'
import { withFileLock } from './lib/filelock.mjs'
import { fence } from './lib/fence.mjs'
import { currentRun, parseFile, unreadDuring } from './lib/format.mjs'
import { gitPlace, wroteAt } from './lib/git.mjs'
import { imagesDir } from './lib/images.mjs'
import { CONFIG_FILE, STATE_ROOT, project as projectAt } from './lib/project.mjs'
import { createStore, isActive, progressPath, readProgress } from './lib/store.mjs'

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
 * @property {string} [cwd] the agent's folder
 */

// A hook's time is bounded: past this, the edit is refused and retried.
const LOCK_WAIT_MS = Number(process.env.ANNOTANT_LOCK_WAIT_MS) || 6_000
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
// Dangling links followed by hand to resolve one path (realpath follows the
// others), past which it is taken as a loop.
const MAX_LINKS = 40
// realpath's failures that leave a name to walk by hand (missing, a dangling
// link or a loop of links), and readlink's on a name that is no link.
/** @type {Set<unknown>} */
const RESOLVABLE = new Set(['ENOENT', 'ENOTDIR', 'ELOOP'])
/** @type {Set<unknown>} */
const NOT_A_LINK = new Set(['ENOENT', 'EINVAL', 'ENOTDIR'])
const SCRIPTS = path.dirname(new URL(import.meta.url).pathname)
// A command's words: quoted, or up to a space.
const WORDS = /"([^"]*)"|'([^']*)'|(\S+)/g
// What the shell expands, unquoted or between double quotes: not a path as written.
const GLOB = /[*?[\]{}$`~]/
const EXPANDED = /[$`]/
// A redirection or `&`: the command's arguments end there.
const REDIRECT = /[<>&]/

/**
 * Whether `file` is there, a folder or not, without following a link; `unknown`
 * when it cannot be told (no access).
 * @param {string} file
 * @returns {Promise<'file' | 'folder' | 'missing' | 'unknown'>}
 */
async function presence(file) {
  try {
    return (await lstat(file)).isDirectory() ? 'folder' : 'file'
  } catch (error) {
    return errorCode(error) === 'ENOENT' ? 'missing' : 'unknown'
  }
}

/**
 * `file` as the system writes it, one name after the other as the system
 * walks it: each link followed where it stands (a `..` after a link leaves the
 * link's target, not the link's folder), a dangling one too, where a write
 * would create its target. From the first name that does not exist, the rest
 * is kept as written. Undefined when it cannot be told: more than MAX_LINKS
 * dangling links (a loop), or a folder it may not read.
 * @param {string} file absolute, as the tool received it
 * @param {number} [links] dangling links followed so far
 * @returns {Promise<string | undefined>}
 */
async function resolved(file, links = 0) {
  const names = file.split(path.sep).filter(Boolean)
  let at = path.parse(file).root
  for (const [index, name] of names.entries()) {
    if (name === '.') continue
    if (name === '..') {
      at = path.dirname(at)
      continue
    }
    const next = path.join(at, name)
    try {
      // The name as the folder holds it (its case on macOS), links followed.
      at = await realpath(next)
      continue
    } catch (error) {
      if (!RESOLVABLE.has(errorCode(error))) return undefined
    }
    const rest = names.slice(index + 1)
    /** @type {string | undefined} */
    let link
    try {
      link = await readlink(next)
    } catch (error) {
      if (!NOT_A_LINK.has(errorCode(error))) return undefined
    }
    if (link !== undefined) {
      if (links >= MAX_LINKS) return undefined
      const target = path.isAbsolute(link) ? link : `${at}${path.sep}${link}`
      return resolved([target, ...rest].join(path.sep), links + 1)
    }
    // Missing: what follows does not exist either, a `..` in it only goes back.
    return rest.includes('..')
      ? resolved(path.join(next, ...rest), links)
      : path.join(next, ...rest)
  }
  return at
}

/**
 * `file` from `base` as the tool would take it: never normalized before its
 * links are followed.
 * @param {string} file
 * @param {string} base
 */
const from = (file, base) => (path.isAbsolute(file) ? file : `${base}${path.sep}${file}`)

/**
 * The deny message for a file a comment's agent writes, `target`: one of
 * Annotant's own files (`.annotant.json`, the comments file, the runs'
 * diffs), or one outside
 * the project's `editable` paths (a folder above it such as `../api` included);
 * undefined under one of them, or when the project declares no `editable`
 * (the worker's instructions alone keep the agent there). An empty list
 * refuses every write. Fails closed: a `.annotant.json` that cannot be read, an
 * `editable` that is not a list of paths, or a path that cannot be resolved,
 * refuse the write.
 * @param {{ root: string, cwd?: string, target: string, comment: string, scripts: string }} options
 *   `cwd`: the agent's folder, where a relative `target` starts
 * @returns {Promise<{ deny: string, why: string } | undefined>}
 */
async function outsideEditable({ root, cwd = root, target, comment, scripts }) {
  const ask =
    "If it needs another, do not change it: ask the reader in the comment's thread " +
    `with node ${JSON.stringify(path.join(scripts, 'ask.mjs'))} ${comment} ` +
    `--project ${JSON.stringify(root)} "<question>", then reply "QUESTION: <your question>".`
  /** @type {{ editable?: unknown, commentsFile?: unknown }} */
  let config
  try {
    config = JSON.parse(await readFile(path.join(root, CONFIG_FILE), 'utf8'))
  } catch (error) {
    return {
      deny: `Annotant could not read ${CONFIG_FILE}, which says where agents may edit: retry this step.`,
      why: `cannot read ${CONFIG_FILE}: ${String(error)}`,
    }
  }
  const { editable } = config
  // A relative path starts from the agent's folder.
  const file = await resolved(from(target, cwd))
  // Annotant's own files, whatever `editable` covers: changing the config
  // would lift this check, and the comments file holds every other thread.
  const own = [
    CONFIG_FILE,
    typeof config.commentsFile === 'string'
      ? config.commentsFile
      : '.annotant/comments.json',
  ]
  // The run's diffs, beside the comments file: what the reader sees it did.
  const diffs = await resolved(
    diffsDir({ commentsFile: path.resolve(root, own[1] ?? '') }, '.'),
  )
  if (file && diffs && within(diffs, file) !== undefined) {
    return {
      deny: `${target} is Annotant's own file: agents never change it. ${ask}`,
      why: `Annotant's own file (${file})`,
    }
  }
  for (const name of own) {
    const protectedFile = await resolved(path.resolve(root, name))
    if (file && file === protectedFile) {
      return {
        deny: `${target} is Annotant's own file: agents never change it. ${ask}`,
        why: `Annotant's own file (${file})`,
      }
    }
  }
  if (editable === undefined) return undefined
  if (!Array.isArray(editable) || !editable.every((entry) => typeof entry === 'string')) {
    return {
      deny: `\`editable\` in ${CONFIG_FILE} is not a list of paths, so no write is allowed. ${ask}`,
      why: '`editable` is not a list of paths',
    }
  }
  if (!file) {
    return {
      deny: `Annotant could not tell where ${target} leads (a loop of links, or a folder it may not read), so it refuses the write. ${ask}`,
      why: 'cannot resolve the path',
    }
  }
  for (const entry of editable) {
    const allowed = await resolved(from(entry, root))
    if (allowed && within(allowed, file) !== undefined) return undefined
  }
  const listed = editable.length ? editable.join(', ') : 'none'
  return {
    deny:
      `${target} is outside the paths this project lets agents edit ` +
      `(\`editable\` in ${CONFIG_FILE}: ${listed}). Make the change under one of them. ${ask}`,
    why: `outside \`editable\` (${file})`,
  }
}

/**
 * The words of a shell command's segment, each with the quote it was in.
 * @param {string} segment
 */
function wordsOf(segment) {
  return [...segment.matchAll(WORDS)].map(([, double, single, bare]) =>
    double !== undefined
      ? { text: double, quote: '"' }
      : single !== undefined
        ? { text: single, quote: "'" }
        : { text: bare ?? '', quote: '' },
  )
}

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
  return relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
    ? undefined
    : relative
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
  const scripts = SCRIPTS
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

  /**
   * A file tool's step: the file as the reader sees it, from the project, else
   * its name, and outside the repository its absolute path (`external`) too.
   * @param {string} kind
   * @param {string} file
   */
  function fileStep(kind, file) {
    const full = path.resolve(root, file)
    return within(lockRoot, full) === undefined
      ? { kind, label: path.basename(file), external: full }
      : { kind, label: path.relative(root, full) }
  }

  /**
   * @param {string} tool
   * @param {Record<string, unknown>} input
   * @returns {{ kind: string, label: string, external?: string }}
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
        return fileStep(tool.toLowerCase(), text('file_path'))
      case 'NotebookEdit':
        return fileStep('edit', text('notebook_path'))
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

  /**
   * Keeps `files` of the repository (as the tool named them) for the run's
   * diff: as they are before its first write of them, or after this one.
   * Best effort: a diff missing never stops the agent.
   * @param {'before' | 'after'} side
   * @param {string[]} files
   */
  async function keep(side, files) {
    const found = await readComment()
    const run = found ? currentRun(found) : undefined
    if (!run || !RUN_ID.test(run)) return
    for (const file of files) {
      const full = path.resolve(root, file)
      const { label, external } = fileStep('edit', file)
      // Outside the repository (a dotfile in the home folder…): its content
      // may be anything, never copied into the project.
      if (external) continue
      const named = label
      try {
        if (side === 'before') await keepBefore(project, comment, run, named, full)
        else if (!(await keepAfter(project, comment, run, named, full)))
          await log(`no diff of ${named}: nothing kept before its write`)
      } catch (why) {
        await log(`could not keep ${named} ${side} the write: ${String(why)}`)
      }
    }
  }

  /**
   * The paths `command` names to delete with `rm`, `git rm` or `unlink`,
   * absolute: files or folders, from the folder an earlier `cd` of the command
   * went to. Best effort: options, what the shell expands (globs, variables)
   * and what follows a redirection are left out, and so is any path after a
   * `cd` the hook cannot follow; `mv` is not seen.
   * @param {string} command
   */
  function deletedBy(command) {
    /** @type {string | undefined} */
    let folder = root
    /** @type {string[]} */
    const paths = []
    for (const segment of command.split(/&&|\|\||[;|\n]/)) {
      const words = wordsOf(segment)
      if (words[0]?.text === 'sudo') words.shift()
      const [first, second] = words
      if (first?.text === 'cd') {
        const to = second && !second.quote && GLOB.test(second.text) ? undefined : second
        folder = to && folder !== undefined ? path.resolve(folder, to.text) : undefined
        continue
      }
      const named =
        first?.text === 'rm' || first?.text === 'unlink'
          ? words.slice(1)
          : first?.text === 'git' && second?.text === 'rm'
            ? words.slice(2)
            : undefined
      if (!named || folder === undefined) continue
      let options = true
      for (const { text, quote } of named) {
        if (!quote && REDIRECT.test(text)) break
        if (options && !quote && text === '--') {
          options = false
          continue
        }
        if (options && !quote && text.startsWith('-')) continue
        if (!text || (quote === '"' && EXPANDED.test(text))) continue
        if (!quote && GLOB.test(text)) continue
        paths.push(path.resolve(folder, text))
      }
    }
    return paths
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
          'This command writes files from Bash, where Annotant cannot lock them against ' +
          "the other comments' agents. Make the change with the Edit or Write tool instead."
        )
      }
      // The answer lists the files the run changed as the command starts: a
      // deletion in the same command would be missing from it.
      const resolving = RESOLVE.exec(command)
      if (resolving && deletedBy(command.slice(0, resolving.index)).length) {
        await log(`refused a deletion with the answer: ${short(command, 120)}`)
        await record([
          {
            ...step,
            state: 'failed',
            error: 'deletes files in the command that answers',
          },
        ])
        return (
          'Delete files in a command of their own, before the one that answers: ' +
          'the answer lists the files the run changed when it starts.'
        )
      }
      const target = writeTarget(tool, input)
      if (target) {
        const deny = await lockTarget(target, step)
        if (deny) return deny
        if (target !== '@build') await keep('before', [target])
      }
      // A file Write makes, not one it overwrites: the run added it.
      const written = tool === 'Write' ? textOf(input, 'file_path') : undefined
      if (written && (await presence(path.resolve(root, written))) === 'missing')
        step.created = true
      // What the command names to delete and is there: once gone, it was deleted.
      if (command && !resolving) {
        /** @type {{ path: string, folder?: true }[]} */
        const removing = []
        for (const file of deletedBy(command)) {
          const is = await presence(file)
          if (is === 'file') removing.push({ path: file })
          else if (is === 'folder') removing.push({ path: file, folder: true })
        }
        if (removing.length) step.removing = removing
        await keep(
          'before',
          // Not a link: its target, maybe anywhere, is not what the run deletes.
          (
            await Promise.all(
              removing.map(async (one) =>
                !one.folder &&
                (await lstat(one.path).then(
                  (found) => found.isFile(),
                  () => false,
                ))
                  ? [one.path]
                  : [],
              ),
            )
          ).flat(),
        )
      }
      await record([{ ...step, state: 'running' }])
      return undefined
    },

    /**
     * @param {HookInput} event
     * @returns {Promise<string | undefined>} what to tell the agent: the
     *   reader's messages sent while it works
     */
    async post({
      hook_event_name: name,
      tool_name: tool = '',
      tool_input: input = {},
      tool_use_id: id,
      error,
    }) {
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
      // Its run over: answered, asked, or open again for a message the
      // reader sent meanwhile.
      const ended = RESOLVE.exec(command)?.[1]
      if (ended && unquote(ended) === comment && found?.state !== 'working') {
        await endRun(step)
        return undefined
      }
      if (BUILD.test(command)) {
        await unlock('@build')
        await log('build ended: released the build lock')
      }
      // What was there as the command started and is gone, even when the
      // command failed past the deletion.
      const started = id
        ? (await readProgress(project, comment)).find((one) => one.id === id)
        : undefined
      /** @type {Step[]} */
      const deleted = []
      /** @type {string | undefined} The first file of the repository it deleted, for the git branch. */
      let removed
      for (const { path: file, folder } of started?.removing ?? []) {
        if ((await presence(file)) !== 'missing') continue
        if (within(lockRoot, path.resolve(root, file)) !== undefined) removed ??= file
        deleted.push({
          at: step.at,
          ...fileStep('delete', file),
          ...(folder && { folder }),
          state: 'done',
        })
      }
      await record([step, ...deleted])
      // After the step: a comments file it cannot lock never leaves it running.
      const target = writeTarget(tool, input)
      const changed = !failed && target && target !== '@build' ? target : removed
      const kept = deleted
        .filter((one) => !one.folder)
        .map((one) => one.external ?? path.join(root, one.label))
      await keep('after', [
        ...(!failed && target && target !== '@build' ? [target] : []),
        ...kept,
      ])
      if (found && changed) {
        await noteWrite(found, changed).catch((why) =>
          log(`could not record the git branch: ${String(why)}`),
        )
      }
      // Only a tool that ran: the context of a failure may not reach it.
      const run = found ? currentRun(found) : undefined
      if (!found || !run || name === 'PostToolUseFailure') return undefined
      if (!unreadDuring(found, run).length) return undefined
      const added = await createStore(project).deliver(comment, run, agent)
      if (!added.length) return undefined
      await log(`gave the agent ${added.map((message) => message.id).join(', ')}`)
      return addedContext(added)
    },

    /**
     * Records the step main() refused out of `editable`: best effort, the
     * refusal is printed already.
     * @param {HookInput} event
     * @param {string} why
     */
    async refused(
      { tool_name: tool = '', tool_input: input = {}, tool_use_id: id },
      why,
    ) {
      await log(`refused ${writeTarget(tool, input)}: ${why}`)
      await record([
        {
          at: Date.now(),
          ...(id && { id }),
          ...describe(tool, input),
          state: 'failed',
          error: 'outside `editable`',
        },
      ])
    },

    async stop() {
      const released = await releaseAll()
      await log(`agent stopped: released ${released.length} lock(s)`)
    },

    /** Whether the comment, left working by the agent, stopped. */
    async ended() {
      const stopped = await createStore(project).abandon(comment, agent)
      if (!stopped) return false
      const released = await releaseAll()
      await log(
        `turn ended with the comment working: stopped it, released ${released.length} lock(s)`,
      )
      return true
    },

    /** @param {Step[]} steps */
    note: record,
  }

  /**
   * The reader's messages sent during the run, for its agent: fenced as data,
   * their images as files it opens with Read.
   * @param {import('./lib/format.mjs').MessageV2[]} added
   */
  function addedContext(added) {
    const dir = imagesDir(project, comment)
    const messages = added.map(({ id: message, body, images, elements, area }) => ({
      id: message,
      body,
      ...(images && { images: images.map((image) => path.join(dir, image)) }),
      ...(elements && { elements }),
      ...(area && { area }),
    }))
    return [
      `The reader added to comment ${comment} while you work on it:`,
      fence(JSON.stringify(messages, null, 2)),
      'Take it into account in this run. If you do not, say why in your answer.',
    ].join('\n')
  }

  /**
   * A file written or deleted in the repository: where the project is in git, on the
   * comment, at the run's first write and when a later one finds it
   * elsewhere. A file outside it (a scratch file) is not the project's change.
   * @param {CommentV2} found
   * @param {string} target
   */
  async function noteWrite(found, target) {
    const run = currentRun(found)
    if (!run || within(lockRoot, path.resolve(root, target)) === undefined) return
    const place = await gitPlace(root, (why) => void log(why))
    if (!place) return
    const first = found.writes?.find((write) => write.run === run)
    if (first && wroteAt(first, place)) return
    if (await createStore(project).wrote(comment, run, place)) {
      await log(`wrote on ${place.branch ?? place.commit}${first ? ' (switched)' : ''}`)
    }
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

/**
 * What a PreToolUse hook prints to refuse the tool.
 * @param {string} reason
 */
const denial = (reason) =>
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  })

async function main() {
  const [mode] = process.argv.slice(2)
  const comment = flag('--comment')
  const root = flag('--project')
  if (!mode || !comment || !root) {
    console.error(
      'usage: hook.mjs <pre|post|stop|note|ended> --comment <id> --project <dir> [--lock-root <dir>] [--agent <id>]',
    )
    process.exit(2)
  }
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  /** @type {HookInput} */
  const event =
    mode === 'note' || mode === 'ended' || !text.trim() ? {} : JSON.parse(text)
  // Before anything that may fail and let the tool run: a write out of
  // `editable` is refused even when the rest of the hook cannot work.
  const target =
    mode === 'pre'
      ? writeTarget(event.tool_name ?? '', event.tool_input ?? {})
      : undefined
  const outside =
    target && target !== '@build'
      ? await outsideEditable({ root, cwd: event.cwd, target, comment, scripts: SCRIPTS })
      : undefined
  if (outside) {
    console.log(denial(outside.deny))
    await hooksFor({
      comment,
      root,
      lockRoot: flag('--lock-root') ?? root,
      agent: event.agent_id ?? flag('--agent') ?? '-',
    }).refused(event, outside.why)
    return
  }
  const hooks = hooksFor({
    comment,
    root,
    lockRoot: flag('--lock-root') ?? root,
    agent: event.agent_id ?? flag('--agent') ?? '-',
  })
  if (mode === 'pre') {
    const deny = await hooks.pre(event)
    if (deny) console.log(denial(deny))
  } else if (mode === 'post') {
    const context = await hooks.post(event)
    if (context)
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: context,
          },
        }),
      )
  } else if (mode === 'stop') await hooks.stop()
  else if (mode === 'ended') {
    // The hooks module logs why it could not stop the comment.
    const stopped = await hooks.ended().catch((error) => {
      console.error(String(error))
      return false
    })
    if (stopped) console.log('STOPPED')
  } else if (mode === 'note')
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
