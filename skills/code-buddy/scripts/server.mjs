#!/usr/bin/env node
// server.mjs --project <dir>
// Serves the widget and its API to the project's dev app, and prints one line
// per comment needing attention (the manager reads them through Monitor):
// OPEN (backlog at start), NEW, FOLLOWUP, EDIT, ASKED, ANSWERED, RESOLVED, CANCELLED,
// DELETED.
// It watches the comments file's folder and the step files' folder, and pushes
// `changed` to the widgets on /api/events: they reload only then.
// Only runs while /code-buddy is active: no server, no widget.
import { existsSync, statSync, watch } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import {
  SKILL_DIR,
  WIDGET_VERSION,
  findProject,
  isDevWidget,
  servedProject,
} from './lib/project.mjs'
import { AGENT_ID, TOOL_ID, findAgentPrompt, findToolCall } from './lib/transcripts.mjs'
import {
  APP_ROUTE,
  MAX_OPTIONS,
  StoreRefusal,
  createStore,
  isActive,
  normaliseQuote,
  progressPath,
  stepFiles,
} from './lib/store.mjs'

const found = findProject()
if (!found) {
  console.error('no .code-buddy.json found; run /code-buddy:code-buddy init first')
  process.exit(2)
}
const project = found
// The plugin's hooks (a Claude Code mod) set it in the session that starts the
// server. Without them agents would edit with no locks and show no progress.
if (!process.env.CODE_BUDDY_HOOKS) {
  console.log(
    "HOOKS_MISSING Code Buddy's hooks did not load: they need Claude Code 2.1.287 or later",
  )
  process.exit(2)
}
const { config } = project
const port = Number(process.env.CODE_BUDDY_PORT ?? config.port ?? 4599)
// The re-read behind the folder watches, for the mounts whose writes they miss
// (some Docker, network or WSL ones).
const pollMs = Number(process.env.CODE_BUDDY_POLL_MS ?? 5000)
const store = createStore(project)
const WIDGET = path.join(SKILL_DIR, 'widget', 'dist', 'widget.js')
// Releases ship the built widget; a clone of the repository builds it first.
if (!existsSync(WIDGET)) {
  const root = path.resolve(SKILL_DIR, '..', '..')
  console.log(`WIDGET_MISSING run \`npm ci && npm run build\` in ${root}`)
  process.exit(2)
}

const LOCAL_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost)(:\d+)?$/
const allowedOrigins = new Set(config.devOrigins ?? [])

function corsHeaders(origin) {
  if (!origin || !(LOCAL_ORIGIN.test(origin) || allowedOrigins.has(origin))) {
    return {}
  }
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-private-network': 'true',
    vary: 'origin',
  }
}

function send(res, status, body, headers = {}) {
  const json = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, {
    ...headers,
    ...(json && { 'content-type': 'application/json' }),
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  })
  res.end(json)
}

/** What the server answers to a request the client got wrong, by status. */
const CLIENT_ERRORS = /** @type {const} */ ({
  400: 'invalid JSON',
  413: 'body too large',
})

/**
 * A request the client got wrong. The response takes its text from
 * CLIENT_ERRORS, never from the exception: no exception text reaches a client.
 */
class ClientError extends Error {
  /** @param {keyof typeof CLIENT_ERRORS} status */
  constructor(status) {
    super(CLIENT_ERRORS[status])
    this.status = status
  }
}

async function readJson(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 100_000) throw new ClientError(413)
  }
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    throw new ClientError(400)
  }
}

function sanitiseElement(element) {
  if (!element || typeof element.selector !== 'string') return undefined
  return {
    selector: element.selector.slice(0, 500),
    tag: String(element.tag ?? '').slice(0, 20),
    text: normaliseQuote(String(element.text ?? '')).slice(0, 200),
    html: normaliseQuote(String(element.html ?? '')).slice(0, 600),
  }
}

/** The anchor of a new comment: where on the page it is. */
function sanitiseAnchor(anchor = {}) {
  const element = sanitiseElement(anchor.element)
  return {
    section: String(anchor.section ?? '')
      .trim()
      .slice(0, 300),
    quote: normaliseQuote(String(anchor.quote ?? '')).slice(0, 2000),
    occurrence: Math.max(0, Math.floor(Number(anchor.occurrence) || 0)),
    ...(element ? { element } : {}),
  }
}

