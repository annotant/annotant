import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { SCRIPTS, json, run, tempDir, tempProject } from './helpers.mjs'

const WIDGET = path.join(SCRIPTS, '..', 'widget', 'dist', 'widget.js')

let base = ''
let root = ''
let port = 0
/** What the server printed for the manager so far. */
let output = ''
/** @type {import('node:child_process').ChildProcess | undefined} */
let server

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('no TCP port'))
        return
      }
      probe.close(() => resolve(address.port))
    })
  })
}

before(async (t) => {
  if (!existsSync(WIDGET)) throw new Error('build the widget first: npm run build')
  root = await tempProject(t)
  port = await freePort()
  const child = spawn(
    process.execPath,
    [path.join(SCRIPTS, 'server.mjs'), '--project', root],
    {
      env: {
        ...process.env,
        CODE_BUDDY_PORT: String(port),
        CODE_BUDDY_STATE_DIR: await tempDir(t),
        CODE_BUDDY_HOOKS: '1',
        CODE_BUDDY_POLL_MS: '50',
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  server = child
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
      if (output.includes('READY')) resolve(undefined)
    })
    child.on('exit', (code) => reject(new Error(`server exited with ${code}`)))
  })
  base = `http://127.0.0.1:${port}`
})

after(() => server?.kill())

/**
 * The first line starting with `prefix` the server printed after `from`.
 * @param {string} prefix
 * @param {number} from A length of `output`, taken before the request.
 * @returns {Promise<string>}
 */
async function nextLine(prefix, from) {
  for (let waited = 0; waited < 3000; waited += 25) {
    const line = output
      .slice(from)
      .split('\n')
      .find((entry) => entry.startsWith(prefix))
    if (line) return line
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`no line starting with ${prefix}`)
}

/** @param {string} route The first comment listed for that page. */
const firstOn = async (route) =>
  (await json(await fetch(`${base}/api/comments?route=${route}`)))[0]

const post = (body, headers = {}) =>
  fetch(`${base}/api/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })

test('answers the health check with the project it serves', async () => {
  const health = await json(await fetch(`${base}/api/health`))
  assert.equal(health.project, root)
})

test('serves the widget', async () => {
  const response = await fetch(`${base}/widget.js`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /javascript/)
})

test('lets localhost apps in, and no other origin', async () => {
  const local = await fetch(`${base}/api/health`, {
    headers: { origin: 'http://localhost:3000' },
  })
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:3000')
  const other = await fetch(`${base}/api/health`, {
    headers: { origin: 'https://evil.example' },
  })
  assert.equal(other.headers.get('access-control-allow-origin'), null)
})

test('creates a comment and lists it for its page', async () => {
  const created = await post(
    JSON.stringify({
      route: '/about',
      url: 'http://localhost:3000/about',
      body: 'Typo here',
    }),
  )
  assert.equal(created.status, 201)
  const listed = await json(await fetch(`${base}/api/comments?route=%2Fabout`))
  assert.ok(listed.some((c) => c.messages[0].body === 'Typo here' && c.state === 'open'))
})

test("takes the reader's choice among the options Claude asked with", async () => {
  const created = await json(
    await post(JSON.stringify({ route: '/cards', body: 'Rework the cards' })),
  )
  const asking = output.length
  const asked = await run(process.execPath, [
    path.join(SCRIPTS, 'ask.mjs'),
    created.id,
    '--project',
    root,
    'Which layout?',
    '--option',
    'Grid: Cards in a grid',
    '--option',
    'List',
  ])
  assert.equal(asked.code, 0, asked.stderr)
  // The server polls: answered before it sees the question, the reply would be an EDIT.
  await nextLine(`ASKED ${created.id}`, asking)
  const printed = output.length
  const answered = await json(
    await fetch(`${base}/api/comments/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ choices: ['List', 42], followUp: 'Denser' }),
    }),
  )
  // One line for the manager, the line breaks escaped, the choices apart.
  const event = await nextLine(`FOLLOWUP ${created.id} `, printed)
  assert.match(event, / followup="List\\n\\nDenser" choices=\["List"\] messages=3$/)
  assert.deepEqual(answered.messages.at(-1), {
    id: 'm3',
    author: 'reader',
    body: 'List\n\nDenser',
    choices: ['List'],
    at: answered.messages.at(-1).at,
  })
  assert.equal(answered.state, 'open')
})

