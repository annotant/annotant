import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { SCRIPTS, json, run, tempDir, tempProject } from './helpers.mjs'

const WIDGET = path.join(SCRIPTS, '..', 'widget', 'dist', 'widget.js')

let base = ''
let root = ''
/** The server's state folder, where its step files are. */
let state = ''
let port = 0
/** What the server printed for the hooks so far. */
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
        CODE_BUDDY_STATE_DIR: (state = await tempDir(t)),
        CODE_BUDDY_HOOKS: '1',
        // Never during a test: the server sees every change through its watches.
        CODE_BUDDY_POLL_MS: '600000',
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

/** @param {string} url The url stored for a comment posted with it. */
const stored = async (url) =>
  (await json(await post(JSON.stringify({ route: '/about', url, body: 'Odd url' })))).url

/** @param {string} snapshot The element's html, as the widget sends it. */
const storedHtml = async (snapshot) => {
  const element = { selector: 'form', tag: 'form', text: '', html: snapshot }
  const body = JSON.stringify({ route: '/reset', body: 'Secrets', anchor: { element } })
  return (await json(await post(body))).anchor.element.html
}

/**
 * Listens to the server's events, as a widget does.
 * @param {Record<string, string>} [headers]
 */
async function listen(headers = {}) {
  const controller = new AbortController()
  const response = await fetch(`${base}/api/events`, {
    headers,
    signal: controller.signal,
  })
  if (!response.body) throw new Error('no event stream')
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let received = ''
  return {
    response,
    /**
     * The next `changed` event naming comment `id`, within 3 s.
     * @param {string} id
     */
    async changed(id) {
      const deadline = setTimeout(() => controller.abort(), 3000)
      try {
        return await nextEvent(id)
      } catch (error) {
        throw controller.signal.aborted ? new Error(`no changed event for ${id}`) : error
      } finally {
        clearTimeout(deadline)
      }
    },
    close: () => controller.abort(),
  }

  /** @param {string} id */
  async function nextEvent(id) {
    for (;;) {
      const events = received.split('\n\n')
      received = events.pop() ?? ''
      for (const event of events) {
        const data = /^event: changed\ndata: (.*)$/m.exec(event)?.[1]
        if (data && JSON.parse(data).ids.includes(id)) return event
      }
      const { value, done } = await reader.read()
      if (done) throw new Error(`no changed event for ${id}`)
      received += value
    }
  }
}

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

test('keeps only http and https urls, as the parser writes them', async () => {
  for (const url of ['x', 'javascript:alert(1)', '/about']) {
    assert.equal(await stored(url), undefined, url)
  }
  assert.equal(await stored('http://localhost:3000/a\nb'), 'http://localhost:3000/ab')
  const long = `http://localhost:3000/?q=${'a'.repeat(3000)}`
  assert.equal(await stored(long), long.slice(0, 2000))
})

test('keeps no secret of the page in its url', async () => {
  assert.equal(
    await stored('http://localhost:3000/callback#access_token=abc&token_type=bearer'),
    'http://localhost:3000/callback',
  )
  assert.equal(
    await stored(
      'http://user:pass@localhost:3000/reset?token=abc&tab=2&API_KEY=k&code=c',
    ),
    'http://localhost:3000/reset?token=redacted&tab=2&API_KEY=redacted&code=redacted',
  )
  assert.equal(
    await stored('http://localhost:3000/?access%5Ftoken=abc;sig=def'),
    'http://localhost:3000/?access%5Ftoken=redacted;sig=redacted',
  )
  assert.equal(
    await stored(
      'http://localhost:3000/a;jsessionid=abc/b?Authorization=Bearer%20x&sid=s',
    ),
    'http://localhost:3000/a;jsessionid=redacted/b?Authorization=redacted&sid=redacted',
  )
  // A name that does not decode is tested as written.
  assert.equal(
    await stored('http://localhost:3000/?%E0token=abc'),
    'http://localhost:3000/?%E0token=redacted',
  )
})

