// Code Buddy's hooks, as a Claude Code mod (2.1.287 or later). They run in
// every session and every subagent, and act only for an agent that claimed a
// comment with claim.mjs: they lock the files it writes, so agents working on
// other comments never edit the same file at once, and record its steps for
// the widget in the progress file the server reads.
//
// Before a comment's agent starts, they pick its model: a classifier sorts the
// comment (trivial, standard, hard) and `.code-buddy.json`'s `models` maps the
// label to a model, which claim.mjs records on the run for the widget.
//
// `/code-buddy` (or the skill, through mcp__code-buddy__watch) starts the
// project's server and reads its lines: each comment starts its agent at once,
// in the background, with no model turn, so the session stays free for any
// other work. Follow-ups and edits go to that agent; a stop ends it.
//
// Loaded once per session, they start no process per tool call. The bindings
// (agent to comment), the locks, the routes, the workers and the projects
// watched live in $.state, so they survive a reload of the module and vanish
// with the session, like the agents themselves.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Binding, CommentsFile, Complexity, Lock, Route, Worker } from '../types'

type $ = EngineInterface
/**
 * `lockRoot`: the git repository the project is in, else the project. Agents
 * may edit outside the project (`editable` folders such as `../api`), and
 * those files need locks too.
 */
type Project = {
  root: string
  lockRoot: string
  commentsFile: string
  progressDir: string
  /** A model (`haiku`, an id, or `inherit`) per label. */
  models: Partial<Record<Complexity, string>>
}
type Step = Record<string, unknown>

const noBindings: Record<string, Binding> = {}
const noLocks: Record<string, Lock> = {}
const noRoutes: Record<string, Route> = {}
const bindings = atom({ plugin: 'code-buddy', key: 'bindings' } as const, noBindings)
const locks = atom({ plugin: 'code-buddy', key: 'locks' } as const, noLocks)
const routes = atom({ plugin: 'code-buddy', key: 'routes' } as const, noRoutes)
const noWorkers: Record<string, Worker> = {}
const noWatching: Record<string, true> = {}
const workers = atom({ plugin: 'code-buddy', key: 'workers' } as const, noWorkers)
const watching = atom({ plugin: 'code-buddy', key: 'watching' } as const, noWatching)

const WORKER = 'code-buddy:worker'
const COMPLEXITIES: readonly Complexity[] = ['trivial', 'standard', 'hard']
/** The parent's model: today's behaviour, no routing. */
const INHERIT = 'inherit'
/** Without `models` in `.code-buddy.json`. */
const DEFAULT_MODELS: Project['models'] = {
  trivial: 'haiku',
  standard: INHERIT,
  hard: 'opus',
}
// What the classifier reads before the comment, so its labels mean the same
// every time. The comment itself is data: the engine's classifier prompt says so.
const GUIDE = [
  'Feedback a reader left on their web app, for a coding agent. How much work does it need?',
  '- trivial: copy, spacing, colour, a visible property of one element.',
  "- standard: a component's behaviour, a new element, a small feature.",
  '- hard: anything across several components or pages, data or API changes, or a question that needs a product decision.',
].join('\n')
// A hook's own time is bounded: past this, the agent starts on its own model.
const CLASSIFY_MS = 5_000
const MAX_CLASSIFIED = 2_000

// A hook's own time is bounded (10 s, waits included).
const LOCK_WAIT_MS = 6_000
const LOCK_POLL_MS = 200
const STALE_MS = 20 * 60 * 1000
const MAX_TEXT = 400

const BUILD = /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?build\b|\b(?:next|vite)\s+build\b/
const WORD = String.raw`[^\s;&|()<>]+`
// The agent's scripts, called by any path (`$S/claim.mjs` too).
const CLAIM = new RegExp(String.raw`\bclaim\.mjs\s+(${WORD})`)
// The folder claim.mjs was run from, when the command gives it in full.
const SCRIPTS_DIR = /(\/[^\s;&|()<>'"]*\/)claim\.mjs\b/
const RESOLVE = new RegExp(String.raw`\b(?:resolve|ask)\.mjs\s+(${WORD})`)
// What claim.mjs prints: the project it found from the shell's directory,
// which the hooks cannot see (`--project .` after a `cd`), and the run it
// started, which tags the agent's steps.
const CLAIMED = /^claimed (\S+) \(.*\) project=(\/.*?)(?: run=(\S+))?$/m
// A Bash command that writes files takes no lock: refused to an agent working
// on a comment, which must use Edit or Write. Best effort, on the usual forms.
// What an inline script writes cannot be told: always refused.
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
// Claude Code's own plumbing, not the agent's work.
const INTERNAL_TOOLS = new Set(['SubagentHandback'])

// No node:path in a mod; the paths are the POSIX ones Claude Code hands over.
function normalize(file: string): string {
  const parts: string[] = []
  for (const part of file.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}
const resolve = (root: string, file: string) =>
  normalize(file.startsWith('/') ? file : `${root}/${file}`)
const relative = (root: string, file: string) =>
  file === root
    ? ''
    : file.startsWith(`${root}/`)
      ? file.slice(root.length + 1)
      : undefined
/** An agent id as a shell word: Claude Code's ids are letters and digits. */
const shellWord = (value: string) => value.replace(/[^\w-]/g, '')
const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`
const unquote = (value: string) => value.replace(/^["']|["']$/g, '')
const basename = (file: string) => file.slice(file.lastIndexOf('/') + 1)
/** `file` as seen from `root`, `../` included. */
function relativeFrom(root: string, file: string) {
  const from = root.split('/').filter(Boolean)
  const to = file.split('/').filter(Boolean)
  let shared = 0
  while (shared < from.length && from[shared] === to[shared]) shared++
  return [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join('/')
}
const short = (text: string, max = 80) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text
const clip = (text: string) => short(text.trim().replace(/\s+/g, ' '), MAX_TEXT)

// ---------------------------------------------------------------------------
// The hook log: what the hooks decide for the agents working on comments, one
// line each, to check them in a real session. Off unless the marker file
// exists; `/code-buddy-debug on` creates it, in the state folder every session
// shares, so it turns the log on in all of them within a few seconds.

// The marker is checked at most this often: no file access per tool call.
const RECHECK_MS = 5_000
// $.fs has no append, so each line rewrites the log: keep it small.
const MAX_LOG = 256 * 1024
const SHOWN_LINES = 20

let stateDirOnce: Promise<string> | undefined
let checkedAt = -Infinity
let isOn = false
let writing: Promise<void> = Promise.resolve()

/** lib/project.mjs's state folder: CODE_BUDDY_STATE_DIR, else the user's cache. */
function stateDir($: $): Promise<string> {
  stateDirOnce ??= (async () => {
    const set = await $.env.get('CODE_BUDDY_STATE_DIR')
    if (set) return set
    const cache =
      (await $.env.get('XDG_CACHE_HOME')) ?? `${await $.env.get('HOME')}/.cache`
    return `${cache}/code-buddy`
  })()
  return stateDirOnce
}

const paths = async ($: $) => {
  const dir = await stateDir($)
  return { marker: `${dir}/debug`, log: `${dir}/hook.log` }
}

async function isLogging($: $) {
  const now = Date.now()
  if (now - checkedAt >= RECHECK_MS) {
    checkedAt = now
    isOn = await $.fs.exists((await paths($)).marker).catch(() => false)
  }
  return isOn
}

/**
 * Appends `<time> <agent> <comment> <message>` to the log when it is on.
 * `comment` is `-` before the agent claimed one.
 */
async function debug($: $, agent: string, comment: string, message: string) {
  if (!(await isLogging($))) return
  const { log } = await paths($)
  const line = `${new Date().toISOString()} ${agent} ${comment} ${message}\n`
  writing = writing
    .then(async () => {
      let text = await $.fs.read(log).catch(() => '')
      if (text.length > MAX_LOG)
        text = text.slice(text.indexOf('\n', text.length - MAX_LOG / 2) + 1)
      return $.fs.write(log, text + line)
    })
    .catch(() => undefined)
  return writing
}

/** `/code-buddy-debug [on|off]`: the answer the person reads. */
async function debugCommand($: $, args: string): Promise<string> {
  const { marker, log } = await paths($)
  const follow = `Follow it from a terminal: tail -f ${log}`
  const word = args.trim().toLowerCase()
  if (word === 'on') {
    await $.fs.write(marker, '')
    checkedAt = -Infinity
    return [
      `Code Buddy's hook log is on, in every Claude Code session (within ${RECHECK_MS / 1000} s).`,
      follow,
      'Turn it off with /code-buddy-debug off.',
    ].join('\n')
  }
  if (word === 'off') {
    await $.process.run(['rm', '-f', marker])
    checkedAt = -Infinity
    return `Code Buddy's hook log is off. What it logged stays in ${log}.`
  }
  if (word) return 'Usage: /code-buddy-debug [on|off]. Without a word, it shows the log.'
  const on = await $.fs.exists(marker)
  const text = await $.fs.read(log).catch(() => '')
  const last = text.trimEnd().split('\n').filter(Boolean).slice(-SHOWN_LINES)
  return [
    on
      ? `Code Buddy's hook log is on. ${follow}`
      : "Code Buddy's hook log is off: /code-buddy-debug on turns it on.",
    ...(last.length ? ['', `Last ${last.length} line(s) of ${log}:`, ...last] : []),
  ].join('\n')
}