/** @returns {Parameters<typeof store.update>[1]} */
function sanitisePatch(input) {
  /** @type {Parameters<typeof store.update>[1]} */
  const patch = {}
  if (input.status === 'resolved') patch.status = input.status
  if (typeof input.cancelled === 'boolean') patch.cancelled = input.cancelled
  if (typeof input.followUp === 'string' && input.followUp.trim()) {
    patch.followUp = input.followUp.trim()
  }
  // The options the reader chose; the store keeps only those Claude offered.
  if (Array.isArray(input.choices)) {
    patch.choices = input.choices
      .filter((choice) => typeof choice === 'string')
      .slice(0, MAX_OPTIONS)
  }
  if (typeof input.text === 'string' && input.text.trim()) {
    patch.text = input.text.trim()
  }
  return patch
}

/**
 * What the debug panel reads in the transcripts, by kind: the id's pattern
 * and its finder.
 * @type {Record<string, [RegExp, (id: string) => Promise<object | undefined>]>}
 */
const DEBUG_FINDERS = {
  tool: [TOOL_ID, findToolCall],
  agent: [AGENT_ID, agentContext],
}

/** This plugin's root, whose `agents/` holds its agents' instructions. */
const PLUGIN_ROOT = path.resolve(SKILL_DIR, '..', '..')

/**
 * What agent `id` was given: its first message, and for one of the plugin's
 * agents, its instructions (`agents/<name>.md`). Claude Code keeps only the
 * message: the file is read as it is now, which a change since the agent
 * started makes differ.
 * @param {string} id
 */
async function agentContext(id) {
  const agent = await findAgentPrompt(id)
  if (!agent) return undefined
  const name = /^code-buddy:([\w-]+)$/.exec(agent.agentType ?? '')?.[1]
  const file = name && `agents/${name}.md`
  const text =
    file && (await readFile(path.join(PLUGIN_ROOT, file), 'utf8').catch(() => ''))
  return { ...agent, ...(file && text ? { instructions: { file, text } } : {}) }
}

async function handle(req, res) {
  const cors = corsHeaders(req.headers.origin)
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'OPTIONS') return send(res, 204, undefined, cors)

  if (req.method === 'GET' && url.pathname === '/widget.js') {
    const source = await readFile(WIDGET, 'utf8')
    res.writeHead(200, {
      ...cors,
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    })
    return res.end(source)
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    return listen(req, res, cors)
  }

  if (url.pathname === '/api/health') {
    return send(
      res,
      200,
      { project: project.root, name: config.name, version: WIDGET_VERSION },
      cors,
    )
  }

  // The dev widget's debug panel, from Claude Code's transcripts: a tool call
  // and its result, or the first message an agent received, the prompt the
  // manager wrote. A released widget has no panel, and this answers 404.
  const [, kind, id] = /^\/api\/debug\/(tool|agent)\/([^/]+)$/.exec(url.pathname) ?? []
  if (req.method === 'GET' && kind && id) {
    const [pattern, find] = DEBUG_FINDERS[kind]
    if (!isDevWidget(WIDGET) || !pattern.test(id)) {
      return send(res, 404, { error: 'not found' }, cors)
    }
    const read = await find(id)
    return read
      ? send(res, 200, read, cors)
      : send(res, 404, { error: 'not in the recent transcripts' }, cors)
  }

  // The dev widget's debug panel: a comment's step files as they are on disk,
  // to read in a tab of their own.
  const steps = /^\/api\/debug\/steps\/([^/]+)$/.exec(url.pathname)?.[1]
  if (req.method === 'GET' && steps !== undefined) {
    if (!isDevWidget(WIDGET) || !/^[\w-]+$/.test(steps)) {
      return send(res, 404, { error: 'not found' }, cors)
    }
    res.writeHead(200, {
      ...cors,
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    })
    return res.end(await stepFiles(project, steps))
  }

  if (url.pathname === '/api/comments') {
    if (req.method === 'GET') {
      const route =
        url.searchParams.get('all') === '1' ? undefined : url.searchParams.get('route')
      if (route === null || route === '') {
        return send(res, 400, { error: 'route or all=1 is required' }, cors)
      }
      // history=1: every step of every run, for the widget's debug panel.
      const history = url.searchParams.get('history') === '1'
      const comments = await store.list(route ?? undefined, { history })
      const served = comments.map(withNotified)
      return send(res, 200, history ? served.map(withLines) : served, cors)
    }
    if (req.method === 'POST') {
      const input = await readJson(req)
      const body = input.body?.trim()
      if (typeof input.route !== 'string' || !input.route || !body) {
        return send(res, 400, { error: 'route and body are required' }, cors)
      }
      const comment = await store.create({
        route: input.route.slice(0, 500),
        url: typeof input.url === 'string' ? input.url.slice(0, 2000) : undefined,
        body,
        anchor: sanitiseAnchor(
          typeof input.anchor === 'object' && input.anchor ? input.anchor : {},
        ),
      })
      return send(res, 201, comment, cors)
    }
  }

  const match = url.pathname.match(/^\/api\/comments\/([\w-]+)$/)
  if (match) {
    if (req.method === 'PATCH') {
      const comment = await store.update(match[1], sanitisePatch(await readJson(req)))
      return comment
        ? send(res, 200, comment, cors)
        : send(res, 404, { error: 'not found' }, cors)
    }
    if (req.method === 'DELETE') {
      return (await store.remove(match[1]))
        ? send(res, 204, undefined, cors)
        : send(res, 404, { error: 'not found' }, cors)
    }
  }

  return send(res, 404, { error: 'not found' }, cors)
}