test('keeps no secret of the page in the html of an element', async () => {
  assert.equal(
    await storedHtml(
      '<form data-testid="reset" data-csrf-token="abc" nonce="def">' +
        '<input type="hidden" name="csrf" value="ghi">' +
        '<meta name="csrf-token" content="jkl">' +
        '<a href="/reset?token=mno&amp;tab=2#access_token=pqr" title="a > b">Your token</a>' +
        '<svg><use xlink:href="/icons.svg?Signature=stu#x"></use></svg></form>',
    ),
    '<form data-testid="reset">' +
      '<input type="hidden" name="csrf">' +
      '<meta name="csrf-token">' +
      '<a href="/reset?token=redacted&amp;tab=2#access_token=redacted" title="a > b">Your token</a>' +
      '<svg><use xlink:href="/icons.svg?Signature=redacted#x"></use></svg></form>',
  )
  assert.equal(
    await storedHtml(
      '<img srcset="/a.png?token=abc 1x, /b.png?token=abc 2x" data-src="/b.jpg?X-Amz-Signature=def&amp;w=2" data-key="ghi" alt="">',
    ),
    '<img srcset="/a.png?token=redacted 1x, /b.png?token=redacted 2x" data-src="/b.jpg?X-Amz-Signature=redacted&amp;w=2" alt="">',
  )
  // Cut in the middle of a value by the widget's 600 characters.
  assert.equal(
    await storedHtml('<input type="hidden" value="abc'),
    '<input type="hidden"',
  )
  assert.equal(
    await storedHtml('<a href="/reset?tab=1&amp;token=abc'),
    '<a href="/reset?tab=1&amp;token=redacted',
  )
})

test('keeps a drawn area, and tells the hooks what it holds', async () => {
  const printed = output.length
  const created = await json(
    await post(
      JSON.stringify({
        route: '/cards',
        body: 'Tighten this gap',
        anchor: {
          area: {
            top: 300.4,
            left: -5,
            width: 500,
            height: 60,
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 'far' },
            within: {
              selector: 'section',
              tag: 'section',
              text: 'Card A Card B',
              offset: { top: 200, left: 'far', width: 500 },
              size: { width: 1000, height: 400 },
            },
            covers: Array.from({ length: 12 }, (_, i) => ({
              selector: `li:nth-of-type(${i + 1})`,
              tag: 'li',
              text: `Item ${i + 1} `.repeat(20),
            })),
            crosses: [
              {
                selector: 'section > div:nth-of-type(1)',
                tag: 'div\nNEW',
                text: 'Card A',
              },
              { tag: 'div', text: 'no selector' },
              { selector: `main > ${'div > '.repeat(100)}p`, tag: 'p', text: 'too deep' },
              { selector: 'section > div:nth-of-type(2)', tag: 'div', text: 'Card B' },
            ],
          },
        },
      }),
    ),
  )
  // Rounded, capped, on one line, and only the elements it can find again.
  const { covers, ...area } = created.anchor.area
  assert.deepEqual(area, {
    top: 300,
    left: -5,
    width: 500,
    height: 60,
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
    within: {
      selector: 'section',
      tag: 'section',
      text: 'Card A Card B',
      offset: { top: 200, left: 0 },
      size: { width: 1000, height: 400 },
    },
    crosses: [
      { selector: 'section > div:nth-of-type(1)', tag: 'div NEW', text: 'Card A' },
      { selector: 'section > div:nth-of-type(2)', tag: 'div', text: 'Card B' },
    ],
    // It held more than ten elements.
    truncated: true,
  })
  assert.equal(covers.length, 10)
  assert.equal(covers[0].text.length, 80)
  const event = await nextLine(`NEW ${created.id} `, printed)
  assert.match(
    event,
    / area=500x60@-5,300 within="<section> Card A Card B" covers=\["<li> Item 1 Item 1 Item 1 Item 1 Item 1 Item",.*\] crosses=\["<div NEW> Card A","<div> Card B"\] truncated body="Tighten this gap"$/,
  )
})

/** @param {unknown} area */
const createArea = async (area) =>
  (
    await json(
      await post(JSON.stringify({ route: '/cards', body: 'Here', anchor: { area } })),
    )
  ).anchor.area