const projects = new Map<string, Promise<Project>>()

/** What `git rev-parse <flags>` answers in `dir`, or undefined outside a repository. */
async function gitPath($: $, dir: string, flags: string[]) {
  const git = await $.process
    .run(['git', '-C', dir, 'rev-parse', ...flags])
    .catch(() => undefined)
  const said = git?.exitCode === 0 ? git.stdout.trim() : ''
  return said.startsWith('/') ? normalize(said) : undefined
}

const gitTop = ($: $, dir: string) => gitPath($, dir, ['--show-toplevel'])

/** The main checkout of the repository `dir` is in: a worktree's lacks untracked files. */
async function mainCheckout($: $, dir: string) {
  const common = await gitPath($, dir, ['--path-format=absolute', '--git-common-dir'])
  return common?.endsWith('/.git') ? common.slice(0, -'/.git'.length) : undefined
}

async function loadProjectOnce($: $, root: string): Promise<Project> {
  const config: { commentsFile?: string; models?: unknown } = JSON.parse(
    await $.fs.read(`${root}/.code-buddy.json`),
  )
  const stateRoot = await stateDir($)
  const commentsFile =
    (await $.env.get('CODE_BUDDY_COMMENTS_FILE')) ??
    config.commentsFile ??
    '.code-buddy/comments.json'
  // lib/project.mjs: the state folder is named after sha1(root).
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(root))
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12)
  const top = await gitTop($, root)
  return {
    root,
    lockRoot: top && relative(top, root) !== undefined ? top : root,
    commentsFile: resolve(root, commentsFile),
    progressDir: `${stateRoot}/${hash}/progress`,
    models: modelsOf(config.models),
  }
}

/**
 * `.code-buddy.json`'s `models`, whole: a label it leaves out inherits, so
 * `{ "trivial": "inherit" }` turns routing off. Absent: the default.
 */
function modelsOf(value: unknown): Project['models'] {
  if (typeof value !== 'object' || value === null) return DEFAULT_MODELS
  const models: Project['models'] = {}
  for (const [label, model] of Object.entries(value)) {
    const known = COMPLEXITIES.find((one) => one === label)
    if (known && typeof model === 'string' && model.trim()) models[known] = model.trim()
  }
  return models
}

function loadProject($: $, root: string): Promise<Project> {
  let found = projects.get(root)
  if (!found) {
    found = loadProjectOnce($, root)
    found.catch(() => projects.delete(root))
    projects.set(root, found)
  }
  return found
}

/**
 * Ids of the comments an agent may work on, as lib/store.mjs's isActive;
 * undefined when the file cannot be read, or is in another format.
 */
async function activeCommentIds($: $, project: Project) {
  try {
    const file: CommentsFile = JSON.parse(await $.fs.read(project.commentsFile))
    if (file.version !== 2 || !Array.isArray(file.comments)) return undefined
    return new Set(
      file.comments
        .filter((c) => c.state === 'open' || c.state === 'working')
        .map((c) => c.id),
    )
  } catch {
    return undefined
  }
}

// $.fs has no append: one read-then-write at a time per file.
const writes = new Map<string, Promise<void>>()

function appendProgress($: $, project: Project, comment: string, steps: Step[]) {
  if (!steps.length) return Promise.resolve()
  const file = `${project.progressDir}/${comment}.jsonl`
  const lines = steps.map((step) => `${JSON.stringify(step)}\n`).join('')
  const done = (writes.get(file) ?? Promise.resolve())
    .then(async () => {
      let text = ''
      try {
        text = await $.fs.read(file)
      } catch {}
      return $.fs.write(file, text + lines)
    })
    .catch(() => undefined)
  writes.set(file, done)
  return done
}

