#!/usr/bin/env node
// server.mjs --project <dir>
// Serves the widget and its API to the project's dev app, and prints one line
// per comment needing attention (the plugin's hooks read them and dispatch):
// OPEN (backlog at start), NEW, FOLLOWUP, EDIT, ASKED, ANSWERED, RESOLVED, CANCELLED,
// DELETED.
// It watches the comments file's folder and the step files' folder, and pushes
// `changed` to the widgets on /api/events: they reload only then.
// Only runs while a session watches (/code-buddy): no server, no widget.
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
import { errorCode } from './lib/errors.mjs'
import {
  CONTENT_TYPES,
  IMAGE_NAME,
  ImageRefusal,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  imagesDir,
  parseImages,
} from './lib/images.mjs'
import { openingOf, sentKey } from './lib/format.mjs'
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

/** @param {string | undefined} origin */
const isAllowed = (origin) =>
  !!origin && (LOCAL_ORIGIN.test(origin) || allowedOrigins.has(origin))

function corsHeaders(origin) {
  if (!isAllowed(origin)) return {}
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
  403: 'origin not allowed',
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

/** The most a request's text may hold, its images aside. */
const MAX_TEXT = 100_000
/** The most a request may hold: its text, and its images in base64. */
const MAX_BODY = MAX_TEXT + Math.ceil(MAX_IMAGE_BYTES / 3) * 4 * MAX_IMAGES

async function readJson(req) {
  if (Number(req.headers['content-length']) > MAX_BODY) throw new ClientError(413)
  // Decoded as a whole: a character split between two chunks stays one.
  req.setEncoding('utf8')
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > MAX_BODY) throw new ClientError(413)
  }
  let input
  try {
    input = raw ? JSON.parse(raw) : {}
  } catch {
    throw new ClientError(400)
  }
  // Only images may take the room above the text's.
  const { images: _, ...text } = input ?? {}
  if (JSON.stringify(text).length > MAX_TEXT) throw new ClientError(413)
  return input
}

/**
 * @typedef {import('./lib/format.mjs').AreaNode} AreaNode
 * @typedef {import('./lib/format.mjs').Box} Box
 * @typedef {import('./lib/format.mjs').Area} Area
 */

/** The most elements an area records as covered, and as crossed, as the widget caps them. */
const MAX_COVERS = 10
const MAX_CROSSES = 6
/** The text an area's element keeps, as the widget cuts it. */
const AREA_TEXT = 80
const MAX_SELECTOR = 500

/**
 * An element the reader pointed at, or that a drawn area lies in, covers or
 * crosses. The tag is normalised too: a line break in it would split the
 * hooks' line.
 * @param {any} node
 * @param {number} textLength
 * @returns {AreaNode | undefined}
 */
function sanitiseNode(node, textLength) {
  if (!node || typeof node.selector !== 'string') return undefined
  return {
    selector: node.selector.slice(0, MAX_SELECTOR),
    tag: normaliseQuote(String(node.tag ?? '')).slice(0, 20),
    text: normaliseQuote(String(node.text ?? '')).slice(0, textLength),
  }
}

/** @param {any} element */
function sanitiseElement(element) {
  const node = sanitiseNode(element, 200)
  return (
    node && {
      ...node,
      html: redactHtml(normaliseQuote(String(element.html ?? '')).slice(0, 600)),
    }
  )
}

/** A name that may hold a secret: a token, a password, a signature, a nonce. */
const SECRET =
  /token|secret|passw|pwd|csrf|xsrf|nonce|api[-_]?key|session|signature|jwt|credential|authori[sz]ation|bearer|^(?:auth|code|key|otp|sid|sig)$/i

/** @param {string} name A parameter or an attribute, maybe percent-encoded. */
function isSecret(name) {
  try {
    return SECRET.test(decodeURIComponent(name))
  } catch {
    return SECRET.test(name)
  }
}

/**
 * `link` with the values of its secret-looking parameters (after `?`, `&`,
 * `#` or `;`) replaced by `redacted`.
 * @param {string} link
 */