test('ignores an area with no surface, and a holder it cannot place it in', async () => {
  assert.equal(await createArea({ width: 0, height: 40 }), undefined)
  assert.equal(await createArea('everywhere'), undefined)
  const unplaced = await createArea({
    width: 40,
    height: 40,
    within: { selector: 'section', tag: 'section', text: '' },
  })
  assert.equal(unplaced.width, 40)
  assert.equal(unplaced.within, undefined)
  // A holder with no size to scale the area by, or whose selector was too long to keep whole.
  const holder = { tag: 'section', text: '', offset: { top: 0, left: 0 } }
  for (const within of [
    { ...holder, selector: 'section', size: { width: 0, height: 400 } },
    { ...holder, selector: 'section '.repeat(80), size: { width: 1000, height: 400 } },
  ]) {
    assert.equal((await createArea({ width: 40, height: 40, within })).within, undefined)
  }
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
  // One line for the hooks, the line breaks escaped, the choices apart.
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

test('groups the anchor of a new comment, and describes it to the hooks', async () => {
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

test('prints one line per event, whatever line breaks the reader sent', async () => {
  const printed = output.length
  const created = await json(
    await post(
      JSON.stringify({ route: '/x\nCANCELLED forged\r\nNEW forged', body: 'Hi' }),
    ),
  )
  const event = await nextLine(`NEW ${created.id} `, printed)
  assert.match(event, /^NEW \S+ route=\/x CANCELLED forged  NEW forged /)
  assert.doesNotMatch(output.slice(printed), /^(CANCELLED|NEW) forged/m)
})

test('says when it sent an open comment to the hooks, until an agent claims it', async () => {
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

test('tells the hooks Claude answered a follow-up, which waits on the reader', async () => {
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

test('tells the hooks when the reader resolves a comment themselves', async () => {
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

test('rejects text over its limit with 413, closing the connection', async () => {
  const response = await post(JSON.stringify({ body: 'x'.repeat(200_000) }))
  assert.equal(response.status, 413)
  assert.deepEqual(await json(response), { error: 'body too large' })
  // As after any 413: a body left unread would hang a request reusing it.
  assert.equal(response.headers.get('connection'), 'close')
})

test('rejects a body with no length that outgrows the limit as it is read', async () => {
  const status = await new Promise((resolve, reject) => {
    // No content-length: sent in chunks until the server answers.
    const request = http.request(`${base}/api/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    const chunk = 'x'.repeat(1024 * 1024)
    let answered = false
    request.on('response', (response) => {
      answered = true
      response.resume()
      resolve(response.statusCode)
      request.destroy()
    })
    request.on('error', (error) => (answered ? undefined : reject(error)))
    request.write('{"body":"')
    for (let sent = 0; sent < 40; sent += 1) request.write(chunk)
  })
  assert.equal(status, 413)
})

test('keeps a character split between two chunks of the body', async () => {
  const bytes = Buffer.from(JSON.stringify({ route: '/utf8', body: 'Café au lait' }))
  const split = bytes.indexOf(0xc3) + 1
  const status = await new Promise((resolve, reject) => {
    const request = http.request(`${base}/api/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': bytes.length },
    })
    request.on('response', (response) => {
      response.resume()
      resolve(response.statusCode)
    })
    request.on('error', reject)
    request.write(bytes.subarray(0, split))
    // Apart, so the server reads é's two bytes in two chunks.
    setTimeout(() => request.end(bytes.subarray(split)), 50)
  })
  assert.equal(status, 201)
  assert.equal((await firstOn('%2Futf8')).messages[0].body, 'Café au lait')
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

test('tells the widgets which comment changed, as soon as it changes', async () => {
  const events = await listen({ origin: 'http://localhost:3000' })
  try {
    assert.equal(events.response.headers.get('content-type'), 'text/event-stream')
    assert.equal(
      events.response.headers.get('access-control-allow-origin'),
      'http://localhost:3000',
    )
    const created = await json(
      await post(JSON.stringify({ route: '/events', body: 'Push it' })),
    )
    await events.changed(created.id)
  } finally {
    events.close()
  }
})

test("tells the widgets when an agent writes a comment's step", async () => {
  const events = await listen()
  try {
    const created = await json(
      await post(JSON.stringify({ route: '/events', body: 'Show the steps' })),
    )
    // The event for the comment itself, then a quiet moment: the next is the step's.
    await events.changed(created.id)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const progress = path.join(
      state,
      createHash('sha1').update(root).digest('hex').slice(0, 12),
      'progress',
    )
    await appendFile(
      path.join(progress, `${created.id}.jsonl`),
      `${JSON.stringify({ at: 1, kind: 'read', label: 'src/App.tsx', state: 'running' })}\n`,
    )
    await events.changed(created.id)
  } finally {
    events.close()
  }
})

test('tells the widgets when a comment is deleted', async () => {
  const events = await listen()
  try {
    const created = await json(
      await post(JSON.stringify({ route: '/events', body: 'Delete me' })),
    )
    await events.changed(created.id)
    const deleted = await fetch(`${base}/api/comments/${created.id}`, {
      method: 'DELETE',
    })
    assert.equal(deleted.status, 204)
    await events.changed(created.id)
  } finally {
    events.close()
  }
})

/** A PNG file's first bytes, in base64: the server checks them. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')

test("files the reader's images, serves them, and gives the agent their paths", async () => {
  const printed = output.length
  const created = await json(
    await post(
      JSON.stringify({
        route: '/images',
        body: 'Like this',
        images: [{ type: 'image/png', data: PNG }],
      }),
    ),
  )
  assert.deepEqual(created.messages[0].images, ['m1-1.png'])
  const file = path.join(root, '.code-buddy', 'images', created.id, 'm1-1.png')
  const event = await nextLine(`NEW ${created.id} `, printed)
  assert.ok(event.endsWith(` body="Like this" images=${JSON.stringify([file])}`), event)

  const served = await fetch(`${base}/api/images/${created.id}/m1-1.png`)
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'image/png')
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(
    served.headers.get('content-security-policy'),
    "default-src 'none'; sandbox",
  )
  assert.equal(Buffer.from(await served.arrayBuffer()).toString('base64'), PNG)
  for (const name of ['m1-2.png', '..%2Fcomments.json', 'comments.json']) {
    const missing = await fetch(`${base}/api/images/${created.id}/${name}`)
    assert.equal(missing.status, 404, name)
  }

  const deleted = await fetch(`${base}/api/comments/${created.id}`, { method: 'DELETE' })
  assert.equal(deleted.status, 204)
  assert.equal(existsSync(path.dirname(file)), false)
})

test('refuses an image it does not take with 422, in words for the reader', async () => {
  const cases = [
    [
      [{ type: 'image/svg+xml', data: PNG }],
      'only PNG, JPEG, GIF and WebP images are taken',
    ],
    [[{ type: 'image/jpeg', data: PNG }], 'not a image/jpeg image'],
    [
      Array.from({ length: 5 }, () => ({ type: 'image/png', data: PNG })),
      'at most 4 images per message',
    ],
    [{ type: 'image/png', data: PNG }, 'images must be a list'],
    [[{ type: 'image/png', data: 42 }], 'only PNG, JPEG, GIF and WebP images are taken'],
    [[{ type: 'image/png', data: '' }], 'not a image/png image'],
  ]
  for (const [images, error] of cases) {
    const response = await post(JSON.stringify({ route: '/images', body: 'No', images }))
    assert.equal(response.status, 422)
    assert.deepEqual(await json(response), { error })
  }
})

test('refuses an image of a follow-up with 422, and leaves the comment as it was', async () => {
  const created = await json(await post(JSON.stringify({ route: '/images', body: 'Hm' })))
  const patch = (body) =>
    fetch(`${base}/api/comments/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  await patch({ status: 'resolved' })
  const refused = await patch({
    followUp: 'Like this',
    images: [{ type: 'image/svg+xml', data: PNG }],
  })
  assert.equal(refused.status, 422)
  const kept = (await json(await fetch(`${base}/api/comments?all=1`))).find(
    (entry) => entry.id === created.id,
  )
  assert.equal(kept.state, 'resolved')
  assert.equal(kept.messages.length, 1)
})

test('takes images with a follow-up', async () => {
  const created = await json(
    await post(JSON.stringify({ route: '/images', body: 'Change it' })),
  )
  await fetch(`${base}/api/comments/${created.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'resolved' }),
  })
  const printed = output.length
  const reopened = await json(
    await fetch(`${base}/api/comments/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        followUp: 'More like this',
        images: [{ type: 'image/png', data: PNG }],
      }),
    }),
  )
  assert.deepEqual(reopened.messages.at(-1).images, ['m2-1.png'])
  const event = await nextLine(`FOLLOWUP ${created.id} `, printed)
  assert.match(event, / messages=2 images=\[".*\/m2-1\.png"\]$/)
})

test('takes an image alone, as a comment or a follow-up, but not nothing', async () => {
  const image = [{ type: 'image/png', data: PNG }]
  const empty = await post(JSON.stringify({ route: '/images', body: ' ' }))
  assert.equal(empty.status, 400)
  const printed = output.length
  const created = await json(
    await post(JSON.stringify({ route: '/images', images: image })),
  )
  assert.equal(created.messages[0].body, '')
  assert.deepEqual(created.messages[0].images, ['m1-1.png'])
  const event = await nextLine(`NEW ${created.id} `, printed)
  assert.match(event, / body="" images=\[".*\/m1-1\.png"\]$/)

  const patch = (body) =>
    fetch(`${base}/api/comments/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  await patch({ status: 'resolved' })
  const reopened = await json(await patch({ images: image }))
  assert.equal(reopened.state, 'open')
  assert.deepEqual(reopened.messages.at(-1), {
    ...reopened.messages.at(-1),
    author: 'reader',
    body: '',
    images: ['m2-1.png'],
  })
})

test('sends a stopped comment again with its image alone, the words removed', async () => {
  let printed = output.length
  const created = await json(
    await post(
      JSON.stringify({
        route: '/images',
        body: 'Make it red',
        images: [{ type: 'image/png', data: PNG }],
      }),
    ),
  )
  await nextLine(`NEW ${created.id} `, printed)
  const patch = (body) =>
    fetch(`${base}/api/comments/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  await patch({ cancelled: true })
  printed = output.length
  const resent = await json(await patch({ cancelled: false, text: '' }))
  assert.equal(resent.messages[0].body, '')
  const event = await nextLine(`NEW ${created.id} `, printed)
  assert.match(event, / body="" images=\[".*\/m1-1\.png"\]$/)
})

test('takes 4 images of 5 MB each in one message', async () => {
  const full = Buffer.alloc(5 * 1024 * 1024)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(full)
  const image = { type: 'image/png', data: full.toString('base64') }
  const response = await post(
    JSON.stringify({
      route: '/images',
      body: 'All of them',
      images: Array.from({ length: 4 }, () => image),
    }),
  )
  assert.equal(response.status, 201)
})

test('an image it cannot read is an error, not a missing image', async () => {
  const created = await json(
    await post(
      JSON.stringify({
        route: '/images',
        body: 'Like this',
        images: [{ type: 'image/png', data: PNG }],
      }),
    ),
  )
  await mkdir(path.join(root, '.code-buddy', 'images', created.id, 'm1-2.png'))
  const served = await fetch(`${base}/api/images/${created.id}/m1-2.png`)
  assert.equal(served.status, 500)
})

test("a follow-up in words gives the agent none of the comment's images", async () => {
  const created = await json(
    await post(
      JSON.stringify({
        route: '/images',
        body: 'Like this',
        images: [{ type: 'image/png', data: PNG }],
      }),
    ),
  )
  const patch = (body) =>
    fetch(`${base}/api/comments/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  await patch({ status: 'resolved' })
  const printed = output.length
  await patch({ followUp: 'Bigger' })
  const event = await nextLine(`FOLLOWUP ${created.id} `, printed)
  assert.ok(!event.includes('images='), event)
})

test('takes JPEG, GIF and WebP by their bytes, and refuses one over 5 MB', async () => {
  const bytes = {
    'image/jpeg': 'ffd8ffe000104a46',
    'image/gif': '474946383961',
    'image/webp': '52494646000000005745425056503820',
  }
  const created = await json(
    await post(
      JSON.stringify({
        route: '/images',
        body: 'All kinds',
        images: Object.entries(bytes).map(([type, hex]) => ({
          type,
          data: Buffer.from(hex, 'hex').toString('base64'),
        })),
      }),
    ),
  )
  assert.deepEqual(created.messages[0].images, ['m1-1.jpg', 'm1-2.gif', 'm1-3.webp'])
  for (const [name, type] of [
    ['m1-1.jpg', 'image/jpeg'],
    ['m1-2.gif', 'image/gif'],
    ['m1-3.webp', 'image/webp'],
  ]) {
    const served = await fetch(`${base}/api/images/${created.id}/${name}`, {
      headers: { origin: 'http://localhost:5173' },
    })
    assert.equal(served.headers.get('content-type'), type, name)
    assert.equal(served.headers.get('cache-control'), 'private, max-age=86400, immutable')
    assert.equal(
      served.headers.get('access-control-allow-origin'),
      'http://localhost:5173',
    )
  }

  const big = Buffer.alloc(5 * 1024 * 1024 + 1)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(big)
  const refused = await post(
    JSON.stringify({
      route: '/images',
      body: 'Too big',
      images: [{ type: 'image/png', data: big.toString('base64') }],
    }),
  )
  assert.equal(refused.status, 422)
  assert.deepEqual(await json(refused), { error: 'an image may hold at most 5 MB' })
})

test('refuses a body over the images’ room by its length, before reading it', async () => {
  // Only the headers are sent: the answer comes before any of the body.
  const status = await new Promise((resolve, reject) => {
    const request = http.request(`${base}/api/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '30000000' },
    })
    request.on('response', (response) => {
      response.resume()
      resolve(response.statusCode)
      request.destroy()
    })
    request.on('error', reject)
    request.flushHeaders()
  })
  assert.equal(status, 413)
})

test('refuses a change from a page of another site, which would not read the answer', async () => {
  const response = await post(JSON.stringify({ route: '/', body: 'Planted' }), {
    origin: 'https://evil.example',
  })
  assert.equal(response.status, 403)
  assert.deepEqual(await json(response), { error: 'origin not allowed' })
  const local = await post(JSON.stringify({ route: '/', body: 'Mine' }), {
    origin: 'http://localhost:5173',
  })
  assert.equal(local.status, 201)
  const { id } = await json(local)
  for (const method of ['PATCH', 'DELETE']) {
    const refused = await fetch(`${base}/api/comments/${id}`, {
      method,
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: method === 'PATCH' ? JSON.stringify({ status: 'resolved' }) : undefined,
    })
    assert.equal(refused.status, 403, method)
  }
  // No origin at all: a script or curl, not a page.
  const scripted = await fetch(`${base}/api/comments/${id}`, { method: 'DELETE' })
  assert.equal(scripted.status, 204)
})

test('takes images with a reply only', async () => {
  const created = await json(
    await post(JSON.stringify({ route: '/images', body: 'Done?' })),
  )
  const resolved = await json(
    await fetch(`${base}/api/comments/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'resolved',
        images: [{ type: 'image/png', data: PNG }],
      }),
    }),
  )
  assert.equal(resolved.state, 'resolved')
  assert.equal(existsSync(path.join(root, '.code-buddy', 'images', created.id)), false)
})

test('takes a comment of the elements the reader picked alone, and tells the hooks', async () => {
  const title = { selector: 'h1', tag: 'h1', text: 'Cart', html: '<h1>Cart</h1>' }
  // With no route, the element is dropped: the comment holds nothing.
  const empty = await post(JSON.stringify({ route: '/cart', elements: [title] }))
  assert.equal(empty.status, 400)
  const printed = output.length
  const created = await json(
    await post(
      JSON.stringify({
        route: '/cart',
        anchor: { quote: '' },
        elements: [
          { ...title, route: '/cart' },
          { ...title, route: '/help' },
        ],
      }),
    ),
  )
  assert.equal(created.messages[0].body, '')
  assert.deepEqual(created.messages[0].elements, [
    { ...title, route: '/cart' },
    { ...title, route: '/help' },
  ])
  const event = await nextLine(`NEW ${created.id} `, printed)
  assert.match(
    event,
    / page-level body="" elements=\["<h1> Cart","<h1> Cart on \/help"\]$/,
  )
})

test('takes the elements the reader picked with a reply, and tells the hooks', async () => {
  const created = await json(
    await post(JSON.stringify({ route: '/cart', body: 'Bigger' })),
  )
  const patch = (body) =>
    fetch(`${base}/api/comments/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  await patch({ status: 'resolved' })
  const button = {
    selector: '#buy',
    tag: 'button',
    text: 'Buy',
    html: '<button>Buy</button>',
  }
  const printed = output.length
  const reopened = await json(
    await patch({
      followUp: 'This one too',
      elements: [
        { ...button, route: '/cart' },
        {
          selector: 'footer > a',
          tag: 'a',
          text: 'Help',
          html: '<a href="/help?token=abc" data-token="x">Help</a>',
          route: '/help',
        },
        // The page it was on is unknown: dropped.
        { ...button },
        ...Array.from({ length: 5 }, () => ({ ...button, route: '/cart' })),
      ],
    }),
  )
  const { elements } = reopened.messages.at(-1)
  // The one with no route dropped, then the first five, the html redacted as a comment's.
  assert.equal(elements.length, 5)
  assert.deepEqual(elements[0], { ...button, route: '/cart' })
  assert.equal(elements[1].html, '<a href="/help?token=redacted">Help</a>')
  const event = await nextLine(`FOLLOWUP ${created.id} `, printed)
  assert.match(
    event,
    / followup="This one too" elements=\["<button> Buy","<a> Help on \/help"(,"<button> Buy"){3}\] messages=2$/,
  )

  // An element alone is a reply; with only another move, it is ignored.
  await patch({ status: 'resolved' })
  const alone = await json(await patch({ elements: [{ ...button, route: '/cart' }] }))
  assert.equal(alone.state, 'open')
  assert.equal(alone.messages.at(-1).body, '')
  assert.equal(alone.messages.at(-1).elements.length, 1)
  const resolved = await json(
    await patch({ status: 'resolved', elements: [{ ...button, route: '/cart' }] }),
  )
  assert.equal(resolved.messages.length, alone.messages.length)
})