/** Nothing for a comment the reader stopped: its agent may still call tools. */
async function record(
  $: $,
  agent: string,
  project: Project,
  comment: string,
  steps: Step[],
) {
  if (!steps.length) return
  const active = await activeCommentIds($, project)
  if (active && !active.has(comment)) {
    await debug($, agent, comment, 'recorded nothing: the comment is no longer active')
    return
  }
  const run = (await bindingOf($, agent))?.run
  await appendProgress(
    $,
    project,
    comment,
    steps.map((step) => ({ ...step, ...(run && { run }), agent })),
  )
  for (const step of steps) {
    const state = typeof step.state === 'string' ? ` ${step.state}` : ''
    await debug(
      $,
      agent,
      comment,
      `recorded ${String(step.kind)}${state} "${String(step.label)}"`,
    )
  }
}

/**
 * AskUserQuestion would reach the session's terminal, never the reader, who is
 * on the page: the agent asks in the comment's thread instead.
 */
const askInThread = ({ root, comment, scripts }: Binding) =>
  'The reader answers in the browser, where AskUserQuestion never shows. Ask in ' +
  `the comment's thread instead: node ${JSON.stringify(`${scripts ?? 'SKILL/scripts/'}ask.mjs`)} ` +
  `${comment} --project ${JSON.stringify(root)} ` +
  '"<question>" --option "<label>: <description>" --option "…" (2 to 6 options; ' +
  'add --multiple to let the reader pick several), then reply "QUESTION: <your question>".'

function writeTarget(tool: string, args: Record<string, string | undefined>) {
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') return args.file_path
  if (tool === 'NotebookEdit') return args.notebook_path
  if (tool === 'Bash' && BUILD.test(args.command ?? '')) return '@build'
  return undefined
}

/** The agent's own scripts pass: an answer may quote anything. */
function writesFromBash(command: string, project: Project) {
  if (CLAIM.test(command) || RESOLVE.test(command)) return false
  if (SCRIPT_WRITES.some((pattern) => pattern.test(command))) return true
  const targets: string[] = []
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
      !file.startsWith('/') || relative(project.lockRoot, normalize(file)) !== undefined
    )
  })
}

function describe(
  project: Project,
  tool: string,
  args: Record<string, string | undefined>,
) {
  // From the project, as the agent's prompt and the reader see paths.
  const repoPath = (file = '') => {
    const full = resolve(project.root, file)
    return relative(project.lockRoot, full) === undefined
      ? basename(file)
      : relativeFrom(project.root, full)
  }
  if (tool.startsWith('mcp__')) {
    const [, server, name] = tool.split('__')
    return { kind: 'mcp', label: `${server} · ${name}` }
  }
  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return { kind: tool.toLowerCase(), label: repoPath(args.file_path) }
    case 'NotebookEdit':
      return { kind: 'edit', label: repoPath(args.notebook_path) }
    case 'Bash':
      return CLAIM.test(args.command ?? '')
        ? { kind: 'start', label: 'Started' }
        : { kind: 'bash', label: short(args.description || args.command || '') }
    case 'Grep':
    case 'Glob':
      return { kind: 'search', label: short(args.pattern ?? '') }
    case 'WebFetch':
      return {
        kind: 'web',
        label: args.url && URL.canParse(args.url) ? new URL(args.url).host : 'web',
      }
    case 'WebSearch':
      return { kind: 'web', label: short(args.query ?? '') }
    case 'Skill':
      return { kind: 'skill', label: args.skill ?? '' }
    default:
      return { kind: 'tool', label: tool }
  }
}

/** The comment and project a worker's prompt names: `<id>` first, then `PROJECT=<dir>`. */
function workerTask(prompt: string) {
  const lines = prompt.split('\n').map((line) => line.trim())
  const comment = lines[0] ?? ''
  const root = lines.find((line) => line.startsWith('PROJECT='))?.slice('PROJECT='.length)
  return /^[\w-]+$/.test(comment) && root?.startsWith('/')
    ? { comment, root: normalize(root) }
    : undefined
}

async function readComment($: $, project: Project, id: string) {
  try {
    const file: CommentsFile = JSON.parse(await $.fs.read(project.commentsFile))
    return Array.isArray(file.comments)
      ? file.comments.find((comment) => comment.id === id)
      : undefined
  } catch {
    return undefined
  }
}

/** What the classifier reads: the reader's last message, what it is about, and the page. */
function classifiedText(comment: CommentsFile['comments'][number]) {
  const said = comment.messages?.findLast((message) => message.author === 'reader')
  if (!said?.body.trim()) return undefined
  const { quote, element } = comment.anchor ?? {}
  return [
    GUIDE,
    '',
    `Page: ${comment.route === '*' ? 'the whole app' : (comment.route ?? '')}`,
    ...(quote ? [`Selected text: "${short(quote, 300)}"`] : []),
    ...(element?.tag
      ? [`Element: <${element.tag}> ${short(element.text ?? '', 200)}`]
      : []),
    `Comment: ${short(said.body.trim(), MAX_CLASSIFIED)}`,
  ].join('\n')
}

/** The comment's label, or undefined: routing never blocks a comment. */
async function classify($: $, text: string): Promise<Complexity | undefined> {
  const label = await Promise.race([
    $.model.classify(text, COMPLEXITIES).catch(() => undefined),
    $.clock.sleep(CLASSIFY_MS).then(() => undefined),
  ])
  return COMPLEXITIES.find((known) => known === label)
}

/** The model a comment's agent is to start on, and why; none to keep the caller's. */
async function routeComment($: $, project: Project, id: string) {
  const routing = COMPLEXITIES.some(
    (label) => (project.models[label] ?? INHERIT) !== INHERIT,
  )
  const comment = routing ? await readComment($, project, id) : undefined
  const text = comment && classifiedText(comment)
  const complexity = text ? await classify($, text) : undefined
  const model = complexity && project.models[complexity]
  return { complexity, model: model && model !== INHERIT ? model : undefined }
}

/**
 * The route of the comment a claim.mjs command claims, when `agent` is the one
 * started for it: resumed for a follow-up, it keeps its model; any other
 * agent's claim names none it does not run on.
 */
async function routeOfClaim($: $, command: string, agent: string) {
  const id = CLAIM.exec(command)?.[1]
  const route = id ? (await read($, routes))[unquote(id)] : undefined
  return route?.agent === agent ? route : undefined
}