/**
 * By comment id, when last seen active: when it last opened (its latest
 * `open` event), its latest reader message, as `<id> <body>`, and when the
 * manager was sent the line for that opening.
 * @type {Map<string, { opened: number, text: string, notified: string }>}
 */
const seen = new Map()

/**
 * An open comment with `notifiedAt`, once the manager was sent its line: the
 * widget tells a manager slow to start it (busy with another turn) from one
 * not told yet. Never stored in the file.
 * @template {{ id: string, state: string, events: { state: string }[] }} T
 * @param {T} comment
 * @returns {T & { notifiedAt?: string }}
 */
function withNotified(comment) {
  const known = seen.get(comment.id)
  const opened = comment.events.findLastIndex((event) => event.state === 'open')
  return comment.state === 'open' && known?.opened === opened
    ? { ...comment, notifiedAt: known.notified }
    : comment
}

/** The most lines kept per comment for the debug panel. */
const LINES_KEPT = 50

/**
 * By comment id, the lines printed about it for the manager, oldest first:
 * what an agent should have been sent, for the debug panel.
 * @type {Map<string, { at: string, line: string }[]>}
 */
const printed = new Map()

/**
 * Prints `line` about comment `id` for the manager, and keeps it.
 * @param {string} id
 * @param {string} line
 */
function print(id, line) {
  console.log(line)
  const lines = [...(printed.get(id) ?? []), { at: new Date().toISOString(), line }]
  printed.set(id, lines.slice(-LINES_KEPT))
}

/**
 * A comment with `lines`, the lines printed about it since the server
 * started, when there are any. Never stored in the file.
 * @template {{ id: string }} T
 * @param {T} comment
 * @returns {T & { lines?: { at: string, line: string }[] }}
 */
function withLines(comment) {
  const lines = printed.get(comment.id)
  return lines ? { ...comment, lines } : comment
}

/** The line for a comment that is no longer active, by where it went. */
const goneLine = (id, state) =>
  state === 'asking'
    ? `ASKED ${id}`
    : state === 'answered'
      ? `ANSWERED ${id}`
      : state === 'resolved'
        ? `RESOLVED ${id}`
        : `CANCELLED ${id}`

/** The reader's latest message after their comment, when the thread ends on it. */
function latestReply(comment) {
  const last = comment.messages.at(-1)
  return comment.messages.length > 1 && last?.author === 'reader' ? last : undefined
}

/**
 * A text as a JSON string: quoted, its quotes and line breaks escaped. The
 * manager reads one event per line; a reader's line break used to split one.
 * @param {string} text
 */
const quoted = (text) => JSON.stringify(text)

