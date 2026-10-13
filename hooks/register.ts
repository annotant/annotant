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
// Loaded once per session, they start no process per tool call. The bindings
// (agent to comment), the locks and the routes live in $.state, so they
// survive a reload of the module and vanish with the session, like the agents
// themselves.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Binding, CommentsFile, Complexity, Lock, Route } from '../types'

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
  const git = await $.process
    .run(['git', '-C', root, 'rev-parse', '--show-toplevel'])
    .catch(() => undefined)
  const top = git?.exitCode === 0 ? normalize(git.stdout.trim()) : ''
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
 * AskUserQuestion would reach the manager's terminal, never the reader, who is
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
  const count = Object.keys(all).length
  $.ui.status(count ? `code-buddy: ${count} agent(s) on comments` : undefined)
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
    const { version } = await $.session.version()
    await debug($, 'main', '-', `hooks loaded in a new session (Claude Code ${version})`)
    return next(e)
  })

  on('command.run', { command: 'code-buddy-debug' }, async ($, e) => ({
    text: await debugCommand($, e.args),
  }))

  on('tool.call', async ($, e, next) => {
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
    return next(e)
  })
}