/** claim.mjs's environment: the agent, and the model it runs on. */
function claimEnv(agent: string, route: Route | undefined) {
  const env = [`CODE_BUDDY_AGENT=${shellWord(agent)}`]
  if (route) env.push(`CODE_BUDDY_MODEL=${shellQuote(route.model)}`)
  if (route?.complexity) env.push(`CODE_BUDDY_COMPLEXITY=${route.complexity}`)
  return `export ${env.join(' ')};`
}

const lockKey = (root: string, target: string) => `${root}\n${target}`

async function tryLock($: $, project: Project, owner: string, target: string) {
  const active = await activeCommentIds($, project)
  const key = lockKey(project.lockRoot, target)
  let holder: string | undefined
  await update($, locks, (all) => {
    const held = all[key]
    holder = undefined
    if (held && held.owner !== owner) {
      const stale =
        Date.now() - held.at > STALE_MS ||
        (active !== undefined && !active.has(held.owner))
      if (!stale) {
        holder = held.owner
        return all
      }
    }
    return { ...all, [key]: { owner, at: Date.now() } }
  })
  return holder
}

async function releaseAll($: $, { lockRoot: root }: Project, owner: string) {
  const released: string[] = []
  await update($, locks, (all) => {
    released.length = 0
    const kept: Record<string, Lock> = {}
    for (const [key, lock] of Object.entries(all)) {
      if (lock.owner === owner && key.startsWith(`${root}\n`)) {
        released.push(key.slice(root.length + 1))
      } else kept[key] = lock
    }
    return kept
  })
  return released
}

async function unlock($: $, project: Project, owner: string, target: string) {
  const key = lockKey(project.lockRoot, target)
  await update($, locks, (all) => {
    if (all[key]?.owner !== owner) return all
    const { [key]: _, ...rest } = all
    return rest
  })
}

/** The deny message, or undefined when the agent holds the lock. */
async function lockTarget(
  $: $,
  agent: string,
  project: Project,
  binding: Binding,
  target: string,
  step: Step,
): Promise<string | undefined> {
  const log = (message: string) => debug($, agent, binding.comment, message)
  const active = await activeCommentIds($, project)
  if (active && !active.has(binding.comment)) {
    await log(`refused ${target}: the reader stopped or resolved the comment`)
    return `Comment ${binding.comment} was cancelled, resolved or deleted by the reader. Stop now: make no further changes and reply "CANCELLED".`
  }
  const relativeTarget =
    target === '@build'
      ? target
      : relative(project.lockRoot, resolve(project.root, target))
  if (relativeTarget === undefined) {
    await log(`no lock for ${target}: outside ${project.lockRoot}`)
    return undefined
  }
  const deadline = (await $.clock.now()) + LOCK_WAIT_MS
  let waited = false
  for (;;) {
    const holder = await tryLock($, project, binding.comment, relativeTarget)
    if (holder === undefined) {
      await log(`locked ${relativeTarget}`)
      return undefined
    }
    if (!waited) await log(`waiting for ${relativeTarget}, held by comment ${holder}`)
    waited = true
    if ((await $.clock.now()) >= deadline) {
      const released = await releaseAll($, project, binding.comment)
      await log(
        `refused ${relativeTarget}: still held by comment ${holder}; released ${released.length} lock(s)`,
      )
      await record($, agent, project, binding.comment, [
        {
          ...step,
          state: 'failed',
          error: `${relativeTarget} is being changed by another comment's agent`,
        },
      ])
      return (
        `${relativeTarget} is being changed by the agent of comment ${holder}. ` +
        `Your ${released.length} lock(s) were released to avoid a deadlock: ` +
        're-read the files you are changing, then retry this step.'
      )
    }
    await $.clock.sleep(LOCK_POLL_MS)
  }
}

async function bindingOf($: $, agent: string) {
  return (await read($, bindings))[agent]
}

async function setBinding($: $, agent: string, binding: Binding | undefined) {
  const all = await update($, bindings, (current) => {
    const { [agent]: _, ...rest } = current
    return binding ? { ...rest, [agent]: binding } : rest
  })
  await showStatus($, Object.keys(all).length)
}

/** The projects watched, and the agents bound to a comment. */
async function showStatus($: $, bound?: number) {
  const count = bound ?? Object.keys(await read($, bindings)).length
  const parts = [
    ...(watches.size ? [`watching ${[...watches.keys()].map(basename).join(', ')}`] : []),
    ...(count ? [`${count} agent(s) on comments`] : []),
  ]
  $.ui.status(parts.length ? `code-buddy: ${parts.join(' · ')}` : undefined)
}

/**
 * The script that ended the run, done: the store archived the run's steps
 * while it still ran. Only into a history the store keeps (dev widget).
 */
async function closeLastStep($: $, project: Project, comment: string, step: Step) {
  const history = `${project.progressDir}/${comment}.history.jsonl`
  if (!(await $.fs.exists(history).catch(() => false))) return
  const text = await $.fs.read(history).catch(() => '')
  await $.fs.write(history, `${text}${JSON.stringify(step)}\n`)
}

async function finish(
  $: $,
  agent: string,
  project: Project,
  comment: string,
  last: Step,
) {
  const run = (await bindingOf($, agent))?.run
  await closeLastStep($, project, comment, { ...last, ...(run && { run }), agent })
  await setBinding($, agent, undefined)
  const released = await releaseAll($, project, comment)
  await debug(
    $,
    agent,
    comment,
    `run ended (answered or asked): unbound, released ${released.length} lock(s), progress dropped`,
  )
  const file = `${project.progressDir}/${comment}.jsonl`
  await writes.get(file)
  writes.delete(file)
  await $.process.run(['rm', '-f', file])
}

/**
 * claim.mjs binds the agent to its comment; resolve.mjs and ask.mjs end its
 * run. A failed chained command may still have run one: its output and the
 * comment's state tell. Returns true when the run ended. `last`: the step of
 * this command, once it ran.
 */
async function followScripts(
  $: $,
  agent: string,
  command: string,
  output: string,
  last: (project: Project) => Step,
) {
  const ended = command.match(RESOLVE)?.[1]
  const binding = await bindingOf($, agent)
  if (ended && binding?.comment === ended) {
    const project = await projectOf($, agent, binding)
    const active = project && (await activeCommentIds($, project))
    if (project && !active?.has(ended)) {
      await finish($, agent, project, ended, last(project))
      return true
    }
  }
  const claimed = CLAIMED.exec(output)
  if (claimed?.[1] && claimed[2]) {
    const root = normalize(claimed[2].trim())
    const run = claimed[3]
    const scripts = SCRIPTS_DIR.exec(command)?.[1]
    await setBinding($, agent, {
      root,
      comment: claimed[1],
      ...(run && { run }),
      ...(scripts && { scripts }),
    })
    await debug(
      $,
      agent,
      claimed[1],
      `bound to comment ${claimed[1]} in ${root}${run ? `, run ${run}` : ''}`,
    )
  } else if (CLAIM.test(command)) {
    const said = output.trim().split('\n')[0] ?? ''
    await debug(
      $,
      agent,
      '-',
      `claim.mjs printed no project, so the agent is not bound: ${short(said, 160)}`,
    )
  }
  return false
}