test('groups the anchor of a new comment, and describes it to the manager', async () => {
  const printed = output.length
  const created = await json(
    await post(
      JSON.stringify({
        route: '/shop',
        body: 'Bigger',
        anchor: {
          section: ' Beans ',
          quote: 'Ethiopia   Guji',
          occurrence: 1.7,
          element: { selector: 'h2', tag: 'h2', text: 'Ethiopia Guji', html: '<h2>' },
        },
      }),
    ),
  )
  assert.deepEqual(created.anchor, {
    section: 'Beans',
    quote: 'Ethiopia Guji',
    occurrence: 1,
    element: { selector: 'h2', tag: 'h2', text: 'Ethiopia Guji', html: '<h2>' },
  })
  const event = await nextLine(`NEW ${created.id} `, printed)
  assert.match(event, / section="Beans" element=<h2> "Ethiopia Guji" body="Bigger"$/)
})

test('says when it sent an open comment to the manager, until an agent claims it', async () => {
  const creating = output.length
  const created = await json(
    await post(JSON.stringify({ route: '/notified', body: 'Hi' })),
  )
  await nextLine(`NEW ${created.id} `, creating)
  const open = await firstOn('/notified')
  assert.ok(open.notifiedAt >= created.createdAt, open.notifiedAt)

  await run(process.execPath, [
    path.join(SCRIPTS, 'claim.mjs'),
    created.id,
    '--project',
    root,
  ])
  assert.equal((await firstOn('/notified')).notifiedAt, undefined)
})

test('refuses a move the comment cannot make with 409, in words for the reader', async () => {
  const creating = output.length
  const created = await json(await post(JSON.stringify({ route: '/', body: 'Hi' })))
  await nextLine(`NEW ${created.id} `, creating)
  const patch = (body) =>
    fetch(`${base}/api/comments/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  // Nothing to follow up while it waits for Claude.
  const refused = await patch({ followUp: 'And red' })
  assert.equal(refused.status, 409)
  assert.deepEqual(await json(refused), { error: `comment ${created.id} is open` })

  const printed = output.length
  assert.equal((await patch({ cancelled: true })).status, 200)
  await nextLine(`CANCELLED ${created.id}`, printed)
  // A double click, or a stop a poll late: nothing changes, and no error.
  assert.equal((await patch({ cancelled: true })).status, 200)
  assert.equal((await patch({ status: 'resolved' })).status, 200)
  const late = await patch({ cancelled: true })
  assert.equal(late.status, 200)
  assert.equal((await json(late)).state, 'resolved')
})

test('tells the manager Claude answered a follow-up, which waits on the reader', async () => {
  const creating = output.length
  const created = await json(await post(JSON.stringify({ route: '/', body: 'Hi' })))
  await nextLine(`NEW ${created.id} `, creating)
  /** @param {string} script @param {string} text */
  const reply = (script, text) =>
    run(process.execPath, [
      path.join(SCRIPTS, script),
      created.id,
      '--project',
      root,
      text,
    ])
  await run(process.execPath, [
    path.join(SCRIPTS, 'claim.mjs'),
    created.id,
    '--project',
    root,
  ])
  let printed = output.length
  assert.equal(
    (await reply('resolve.mjs', 'Done.')).stdout,
    `resolved ${created.id} (/)\n`,
  )
  await nextLine(`RESOLVED ${created.id}`, printed)
  printed = output.length
  await fetch(`${base}/api/comments/${created.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ followUp: 'More' }),
  })
  await nextLine(`FOLLOWUP ${created.id} `, printed)
  await run(process.execPath, [
    path.join(SCRIPTS, 'claim.mjs'),
    created.id,
    '--project',
    root,
  ])
  printed = output.length
  assert.equal(
    (await reply('resolve.mjs', 'More.')).stdout,
    `answered ${created.id} (/)\n`,
  )
  await nextLine(`ANSWERED ${created.id}`, printed)
})