function describe(comment) {
  const { element, quote, section: heading } = comment.anchor
  const where = element
    ? `element=<${element.tag}> ${quoted(element.text.slice(0, 80))}`
    : quote
      ? `quote=${quoted(quote.slice(0, 120))}`
      : comment.route === APP_ROUTE
        ? 'app-level'
        : 'page-level'
  const section = heading ? ` section=${quoted(heading)}` : ''
  const url = comment.url ? ` url=${comment.url}` : ''
  const reply = latestReply(comment)
  // The options the reader chose, apart: a label may hold the ", " that joins them in the text.
  const choices = reply?.choices ? ` choices=${JSON.stringify(reply.choices)}` : ''
  const text = reply
    ? `followup=${quoted(reply.body)}${choices} messages=${comment.messages.length}`
    : `body=${quoted(comment.messages[0]?.body ?? '')}`
  return `${comment.id} route=${comment.route}${url}${section} ${where} ${text}`
}

/** @typedef {Awaited<ReturnType<typeof store.readAll>>} Comments */

/**
 * Prints the lines for the manager about what changed in `comments` since the
 * last read.
 * @param {Comments} comments
 * @param {boolean} first
 */
function tick(comments, first) {
  const current = new Set()
  for (const comment of comments) {
    if (!isActive(comment)) continue
    current.add(comment.id)
    const latest = comment.messages.findLast((message) => message.author === 'reader')
    const text = `${latest?.id} ${latest?.body}`
    const opened = comment.events.findLastIndex((event) => event.state === 'open')
    const previous = seen.get(comment.id)
    // Stopped, asked or resolved, then opened again between two reads: the
    // manager hears both, as if it had seen each.
    if (previous && previous.opened !== opened) {
      print(comment.id, goneLine(comment.id, comment.events[opened - 1]?.state))
    }
    let notified = previous?.notified ?? ''
    if (previous === undefined || previous.opened !== opened) {
      const kind = latestReply(comment) ? 'FOLLOWUP' : first ? 'OPEN' : 'NEW'
      print(comment.id, `${kind} ${describe(comment)}`)
      notified = new Date().toISOString()
    } else if (previous.text !== text) {
      print(comment.id, `EDIT ${describe(comment)}`)
    }
    seen.set(comment.id, { opened, text, notified })
  }
  for (const id of seen.keys()) {
    if (current.has(id)) continue
    const gone = comments.find((comment) => comment.id === id)
    print(id, gone ? goneLine(id, gone.state) : `DELETED ${id}`)
    seen.delete(id)
  }
  // A deleted comment's lines go with it, even one deleted while inactive.
  const ids = new Set(comments.map((comment) => comment.id))
  for (const id of printed.keys()) if (!ids.has(id)) printed.delete(id)
}

/**
 * The widgets listening for changes: one stream per tab.
 * @type {Set<http.ServerResponse>}
 */
const listeners = new Set()

/**
 * Opens a stream of server-sent events: `changed`, with the ids of the
 * comments that changed, each time the comments file or a step file changes.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {ReturnType<typeof corsHeaders>} cors
 */
function listen(req, res, cors) {
  res.writeHead(200, {
    ...cors,
    'content-type': 'text/event-stream',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  })
  // Sent at once: the widget's EventSource opens on the headers.
  res.write(': listening\n\n')
  listeners.add(res)
  req.on('close', () => listeners.delete(res))
}

/**
 * By comment id, what it was at the last read: the comment, and the size and
 * time of its step file.
 * @type {Map<string, string>}
 */
const fingerprints = new Map()

/**
 * The ids of the comments that changed since the last read, the deleted ones
 * included.
 * @param {Comments} comments
 */
async function changedIds(comments) {
  const read = await Promise.all(
    comments.map(async (comment) => {
      const steps = await stat(progressPath(project, comment.id)).then(
        (file) => `${file.size} ${file.mtimeMs}`,
        () => '',
      )
      return /** @type {const} */ ([comment.id, `${JSON.stringify(comment)}\n${steps}`])
    }),
  )
  const next = new Map(read)
  const ids = [
    ...read
      .filter(([id, fingerprint]) => fingerprints.get(id) !== fingerprint)
      .map(([id]) => id),
    ...[...fingerprints.keys()].filter((id) => !next.has(id)),
  ]
  fingerprints.clear()
  for (const [id, fingerprint] of next) fingerprints.set(id, fingerprint)
  return ids
}