/** The bound project, or undefined, unbinding the agent, when it cannot be read. */
async function projectOf($: $, agent: string, binding: Binding) {
  try {
    return await loadProject($, binding.root)
  } catch (error) {
    await setBinding($, agent, undefined)
    const why = error instanceof Error ? error.message : String(error)
    await debug(
      $,
      agent,
      binding.comment,
      `cannot read ${binding.root}/.code-buddy.json (${short(why, 120)}): binding dropped`,
    )
    return undefined
  }
}

// ---------------------------------------------------------------------------
// The watch: the project's server, for the session's life, and one agent per
// comment, started from its lines with no model turn.

const MAX_RUNNING = 3
// A hook's own time is bounded: past this, the command answers and the server
// keeps starting.
const START_MS = 8_000
// A resolved comment's agent ends on its own: it resolved it, and unbound.
// Still bound past this, the reader resolved it while the agent worked.
const RESOLVED_GRACE_MS = 3_000
const SERVER_ERRORS = new Set([
  'PORT_BUSY',
  'WIDGET_MISSING',
  'HOOKS_MISSING',
  'COMMENTS_REFUSED',
])
const WATCH_TOOL = 'mcp__code-buddy__watch'

type Kind = 'new' | 'followup' | 'edit'
/** A comment waiting for a free agent, with the latest line about it. */
type Queued = { id: string; line: string; kind: Kind }

type Watch = {
  root: string
  /** The server's first line: `READY`, an error line, or `ENDED <why>`. */
  started: Promise<string>
  /** Comments waiting for a free agent, oldest first. */
  queue: Queued[]
  /** By comment, how many lines came about it: a later one supersedes a wait. */
  heard: Map<string, number>
  stopped: boolean
  stop: () => void
}

/** The servers this module runs, by project root: they die with it. */
const watches = new Map<string, Watch>()
/**
 * Comments whose agent is starting, and what came for them meanwhile: a stop,
 * or the reader's latest edit or follow-up, handed over once it started.
 */
const starting = new Map<string, { stop: boolean; message?: Queued }>()
let rearmed = false
let dispatching: Promise<void> = Promise.resolve()

const ignore = () => undefined
const skillDir = ($: $) => `${$.plugin.root}/skills/code-buddy`
/** A comment's short id, as the agent's name carries it. */
const tag = (id: string) => id.slice(0, 8)

/** The follow-up message, the reader's line in it. */
const followUp = (id: string, line: string) =>
  `The reader followed up on comment ${id}: ${line}\n` +
  'Claim it again, act on the follow-up, run the checks, then resolve it with your answer, as before.'
const edited = (id: string, line: string) =>
  `The reader edited comment ${id} while you work on it: ${line}\n` +
  'Act on the new text instead.'

async function setWorker($: $, id: string, worker: Worker) {
  await update($, workers, (all) => ({ ...all, [id]: worker }))
}

async function workerOf($: $, agent: string) {
  const found = Object.entries(await read($, workers)).find(
    ([, worker]) => worker.agent === agent,
  )
  return found && { id: found[0], worker: found[1] }
}

/** Agents at work, and those starting: the three the cap counts. */
async function busy($: $) {
  const all = Object.values(await read($, workers))
  return all.filter((one) => one.running).length + starting.size
}

async function startQueued($: $) {
  while ((await busy($)) < MAX_RUNNING) {
    const watched = [...watches.values()].find((one) => one.queue.length)
    const next = watched?.queue.shift()
    if (!watched || !next) return
    await handOver($, watched, next)
  }
}

/** Starts the agents the queues hold, three at a time, one start at a time. */
function pump($: $) {
  dispatching = dispatching.then(() => startQueued($)).catch(() => undefined)
  return dispatching
}

/** Sends the reader's edit or follow-up to the comment's agent, which a message resumes. */
async function send($: $, worker: Worker, { id, line, kind }: Queued) {
  const sent = await $.session
    .send({
      to: { agentId: worker.agent },
      text: kind === 'edit' ? edited(id, line) : followUp(id, line),
    })
    .catch(() => undefined)
  await debug(
    $,
    worker.agent,
    id,
    sent?.isDelivered
      ? `sent the ${kind === 'edit' ? 'edit' : 'follow-up'}`
      : `could not send: ${sent?.reason ?? 'refused'}`,
  )
  if (sent?.isDelivered) await setWorker($, id, { ...worker, running: true })
  return Boolean(sent?.isDelivered)
}

/**
 * A queued comment's turn: a follow-up resumes the agent that had it, which
 * keeps its model; anything else, or a follow-up it cannot take, a new agent.
 */
async function handOver($: $, watched: Watch, next: Queued) {
  const worker = (await read($, workers))[next.id]
  if (worker?.running) return
  if (worker && next.kind === 'followup' && (await send($, worker, next))) return
  await startWorker($, watched, next.id, next.line)
}

async function startWorker($: $, watched: Watch, id: string, line: string) {
  const name = `cb-${tag(id)}`
  starting.set(id, { stop: false })
  const started = await $.agent
    .spawn({
      subagentType: WORKER,
      name,
      description: `Code Buddy comment ${tag(id)}`,
      // The paths first: the reader's line is data, and comes last.
      prompt: [id, `SKILL=${skillDir($)}`, `PROJECT=${watched.root}`, line].join('\n'),
    })
    .catch((error: unknown) => ({
      deny: error instanceof Error ? error.message : String(error),
      agentId: undefined,
    }))
  // A spawn a hook answered carries no id: the agent list names it.
  const agent =
    started.agentId ??
    (started.deny === undefined
      ? (await $.agent.list().catch(() => [])).findLast((one) => one.name === name)?.id
      : undefined)
  const meanwhile = starting.get(id)
  starting.delete(id)
  if (!agent) {
    const why = started.deny ?? 'no agent started'
    $.ui.toast(`Code Buddy could not start an agent for comment ${tag(id)}: ${why}`)
    await debug($, 'main', id, `could not start an agent: ${short(why, 160)}`)
    return
  }
  const worker = { agent, running: true }
  await setWorker($, id, worker)
  await debug($, agent, id, `started for ${line.split(' ')[0]}`)
  if (meanwhile?.stop) await stopWorker($, watched, id)
  else if (meanwhile?.message) await send($, worker, meanwhile.message)
}