function redactParams(link) {
  return link.replace(/([?&#;])([^=&#;\s]*)=[^&#;\s]*/g, (param, separator, name) =>
    isSecret(name) ? `${separator}${name}=redacted` : param,
  )
}

/** The attributes that hold a link, besides `data-*` ones (`data-src`). */
const LINKS = new Set([
  'href',
  'src',
  'srcset',
  'imagesrcset',
  'action',
  'formaction',
  'poster',
  'ping',
  'xlink:href',
])

/**
 * An element's outer HTML, as the browser writes it (values double-quoted),
 * without what may be a secret: no `value` (a hidden CSRF field's) or
 * `content` (a meta tag's), no secret-looking attribute, and links with their
 * secret-looking parameters redacted. A value the truncation cut is still
 * one.
 * @param {string} html
 */
function redactHtml(html) {
  return html.replace(/<[a-z][^\s/>]*(?:\s+[^\s"'>/=]+(?:="[^"]*"?)?)*/gi, (tag) =>
    tag.replace(
      /\s+([^\s"'>/=]+)(?:="([^"]*)("?))?/g,
      (attribute, name, value, close) => {
        if (
          name === 'value' ||
          name === 'content' ||
          isSecret(name.replace(/^data-/, ''))
        )
          return ''
        return (LINKS.has(name) || name.startsWith('data-')) && value
          ? ` ${name}="${redactParams(value)}${close}`
          : attribute
      },
    ),
  )
}

const MAX_PIXELS = 1_000_000

/**
 * A length, or with `signed` a position: negative on a right-to-left page.
 * @param {unknown} value
 * @param {boolean} [signed]
 */
const pixels = (value, signed = false) =>
  Math.min(Math.max(Math.round(Number(value) || 0), signed ? -MAX_PIXELS : 0), MAX_PIXELS)

/**
 * @param {any} box
 * @returns {Box}
 */
const sanitiseBox = (box) => ({
  top: pixels(box?.top, true),
  left: pixels(box?.left, true),
  width: pixels(box?.width),
  height: pixels(box?.height),
})

/**
 * An element of a drawn area. A selector too long to keep whole is dropped,
 * not cut: cut, it could point at another element, or at none.
 * @param {any} node
 */
const sanitiseAreaNode = (node) =>
  typeof node?.selector === 'string' && node.selector.length <= MAX_SELECTOR
    ? sanitiseNode(node, AREA_TEXT)
    : undefined

/**
 * @param {unknown} list
 * @param {number} max
 * @returns {AreaNode[]}
 */
const sanitiseNodes = (list, max) =>
  (Array.isArray(list) ? list : []).slice(0, max).flatMap((node) => {
    const sanitised = sanitiseAreaNode(node)
    return sanitised ? [sanitised] : []
  })

/**
 * A rectangle the reader drew over the page; one with no surface is none.
 * Its holder (`within`) is kept only with where the area lies in it and a
 * size to scale it by.
 * @param {any} area
 * @returns {Area | undefined}
 */
function sanitiseArea(area) {
  if (!area || typeof area !== 'object') return undefined
  const box = sanitiseBox(area)
  if (!box.width || !box.height) return undefined
  const within = sanitiseAreaNode(area.within)
  const { offset, size } = area.within ?? {}
  const holder = { width: pixels(size?.width), height: pixels(size?.height) }
  const covers = Array.isArray(area.covers) ? area.covers : []
  const crosses = Array.isArray(area.crosses) ? area.crosses : []
  const truncated =
    area.truncated === true || covers.length > MAX_COVERS || crosses.length > MAX_CROSSES
  return {
    ...box,
    viewport: {
      width: pixels(area.viewport?.width),
      height: pixels(area.viewport?.height),
      scrollX: pixels(area.viewport?.scrollX, true),
      scrollY: pixels(area.viewport?.scrollY, true),
    },
    ...(within && offset && typeof offset === 'object' && holder.width && holder.height
      ? {
          within: {
            ...within,
            offset: { top: pixels(offset.top, true), left: pixels(offset.left, true) },
            size: holder,
          },
        }
      : {}),
    covers: sanitiseNodes(covers, MAX_COVERS),
    crosses: sanitiseNodes(crosses, MAX_CROSSES),
    ...(truncated ? { truncated: true } : {}),
  }
}

/**
 * The page of a new comment, when it is one: an http or https URL, as the
 * parser writes it, up to 2000 characters, without its credentials or hash
 * and with its secret-looking parameters redacted, in its query or its path
 * (`;jsessionid=…`). Anything else is dropped, and the comment keeps its route.
 * @param {unknown} url
 */
function sanitiseUrl(url) {
  const parsed = typeof url === 'string' ? URL.parse(url.slice(0, 2000)) : null
  if (!parsed || !/^https?:$/.test(parsed.protocol)) return undefined
  // Segment by segment: a value in the path ends at its `/`.
  const pathname = parsed.pathname.split('/').map(redactParams).join('/')
  return `${parsed.origin}${pathname}${redactParams(parsed.search)}`.slice(0, 2000)
}

/** The anchor of a new comment: where on the page it is. */
function sanitiseAnchor(anchor = {}) {
  const element = sanitiseElement(anchor.element)
  const area = sanitiseArea(anchor.area)
  return {
    section: String(anchor.section ?? '')
      .trim()
      .slice(0, 300),
    quote: normaliseQuote(String(anchor.quote ?? '')).slice(0, 2000),
    occurrence: Math.max(0, Math.floor(Number(anchor.occurrence) || 0)),
    ...(element ? { element } : {}),
    ...(area ? { area } : {}),
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
  // With the reader's reply, the store files them under it: with words or
  // options, or alone when no other move comes with them.
  const anotherMove = patch.status || patch.cancelled !== undefined
  if (patch.followUp || patch.choices || !anotherMove) {
    const images = parseImages(input.images)
    if (images.length) patch.images = images
  }
  // Passed even empty: the store then clears the words of a message that has
  // images, which goes again with them alone.
  if (typeof input.text === 'string') patch.text = input.text.trim()
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
 * agents, its instructions (`agents/<name>.md`; a comment's agent,
 * `code-buddy:cb-<id>`, has the worker's). Claude Code keeps only the
 * message: the file is read as it is now, which a change since the agent
 * started makes differ.
 * @param {string} id
 */
async function agentContext(id) {
  const agent = await findAgentPrompt(id)
  if (!agent) return undefined
  const type = (agent.agentType ?? '').replace(
    /^code-buddy:cb-[\w-]+$/,
    'code-buddy:worker',
  )
  const name = /^code-buddy:([\w-]+)$/.exec(type)?.[1]
  const file = name && `agents/${name}.md`
  const text =
    file && (await readFile(path.join(PLUGIN_ROOT, file), 'utf8').catch(() => ''))
  return { ...agent, ...(file && text ? { instructions: { file, text } } : {}) }
}

async function handle(req, res) {
  const cors = corsHeaders(req.headers.origin)
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'OPTIONS') return send(res, 204, undefined, cors)
  // A page of another site may send a request it cannot read the answer of:
  // it would write comments and images, and start agents.
  const { origin } = req.headers
  if (req.method !== 'GET' && origin && !isAllowed(origin)) throw new ClientError(403)

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

  // An image a reader attached, as the store wrote it.
  const [, imageOf, image] = /^\/api\/images\/([\w-]+)\/([^/]+)$/.exec(url.pathname) ?? []
  if (req.method === 'GET' && imageOf && image) {
    if (!IMAGE_NAME.test(image)) return send(res, 404, { error: 'not found' }, cors)
    const file = path.join(imagesDir(project, imageOf), image)
    // Missing, it is not found; anything else is an error, logged.
    const data = await readFile(file).catch((error) => {
      if (errorCode(error) === 'ENOENT') return undefined
      throw error
    })
    if (!data) return send(res, 404, { error: 'not found' }, cors)
    res.writeHead(200, {
      ...cors,
      'content-type': CONTENT_TYPES[path.extname(image).slice(1)],
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      // A name is never written twice: a deleted comment's id is not reused.
      'cache-control': 'private, max-age=86400, immutable',
    })
    return res.end(data)
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
  // hooks wrote. A released widget has no panel, and this answers 404.
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
      return send(res, 200, history ? comments.map(withLines) : comments, cors)
    }
    if (req.method === 'POST') {
      const input = await readJson(req)
      const body = typeof input.body === 'string' ? input.body.trim() : ''
      // An image alone says enough, as in a prompt to Claude.
      const images = parseImages(input.images)
      if (typeof input.route !== 'string' || !input.route || (!body && !images.length)) {
        return send(
          res,
          400,
          { error: 'route and a body or an image are required' },
          cors,
        )
      }
      const comment = await store.create({
        route: input.route.slice(0, 500),
        url: sanitiseUrl(input.url),
        body,
        images,
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
 * `open` event) and its latest reader message, as `<id> <body>`.
 * @type {Map<string, { opened: number, text: string }>}
 */
const seen = new Map()

/** The most lines kept per comment for the debug panel. */
const LINES_KEPT = 50

/**
 * By comment id, the lines printed about it for the hooks, oldest first:
 * what an agent should have been sent, for the debug panel.
 * @type {Map<string, { at: string, line: string }[]>}
 */
const printed = new Map()

/**
 * Prints `line` about comment `id` for the hooks, and keeps it.
 * @param {string} id
 * @param {string} line
 */
function print(id, line) {
  // One event a line: a line break in what the reader sent (a route, a tag)
  // would forge another event for the hooks.
  line = line.replaceAll(/[\r\n\u2028\u2029]/g, ' ')
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
 * hooks read one event per line; a reader's line break used to split one.
 * @param {string} text
 */
const quoted = (text) => JSON.stringify(text)

/** @param {{ tag: string, text: string }} node */
const nodeLabel = (node) => `<${node.tag}> ${node.text.slice(0, 40)}`.trim()

/**
 * Where the area is and what it holds, on the hooks' line: its size and corner
 * on the page, the element it lies in, those it covers or crosses, and
 * `truncated` when it held more than these lists keep.
 * @param {Area} area
 */
function describeArea(area) {
  const within = area.within ? ` within=${quoted(nodeLabel(area.within))}` : ''
  /** @param {AreaNode[]} list */
  const nodes = (list) => JSON.stringify(list.map(nodeLabel))
  const truncated = area.truncated ? ' truncated' : ''
  return `area=${area.width}x${area.height}@${area.left},${area.top}${within} covers=${nodes(area.covers)} crosses=${nodes(area.crosses)}${truncated}`
}

function describe(comment) {
  const { element, area, quote, section: heading } = comment.anchor
  const where = element
    ? `element=<${element.tag}> ${quoted(element.text.slice(0, 80))}`
    : area
      ? describeArea(area)
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
  // The images of that message, as files the agent opens with Read.
  const attached = (reply ?? comment.messages[0])?.images ?? []
  const images = attached.length
    ? ` images=${JSON.stringify(attached.map((name) => path.join(imagesDir(project, comment.id), name)))}`
    : ''
  return `${comment.id} route=${comment.route}${url}${section} ${where} ${text}${images}`
}

/**
 * The opening line of a comment, `sent=` naming the reader's message it hands
 * over (format.mjs's sentKey): the hooks act once on each. With that key.
 * @param {string} kind
 * @param {Comments[number]} comment
 */
function openingLine(kind, comment) {
  const message = openingOf(comment)
  const key = message ? sentKey(message) : undefined
  // describe() starts with the id: the key goes right after it.
  const rest = describe(comment).slice(comment.id.length)
  return { key, line: `${kind} ${comment.id}${key ? ` sent=${key}` : ''}${rest}` }
}

/** @typedef {Awaited<ReturnType<typeof store.readAll>>} Comments */

/**
 * Prints the lines for the hooks about what changed in `comments` since the
 * last read.
 * @param {Comments} comments
 * @param {boolean} first
 * @returns {[string, string][]} The comments handed over, by id, with the key
 *   of the message: the store dates the hand-over.
 */
function tick(comments, first) {
  /** @type {[string, string][]} */
  const handed = []
  const current = new Set()
  for (const comment of comments) {
    if (!isActive(comment)) continue
    current.add(comment.id)
    const latest = comment.messages.findLast((message) => message.author === 'reader')
    const text = `${latest?.id} ${latest?.body}`
    const opened = comment.events.findLastIndex((event) => event.state === 'open')
    const previous = seen.get(comment.id)
    // Stopped, asked or resolved, then opened again between two reads: the
    // hooks hear both, as if they had seen each.
    if (previous && previous.opened !== opened) {
      print(comment.id, goneLine(comment.id, comment.events[opened - 1]?.state))
    }
    if (previous === undefined || previous.opened !== opened) {
      const kind = latestReply(comment) ? 'FOLLOWUP' : first ? 'OPEN' : 'NEW'
      const { key, line } = openingLine(kind, comment)
      print(comment.id, line)
      if (key) handed.push([comment.id, key])
    } else if (previous.text !== text) {
      print(comment.id, `EDIT ${describe(comment)}`)
    }
    seen.set(comment.id, { opened, text })
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
  return handed
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
 * Reads the comments: prints the hooks' lines, and tells the widgets which
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
  // Dated in the file: its write brings the next read, which prints nothing new.
  for (const [id, key] of tick(comments, first)) {
    await store.notify(id, key).catch((error) => {
      console.error(`code-buddy server: could not date the hand-over of ${id}: ${error}`)
      // Printed again at the next read, which dates it: the hooks take a message once.
      seen.delete(id)
    })
  }
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
    // An image the server does not take: its own words, for the reader too.
    if (error instanceof ImageRefusal) {
      send(res, 422, { error: error.message }, cors)
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

// A comments file this version does not read: /code-buddy says what to do.
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