test('tells the manager when the reader resolves a comment themselves', async () => {
  const creating = output.length
  const created = await json(await post(JSON.stringify({ route: '/', body: 'Hi' })))
  await nextLine(`NEW ${created.id} `, creating)
  const printed = output.length
  await fetch(`${base}/api/comments/${created.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'resolved' }),
  })
  await nextLine(`RESOLVED ${created.id}`, printed)
})

test("a released widget's server serves no step files nor agent prompts", async () => {
  assert.equal((await fetch(`${base}/api/debug/steps/c1`)).status, 404)
  assert.equal((await fetch(`${base}/api/debug/agent/a1aaaaaaaa`)).status, 404)
})

test('serves the lines it printed about a comment with its history only', async () => {
  const creating = output.length
  const created = await json(await post(JSON.stringify({ route: '/lines', body: 'Hi' })))
  const line = await nextLine(`NEW ${created.id} `, creating)
  assert.equal((await firstOn('/lines')).lines, undefined)

  const listed = await json(await fetch(`${base}/api/comments?route=/lines&history=1`))
  assert.deepEqual(
    listed[0].lines.map((/** @type {{ line: string }} */ entry) => entry.line),
    [line],
  )
  assert.ok(listed[0].lines[0].at >= created.createdAt)
})

test('rejects malformed JSON with 400, and never echoes an exception', async () => {
  const response = await post('{not json')
  assert.equal(response.status, 400)
  assert.deepEqual(await json(response), { error: 'invalid JSON' })
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
})

test('rejects an oversized body with 413, closing the connection', async () => {
  const response = await post(JSON.stringify({ body: 'x'.repeat(200_000) }))
  assert.equal(response.status, 413)
  assert.deepEqual(await json(response), { error: 'body too large' })
  // Its body is left unread: a request reusing the connection would hang.
  assert.equal(response.headers.get('connection'), 'close')
})

test('answers an internal error with a fixed message', async () => {
  await mkdir(path.join(root, '.code-buddy'), { recursive: true })
  await writeFile(path.join(root, '.code-buddy', 'comments.json'), '{corrupt')
  const response = await fetch(`${base}/api/comments?route=%2F`)
  assert.equal(response.status, 500)
  assert.deepEqual(await json(response), { error: 'internal error' })
  await writeFile(
    path.join(root, '.code-buddy', 'comments.json'),
    JSON.stringify({ version: 2, comments: [] }),
  )
})

test('refuses to start on a comments file in the old format', async (t) => {
  const old = await tempProject(t)
  await mkdir(path.join(old, '.code-buddy'), { recursive: true })
  await writeFile(path.join(old, '.code-buddy', 'comments.json'), '[]')
  const started = await run(
    process.execPath,
    [path.join(SCRIPTS, 'server.mjs'), '--project', old],
    {
      env: {
        CODE_BUDDY_PORT: String(await freePort()),
        CODE_BUDDY_HOOKS: '1',
        CODE_BUDDY_STATE_DIR: await tempDir(t),
      },
    },
  )
  assert.equal(started.code, 2)
  assert.match(
    started.stdout,
    /^COMMENTS_REFUSED old comments format: delete .*\.code-buddy\/comments\.json$/m,
  )
})

test('a second server for the same project reports the port as busy', async () => {
  const second = await run(
    process.execPath,
    [path.join(SCRIPTS, 'server.mjs'), '--project', root],
    {
      env: { CODE_BUDDY_PORT: String(port), CODE_BUDDY_HOOKS: '1' },
    },
  )
  assert.equal(second.code, 3)
  assert.match(second.stdout, /PORT_BUSY .* another .* session for this project/)
})

test("refuses to start when Claude Code did not load the plugin's hooks", async () => {
  const started = await run(
    process.execPath,
    [path.join(SCRIPTS, 'server.mjs'), '--project', root],
    { env: { CODE_BUDDY_PORT: String(await freePort()), CODE_BUDDY_HOOKS: '' } },
  )
  assert.equal(started.code, 2)
  assert.match(started.stdout, /^HOOKS_MISSING .*Claude Code 2\.1\.287 or later/m)
})