/**
 * A comment needs an agent: a new one, or the reader's follow-up or edit,
 * which goes to the agent at work on it when there is one.
 */
async function dispatch($: $, watched: Watch, next: Queued) {
  const pending = starting.get(next.id)
  if (pending) {
    if (next.kind !== 'new') pending.message = next
    return
  }
  const queued = watched.queue.find((one) => one.id === next.id)
  if (queued) {
    queued.line = next.line
    return
  }
  const worker = (await read($, workers))[next.id]
  if (worker?.running) {
    if (next.kind === 'new' || (await send($, worker, next))) return
    // Gone without a word: a new agent takes the comment.
    await setWorker($, next.id, { ...worker, running: false })
    watched.queue.push({ ...next, kind: 'new' })
  } else watched.queue.push(next)
  await pump($)
}

/** Ends the comment's agent; `ifBound`: only while it still works on it. */
async function stopWorker($: $, watched: Watch, id: string, ifBound = false) {
  watched.queue = watched.queue.filter((one) => one.id !== id)
  const pending = starting.get(id)
  if (pending) {
    // A resolved comment's claim fails: its agent stops on its own.
    if (!ifBound) pending.stop = true
    return
  }
  const worker = (await read($, workers))[id]
  if (!worker?.running) return
  if (ifBound && (await bindingOf($, worker.agent))?.comment !== id) return
  await $.tool.call({ tool: 'TaskStop', task_id: worker.agent }).catch(() => undefined)
  await setWorker($, id, { ...worker, running: false })
  await debug($, worker.agent, id, 'stopped: the reader ended the comment')
  void pump($)
}

async function onLine(
  $: $,
  watched: Watch,
  line: string,
  settle: (line: string) => void,
) {
  const [kind = '', id = ''] = line.split(' ', 2)
  if (kind === 'READY') return settle(line)
  if (SERVER_ERRORS.has(kind)) {
    settle(line)
    await update($, watching, (all) => {
      const { [watched.root]: _, ...rest } = all
      return rest
    })
    return
  }
  if (!/^[\w-]+$/.test(id)) return
  const heard = (watched.heard.get(id) ?? 0) + 1
  watched.heard.set(id, heard)
  switch (kind) {
    case 'OPEN':
    case 'NEW':
      return dispatch($, watched, { id, line, kind: 'new' })
    case 'FOLLOWUP':
      return dispatch($, watched, { id, line, kind: 'followup' })
    case 'EDIT':
      return dispatch($, watched, { id, line, kind: 'edit' })
    case 'CANCELLED':
    case 'DELETED':
      return stopWorker($, watched, id)
    case 'RESOLVED':
      // Unless the reader opened it again meanwhile.
      void $.clock
        .sleep(RESOLVED_GRACE_MS)
        .then(() =>
          watched.heard.get(id) === heard ? stopWorker($, watched, id, true) : undefined,
        )
        .catch(() => undefined)
      return
    default:
      // ASKED, ANSWERED: the agent's own end; the reader answers in the thread.
      return
  }
}

/** Starts the project's server and reads its lines, until it ends. */
function serve($: $, root: string): Watch {
  let settle: (line: string) => void = ignore
  const started = new Promise<string>((done) => {
    settle = done
  })
  const stream = $.process.spawn({
    argv: ['node', `${skillDir($)}/scripts/server.mjs`, '--project', root],
    env: { CODE_BUDDY_HOOKS: '1' },
  })
  const pieces = stream[Symbol.asyncIterator]()
  const watched: Watch = {
    root,
    started,
    queue: [],
    heard: new Map(),
    stopped: false,
    stop: () => {
      watched.stopped = true
      void pieces.return?.({ code: null, signal: null })
    },
  }
  watches.set(root, watched)
  void (async () => {
    let pending = ''
    let errors = ''
    let ended = 'the server stopped'
    try {
      for (;;) {
        const piece = await pieces.next()
        if (piece.done) {
          const { code, signal } = piece.value ?? { code: null, signal: null }
          ended = `the server exited (${signal ?? `code ${code}`})`
          break
        }
        if (piece.value.stream === 'stderr') {
          errors = (errors + piece.value.text).slice(-2_000)
          continue
        }
        const lines = (pending + piece.value.text).split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim()) await onLine($, watched, line.trim(), settle)
        }
      }
    } catch (error) {
      ended = `the server could not run: ${error instanceof Error ? error.message : String(error)}`
    }
    const why = errors.trim().split('\n').at(-1)
    settle(`ENDED ${ended}${why ? `: ${short(why, 300)}` : ''}`)
    if (watches.get(root) !== watched) return
    watches.delete(root)
    await showStatus($)
    if (!watched.stopped && (await watched.started).startsWith('READY')) {
      $.ui.toast(
        `Code Buddy stopped watching ${basename(root)}: ${ended}. /code-buddy starts it again.`,
      )
    }
  })()
  return watched
}

/** What the command and the tool answer, from the server's first line. */
async function startedText(
  $: $,
  root: string,
  first: string | undefined,
  again: boolean,
) {
  if (first === undefined)
    return `Code Buddy's server for ${root} has not answered yet; it keeps starting in the background.`
  const [kind, ...rest] = first.split(' ')
  const said = rest.join(' ')
  switch (kind) {
    case 'READY': {
      const config = await $.fs
        .read(`${root}/.code-buddy.json`)
        .then((text): { devUrl?: unknown } => JSON.parse(text))
        .catch(() => ({ devUrl: undefined }))
      const app = typeof config.devUrl === 'string' ? config.devUrl : 'the app'
      return [
        `Code Buddy is ${again ? 'already ' : ''}watching ${root} (${rest[0] ?? ''}).`,
        `Open or reload ${app}: each comment starts an agent in the background at once, even while you work with Claude here.`,
        'The server stops with this session; /code-buddy starts it again, and nothing is lost.',
      ].join('\n')
    }
    case 'PORT_BUSY':
      return `Code Buddy cannot start: port ${said}. Another session may already watch this project.`
    case 'WIDGET_MISSING':
      return `Code Buddy runs from a clone that has no widget built: ${said}, then /code-buddy again.`
    case 'HOOKS_MISSING':
      return `Code Buddy cannot start: ${said}.`
    case 'COMMENTS_REFUSED':
      return `Code Buddy cannot read the comments file: ${said}`
    default:
      return `Code Buddy's server did not start: ${said}`
  }
}