/**
 * Reads the comments: prints the manager's lines, and tells the widgets which
 * comments changed.
 * @param {boolean} first
 */
async function refresh(first) {
  let comments
  try {
    comments = await store.readAll()
  } catch {
    return
  }
  tick(comments, first)
  const ids = await changedIds(comments)
  if (first || !ids.length) return
  const event = `event: changed\ndata: ${JSON.stringify({ ids })}\n\n`
  for (const res of listeners) res.write(event)
}

/** @type {Promise<void>} */
let refreshing = Promise.resolve()

/**
 * Refreshes after the refresh under way, never during it: two reads finishing
 * out of order would print a line twice.
 */
const refreshNext = (first = false) =>
  (refreshing = refreshing.then(() => refresh(first)).catch(() => undefined))

/**
 * One write fires several watch events: one refresh for all those of the
 * next 50 ms. Not reset by each: steady writes would put it off.
 */
const BATCH_MS = 50
/** @type {NodeJS.Timeout | undefined} */
let batch

function changeSeen() {
  batch ??= setTimeout(() => {
    batch = undefined
    void refreshNext()
  }, BATCH_MS)
}

/**
 * By folder, its watch and the folder's inode. The folders, not the files:
 * the store writes a temp file and renames it over the comments file, which a
 * watch on the file loses.
 * @type {Map<string, { watcher: import('node:fs').FSWatcher, ino: number }>}
 */
const watchers = new Map()

/** The inode of folder `dir`, or undefined when it is gone. */
const inodeOf = (/** @type {string} */ dir) => {
  try {
    return statSync(dir).ino
  } catch {
    return undefined
  }
}

/**
 * Watches the folders not watched yet. A folder removed, or removed and made
 * again, is watched anew: a watch on the old one hears nothing more.
 */
function watchFolders() {
  for (const dir of [path.dirname(project.commentsFile), project.progressDir]) {
    const ino = inodeOf(dir)
    const known = watchers.get(dir)
    if (known && known.ino === ino) continue
    known?.watcher.close()
    watchers.delete(dir)
    if (ino === undefined) continue
    try {
      const watcher = watch(dir, changeSeen)
      watcher.on('error', () => {
        watcher.close()
        if (watchers.get(dir)?.watcher === watcher) watchers.delete(dir)
      })
      watchers.set(dir, { watcher, ino })
    } catch {}
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    const cors = corsHeaders(req.headers.origin)
    // A move the comment's state forbids, or a comments file in another
    // format: the store's own words, meant for the reader.
    if (error instanceof StoreRefusal) {
      send(res, 409, { error: error.message }, cors)
      return
    }
    if (error instanceof ClientError) {
      // The rest of a body too large is never read: a client reusing the
      // connection would wait on it forever.
      const close = error.status === 413 ? { connection: 'close' } : {}
      send(
        res,
        error.status,
        { error: CLIENT_ERRORS[error.status] },
        { ...cors, ...close },
      )
      return
    }
    // Internal details stay in the server's log, never in a response.
    console.error(
      `code-buddy server: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
    send(res, 500, { error: 'internal error' }, cors)
  })
})

server.on('error', async (/** @type {NodeJS.ErrnoException} */ error) => {
  if (error.code !== 'EADDRINUSE') throw error
  let owner = 'another program'
  try {
    const served = await servedProject(port)
    owner =
      served === project.root
        ? 'another /code-buddy:code-buddy session for this project'
        : `the code-buddy server of ${served}`
  } catch {}
  console.log(`PORT_BUSY ${port} is used by ${owner}`)
  process.exit(3)
})

// A comments file this version does not read: the manager says what to do.
try {
  await store.readAll()
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  console.log(`COMMENTS_REFUSED ${error.message}`)
  process.exit(2)
}

server.listen(port, '127.0.0.1', async () => {
  // Made before the first comment: a folder must be there to be watched.
  await mkdir(path.dirname(project.commentsFile), { recursive: true })
  await mkdir(project.progressDir, { recursive: true })
  console.log(`READY http://127.0.0.1:${port} project=${project.root}`)
  watchFolders()
  await refreshNext(true)
  setInterval(() => {
    watchFolders()
    void refreshNext()
  }, pollMs)
})