async function startWatch($: $, root: string) {
  if (!(await hasConfig($, root)))
    return `No .code-buddy.json in ${root}: run /code-buddy:code-buddy init there first.`
  const known = watches.get(root)
  const watched = known ?? serve($, root)
  if (!known) {
    await update($, watching, (all) => ({ ...all, [root]: true as const }))
    await showStatus($)
  }
  const first = await Promise.race([
    watched.started,
    $.clock.sleep(START_MS).then(() => undefined),
  ])
  return startedText($, root, first, Boolean(known))
}

async function stopWatching($: $) {
  if (!watches.size) return 'Code Buddy is not watching any project in this session.'
  const roots = [...watches.keys()]
  for (const watched of watches.values()) watched.stop()
  watches.clear()
  await update($, watching, () => noWatching)
  await showStatus($)
  return `Code Buddy stopped watching ${roots.join(', ')}. Agents at work finish their comments.`
}

const hasConfig = ($: $, dir: string) =>
  $.fs.exists(`${dir}/.code-buddy.json`).catch(() => false)

const parent = (dir: string) => dir.slice(0, dir.lastIndexOf('/')) || '/'

/** The nearest folder from `dir` up to `last` that holds `.code-buddy.json`. */
async function nearest($: $, dir: string, last = '/') {
  for (let at = dir; ; at = parent(at)) {
    if (await hasConfig($, at)) return at
    if (at === last || at === '/') return undefined
  }
}

/**
 * The project `/code-buddy [dir]` means, as the skill finds it: `dir` from the
 * session's directory, else from the git toplevel; without one, the nearest
 * folder up that holds `.code-buddy.json`. In a git worktree, where that file
 * is often untracked, the same place in the main checkout.
 */
async function findProject($: $, dir: string) {
  const cwd = normalize(await $.session.cwd())
  const top = await gitTop($, cwd)
  const main = top && (await mainCheckout($, cwd))
  const inMain = main && main !== top && `${main}/${relative(top, cwd) ?? ''}`
  if (dir) {
    for (const base of [cwd, top, inMain]) {
      const candidate = base && resolve(base, dir)
      if (candidate && (await hasConfig($, candidate))) return candidate
    }
    return undefined
  }
  return (
    (await nearest($, cwd)) ??
    (inMain && main ? nearest($, normalize(inMain), main) : undefined)
  )
}

/**
 * The tool's project, when the session may watch it: in the session's folder,
 * its repository or that one's main checkout, or a folder above the session.
 */
async function mayWatch($: $, project: string) {
  const cwd = normalize(await $.session.cwd())
  const top = await gitTop($, cwd)
  const main = top && (await mainCheckout($, cwd))
  return (
    relative(project, cwd) !== undefined ||
    [cwd, top, main].some((place) => place && relative(place, project) !== undefined)
  )
}

/** `/code-buddy [dir|stop]`: the answer the person reads. */
async function watchCommand($: $, args: string) {
  const word = args.trim()
  if (word === 'stop') return stopWatching($)
  const root = await findProject($, word)
  if (root) return startWatch($, root)
  return (
    `No .code-buddy.json ${word ? `in ${word}` : 'in this folder or above'}: ` +
    '/code-buddy:code-buddy init installs Code Buddy, and finds the main checkout from a git worktree.'
  )
}

// After a reload, the old module's server may hold the port a moment longer.
const REARM_TRIES = 3
const REARM_WAIT_MS = 1_000

/** The project's server again, after a reload; a port still busy is tried again. */
async function serveAgain($: $, root: string) {
  for (let tries = 1; ; tries++) {
    const line = await serve($, root).started
    await showStatus($)
    if (line.startsWith('PORT_BUSY') && tries < REARM_TRIES) {
      await $.clock.sleep(REARM_WAIT_MS)
      continue
    }
    if (line.startsWith('READY')) {
      await update($, watching, (all) => ({ ...all, [root]: true as const }))
      $.ui.toast(`Code Buddy is watching ${basename(root)} again.`)
    } else $.ui.toast(`Code Buddy could not watch ${basename(root)} again: ${line}`)
    return
  }
}

/** After a reload of the module, the servers it ran start again. */
async function rearm($: $) {
  if (rearmed) return
  rearmed = true
  for (const root of Object.keys(await read($, watching))) {
    if (!watches.has(root)) void serveAgain($, root).catch(() => undefined)
  }
}

/** A comment's agent ended its run: its one line for the person, and the next in line. */
async function workerDone($: $, agent: string, answer: string) {
  const done = await workerOf($, agent)
  if (!done) return
  await setWorker($, done.id, { ...done.worker, running: false })
  const said = answer.trim().split('\n')[0] ?? ''
  if (said && said !== 'CANCELLED') {
    $.ui.log(`code-buddy ${tag(done.id)}: ${short(said, 300)}`)
    if (said.startsWith('QUESTION:'))
      $.ui.toast(
        `Code Buddy asks, on comment ${tag(done.id)}: ${short(said.slice(9).trim(), 200)}`,
      )
  }
  void pump($)
}

export const register: Register = (on) => {
  // Tells server.mjs, started from this session, that the hooks are loaded:
  // without them, agents would work with no locks and no progress.
  on('session.start', async ($, e, next) => {
    await $.env.set('CODE_BUDDY_HOOKS', '1')
    await $.command.register({
      name: 'code-buddy-debug',
      description:
        "Code Buddy: log what the plugin's hooks decide (on, off, or show the log)",
      argumentHint: '[on|off]',
      immediate: true,
    })
    // Immediate: it runs mid-turn, and starts no turn of its own.
    await $.command.register({
      name: 'code-buddy',
      description:
        'Code Buddy: watch the app for comments, one background agent each (a folder, or stop)',
      argumentHint: '[dir|stop]',
      immediate: true,
    })
    // The skill's way in: it finds the project, then hands it over.
    await $.tool.register({
      name: 'watch',
      description:
        "Starts Code Buddy's watch on a project: its server, and one background agent per comment the reader leaves. Call it only when the code-buddy skill says so.",
      inputSchema: {
        type: 'object',
        properties: {
          project: {
            type: 'string',
            description:
              'The project root, absolute: the folder holding .code-buddy.json.',
          },
        },
        required: ['project'],
      },
    })
    const { version } = await $.session.version()
    await debug($, 'main', '-', `hooks loaded in a new session (Claude Code ${version})`)
    await rearm($)
    return next(e)
  })

  on('command.run', { command: 'code-buddy-debug' }, async ($, e) => ({
    text: await debugCommand($, e.args),
  }))

  on('command.run', { command: 'code-buddy' }, async ($, e) => ({
    text: await watchCommand($, e.args),
  }))

  on('tool.call', { tool: WATCH_TOOL }, async ($, e) => {
    const { project } = e
    if (typeof project !== 'string' || !project.startsWith('/'))
      return { deny: 'Give the project root as an absolute path.' }
    if (!(await mayWatch($, normalize(project))))
      return {
        deny: `${project} is outside this session's folder and repository: the user runs /code-buddy there to watch it.`,
      }
    return { result: await startWatch($, normalize(project)) }
  })

  on('tool.call', async ($, e, next) => {
    void rearm($)
    if (INTERNAL_TOOLS.has(e.tool)) return next(e)
    const agent = e.agentId ?? 'main'
    // The tool's string arguments, beside the envelope (`e.command` for Bash).
    const args: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(e)) {
      if (typeof value === 'string') args[key] = value
    }
    const isClaim = e.tool === 'Bash' && CLAIM.test(args.command ?? '')
    const route = isClaim ? await routeOfClaim($, args.command ?? '', agent) : undefined
    // The Started step says which model the agent runs on.
    const routed = route && {
      model: route.model,
      ...(route.complexity && { complexity: route.complexity }),
    }
    const binding = await bindingOf($, agent)
    const project = binding && (await projectOf($, agent, binding))
    if (binding && project && e.tool === 'AskUserQuestion') {
      await debug($, agent, binding.comment, 'refused AskUserQuestion: ask in the thread')
      return { deny: askInThread(binding) }
    }
    if (binding && project) {
      const step = {
        at: Date.now(),
        id: e.tool_use_id,
        ...describe(project, e.tool, args),
        ...routed,
      }
      if (e.tool === 'Bash' && writesFromBash(args.command ?? '', project)) {
        await debug(
          $,
          agent,
          binding.comment,
          `refused a Bash write: ${short(args.command ?? '', 120)}`,
        )
        await record($, agent, project, binding.comment, [
          {
            ...step,
            state: 'failed',
            error: 'writes files from Bash; use Edit or Write',
          },
        ])
        return {
          deny:
            'This command writes files from Bash, where Code Buddy cannot lock them against ' +
            "the other comments' agents. Make the change with the Edit or Write tool instead.",
        }
      }
      const target = writeTarget(e.tool, args)
      if (target) {
        const deny = await lockTarget($, agent, project, binding, target, step)
        if (deny) return { deny }
      }
      await record($, agent, project, binding.comment, [{ ...step, state: 'running' }])
    }

    // claim.mjs records which agent opened the run, and its model: the hooks
    // alone know them.
    const ran = await next(
      isClaim ? { ...e, command: `${claimEnv(agent, route)} ${args.command}` } : e,
    )
    if (ran.deny !== undefined) return ran

    const command = e.tool === 'Bash' ? (args.command ?? '') : ''
    const done = (where: Project): Step => ({
      at: Date.now(),
      id: e.tool_use_id,
      ...describe(where, e.tool, args),
      ...routed,
      state: ran.isError ? 'failed' : 'done',
    })
    if (await followScripts($, agent, command, ran.text ?? '', done)) return ran
    // Read again: claim.mjs may have just bound the agent.
    const bound = await bindingOf($, agent)
    const boundProject = bound && (await projectOf($, agent, bound))
    if (!bound || !boundProject) return ran
    // A failed build frees the build lock as a successful one does.
    if (BUILD.test(command)) {
      await unlock($, boundProject, bound.comment, '@build')
      await debug($, agent, bound.comment, 'build ended: released the build lock')
    }
    const step = done(boundProject)
    if (ran.isError) step.error = short((ran.text ?? '').trim().split('\n')[0] ?? '', 160)
    await record($, agent, boundProject, bound.comment, [step])
    return ran
  })

  // A comment's agent is about to start: the classifier sorts the comment, and
  // `.code-buddy.json`'s `models` picks the model for its label. Whatever the
  // agent ends up on is kept for its claim, which records it on the run.
  on('agent.spawn', { subagentType: WORKER }, async ($, e, next) => {
    const task = workerTask(e.prompt)
    const project = task && (await loadProject($, task.root).catch(() => undefined))
    if (!task || !project) return next(e)
    const { model, complexity } = await routeComment($, project, task.comment)
    const started = await next(model && !e.fork ? { ...e, model } : e)
    if (started.deny !== undefined) return started
    await update($, routes, (all) => ({
      ...all,
      [task.comment]: {
        model: started.model,
        ...(complexity && { complexity }),
        ...(started.agentId && { agent: started.agentId }),
      },
    }))
    await debug(
      $,
      started.agentId ?? '-',
      task.comment,
      `started on ${started.model}${complexity ? `, the comment classified ${complexity}` : ''}`,
    )
    return started
  })

  // The agent's thinking (often redacted, then an empty label) and the
  // messages it writes between its tool calls.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (!e.agentId || e.message.type !== 'assistant') return stored
    const binding = await bindingOf($, e.agentId)
    const project = binding && (await projectOf($, e.agentId, binding))
    if (!binding || !project) return stored
    const content: { type?: string; thinking?: string; text?: string }[] = Array.isArray(
      e.message.content,
    )
      ? e.message.content
      : []
    const at = Date.now()
    const steps: Step[] = []
    for (const block of content) {
      if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        steps.push({ at, kind: 'thinking', label: clip(block.thinking ?? '') })
      } else if (block.type === 'text' && block.text?.trim()) {
        steps.push({ at, kind: 'message', label: clip(block.text) })
      }
    }
    await record($, e.agentId, project, binding.comment, steps)
    return stored
  })

  // SubagentStop: a stopped agent holds nothing; resumed for a follow-up, it
  // claims its comment again.
  on('turn.complete', async ($, e, next) => {
    void rearm($)
    const binding = e.agentId ? await bindingOf($, e.agentId) : undefined
    if (e.agentId && binding) {
      const project = await projectOf($, e.agentId, binding)
      const released = project ? await releaseAll($, project, binding.comment) : []
      await setBinding($, e.agentId, undefined)
      await debug(
        $,
        e.agentId,
        binding.comment,
        `turn ended: unbound, released ${released.length} lock(s)`,
      )
    }
    if (e.agentId) await workerDone($, e.agentId, e.answer)
    return next(e)
  })
}
