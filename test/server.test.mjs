import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { SCRIPTS, freePort, json, run, tempDir, tempProject } from './helpers.mjs'

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

before(async (t) => {
  if (!existsSync(WIDGET)) throw new Error('build the widget first: npm run build')
  root = await tempProject(t, { theme: { on: 'html', attribute: 'class', dark: 'dark' } })
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/shop.git'], {
    cwd: root,
  })
  port = await freePort()
  const child = spawn(
    process.execPath,
    [path.join(SCRIPTS, 'server.mjs'), '--project', root],
    {
      env: {
        ...process.env,
        ANNOTANT_PORT: String(port),
        ANNOTANT_STATE_DIR: (state = await tempDir(t)),
        ANNOTANT_HOOKS: '1',
        // Never during a test: the server sees every change through its watches.
        ANNOTANT_POLL_MS: '600000',
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

test("tells the widget the app's light and dark switch", async () => {
  const health = await json(await fetch(`${base}/api/health`))
  assert.deepEqual(health.theme, { on: 'html', attribute: 'class', dark: 'dark' })
})

test("tells the widget the project's repository, from its origin remote", async () => {
  const health = await json(await fetch(`${base}/api/health`))
  assert.deepEqual(health.repository, {
    kind: 'github',
    url: 'https://github.com/acme/shop',
  })
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

test('keeps the lines drawn freehand in an area, in its box, and says how many', async () => {
  const printed = output.length
  const created = await json(
    await post(
      JSON.stringify({
        route: '/cards',
        body: 'Move this here',
        anchor: {
          area: {
            top: 300,
            left: 10,
            width: 200,
            height: 100,
            covers: [],
            crosses: [],
            pointsAt: { selector: 'h3', tag: 'h3', text: 'How a subscription works' },
            strokes: [
              [
                [8.4, 8],
                [150, 'far'],
                [900, -20],
              ],
              [],
              'not a line',
              [[20, 30], 'not a point'],
              ...Array.from({ length: 45 }, () => [[1, 1]]),
            ],
          },
        },
      }),
    ),
  )
  const { strokes } = created.anchor.area
  // The last 40 strokes, each point rounded and in the area's box.
  assert.equal(strokes.length, 40)
  assert.deepEqual(strokes[0], [[1, 1]])
  assert.deepEqual(created.anchor.area.pointsAt, {
    selector: 'h3',
    tag: 'h3',
    text: 'How a subscription works',
  })

  const drawing = await createArea({
    width: 200,
    height: 100,
    strokes: [
      [
        [8.4, 8],
        [150, 'far'],
        [900, -20],
      ],
      [],
      'not a line',
      [[20, 30], 'not a point'],
      Array.from({ length: 500 }, (_, i) => [i % 200, 50]),
    ],
  })
  assert.deepEqual(drawing.strokes.slice(0, 2), [
    [
      [8, 8],
      [150, 0],
      [200, 0],
    ],
    [[20, 30]],
  ])
  // A long line keeps its first 400 points.
  assert.equal(drawing.strokes[2].length, 400)
  // 4000 points in all at most, and `pictured` only with lines.
  const long = await createArea({
    width: 400,
    height: 100,
    pictured: true,
    strokes: Array.from({ length: 12 }, () =>
      Array.from({ length: 400 }, (_, x) => [x, 50]),
    ),
  })
  assert.equal(long.strokes.flat().length, 4000)
  assert.equal(long.pictured, true)
  assert.equal(
    (await createArea({ width: 40, height: 40, pictured: true })).pictured,
    undefined,
  )
  // What the lines were drawn around, kept with where they lie from it and its size.
  const around = {
    selector: 'ul > li',
    tag: 'li',
    text: 'CNESST-1523',
    offset: { top: -13.4, left: -18 },
    size: { width: 200, height: 30 },
  }
  assert.deepEqual(
    (await createArea({ width: 40, height: 40, strokes: [[[1, 1]]], around })).around,
    { ...around, offset: { top: -13, left: -18 } },
  )
  assert.equal(
    (
      await createArea({
        width: 40,
        height: 40,
        strokes: [[[1, 1]]],
        around: { ...around, size: { width: 0, height: 30 } },
      })
    ).around,
    undefined,
  )
  // No line at all is no drawing, points at nothing and was drawn around nothing.
  const none = await createArea({
    width: 40,
    height: 40,
    strokes: [[], 'x'],
    pointsAt: { selector: 'h3', tag: 'h3', text: 'Title' },
    around,
  })
  assert.equal(none.strokes, undefined)
  assert.equal(none.pointsAt, undefined)
  assert.equal(none.around, undefined)

  const event = await nextLine(`NEW ${created.id} `, printed)
  assert.match(
    event,
    / area=200x100@10,300 strokes=40 points-at="<h3> How a subscription works" covers=\[\] crosses=\[\] body=/,
  )
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
  // It hands the reply over, not the comment: the reply is dated.
  const reply = answered.messages.at(-1)
  assert.match(event, new RegExp(`^FOLLOWUP ${created.id} sent=m3@${reply.sentAt} `))
  const filed = await storedMessages(created.id, (all) => all.at(-1).notifiedAt)
  assert.ok(filed.at(-1).notifiedAt >= reply.sentAt)
  assert.deepEqual(answered.messages.at(-1), {
    id: 'm3',
    author: 'reader',
    body: 'List\n\nDenser',
    choices: ['List'],
    at: answered.messages.at(-1).at,
    sentAt: answered.messages.at(-1).at,
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

test('keeps the text around a quote, cut to 32 characters on each side', async () => {
  const created = await json(
    await post(
      JSON.stringify({
        route: '/shop',
        body: 'Bigger',
        anchor: {
          quote: 'Add to cart',
          occurrence: 2,
          prefix: `${'x'.repeat(40)} Sidamo  \n  Huila `,
          suffix: ` \n Kenya\tAdd to cart ${'y'.repeat(40)}`,
          occurrences: 4,
        },
      }),
    ),
  )
  assert.deepEqual(created.anchor, {
    section: '',
    quote: 'Add to cart',
    occurrence: 2,
    prefix: 'xxxxxxxxxxxxxxxxxx Sidamo\nHuila ',
    suffix: '\nKenya Add to cart yyyyyyyyyyyyy',
    occurrences: 4,
  })
})

test('drops a count or a context it cannot use', async () => {
  for (const [anchor, kept] of [
    [{ occurrences: 0, prefix: '   ', suffix: 7 }, {}],
    [{ occurrences: -2 }, {}],
    [{ occurrences: 'Infinity' }, {}],
    [{ occurrences: 1.5 }, {}],
    // A quote cut to 2000 characters is followed by other text than its suffix.
    [
      { quote: 'a'.repeat(2001), prefix: 'Before', suffix: 'After' },
      { prefix: 'Before' },
    ],
  ]) {
    const created = await json(
      await post(JSON.stringify({ route: '/shop', body: 'Bigger', anchor })),
    )
    const { section: _, quote: __, occurrence: ___, ...rest } = created.anchor
    assert.deepEqual(rest, kept)
  }
})

test('prints one line per event, whatever line breaks the reader sent', async () => {
  const printed = output.length
  const created = await json(
    await post(
      JSON.stringify({ route: '/x\nCANCELLED forged\r\nNEW forged', body: 'Hi' }),
    ),
  )
  const event = await nextLine(`NEW ${created.id} `, printed)
  assert.match(event, /^NEW \S+ sent=\S+ route=\/x CANCELLED forged  NEW forged /)
  assert.doesNotMatch(output.slice(printed), /^(CANCELLED|NEW) forged/m)
})

/**
 * The comment's messages in the comments file, once `ready` holds for them.
 * @param {string} id
 * @param {(messages: any[]) => boolean} ready
 */
async function storedMessages(id, ready) {
  const file = path.join(root, '.annotant', 'comments.json')
  for (let waited = 0; waited < 3000; waited += 25) {
    const { comments } = JSON.parse(await readFile(file, 'utf8'))
    const messages = comments.find((comment) => comment.id === id)?.messages
    if (messages && ready(messages)) return messages
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`comment ${id} never got there`)
}

test("names the reader's message it hands over, and dates the hand-over in the file", async () => {
  const creating = output.length
  const created = await json(
    await post(JSON.stringify({ route: '/notified', body: 'Hi' })),
  )
  const line = await nextLine(`NEW ${created.id} `, creating)
  assert.match(
    line,
    new RegExp(`^NEW ${created.id} sent=m1@${created.createdAt} route=/notified `),
  )
  const [message] = await storedMessages(created.id, ([first]) => first.notifiedAt)
  assert.equal(message.sentAt, created.createdAt)
  assert.ok(message.notifiedAt >= created.createdAt, message.notifiedAt)
  // Dated once: its own write prints no line again.
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(output.slice(creating).split(`NEW ${created.id} `).length, 2)

  await run(process.execPath, [
    path.join(SCRIPTS, 'claim.mjs'),
    created.id,
    '--project',
    root,
  ])
  // Kept past the claim: the debug panel dates each hand-over from it.
  const [claimed] = await storedMessages(created.id, () => true)
  assert.equal(claimed.notifiedAt, message.notifiedAt)
})

test('a server started again hands the same message over, its first date kept', async (t) => {
  const project = await tempProject(t)
  const file = path.join(project, '.annotant', 'comments.json')
  const at = '2026-01-01T10:00:00.000Z'
  const notifiedAt = '2026-01-01T10:00:01.000Z'
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(
    file,
    JSON.stringify({
      version: 2,
      comments: [
        {
          id: 'c-restart',
          route: '/',
          anchor: { section: '', quote: '', occurrence: 0 },
          state: 'open',
          createdAt: at,
          messages: [
            { id: 'm1', author: 'reader', body: 'Hi', at, sentAt: at, notifiedAt },
          ],
          events: [{ at, state: 'open', by: 'reader' }],
        },
      ],
    }),
  )
  const again = spawn(
    process.execPath,
    [path.join(SCRIPTS, 'server.mjs'), '--project', project],
    {
      env: {
        ...process.env,
        ANNOTANT_PORT: String(await freePort()),
        ANNOTANT_STATE_DIR: await tempDir(t),
        ANNOTANT_HOOKS: '1',
        ANNOTANT_POLL_MS: '600000',
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  t.after(() => again.kill())
  let printed = ''
  await new Promise((resolve, reject) => {
    again.stdout.on('data', (chunk) => {
      printed += String(chunk)
      if (printed.includes('READY')) resolve(undefined)
    })
    again.on('exit', (code) => reject(new Error(`server exited with ${code}`)))
  })
  for (let waited = 0; waited < 3000 && !printed.includes('OPEN '); waited += 25) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.match(printed, new RegExp(`^OPEN c-restart sent=m1@${at} route=/ `, 'm'))
  await new Promise((resolve) => setTimeout(resolve, 200))
  const { comments } = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(comments[0].messages[0].notifiedAt, notifiedAt)
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
    for (let sent = 0; sent < 50; sent += 1) request.write(chunk)
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
  await mkdir(path.join(root, '.annotant'), { recursive: true })
  await writeFile(path.join(root, '.annotant', 'comments.json'), '{corrupt')
  const response = await fetch(`${base}/api/comments?route=%2F`)
  assert.equal(response.status, 500)
  assert.deepEqual(await json(response), { error: 'internal error' })
  await writeFile(
    path.join(root, '.annotant', 'comments.json'),
    JSON.stringify({ version: 2, comments: [] }),
  )
})

test('refuses to start on a comments file in the old format', async (t) => {
  const old = await tempProject(t)
  await mkdir(path.join(old, '.annotant'), { recursive: true })
  await writeFile(path.join(old, '.annotant', 'comments.json'), '[]')
  const started = await run(
    process.execPath,
    [path.join(SCRIPTS, 'server.mjs'), '--project', old],
    {
      env: {
        ANNOTANT_PORT: String(await freePort()),
        ANNOTANT_HOOKS: '1',
        ANNOTANT_STATE_DIR: await tempDir(t),
      },
    },
  )
  assert.equal(started.code, 2)
  assert.match(
    started.stdout,
    /^COMMENTS_REFUSED old comments format: delete .*\.annotant\/comments\.json$/m,
  )
})

test('a second server for the same project reports the port as busy', async () => {
  const second = await run(
    process.execPath,
    [path.join(SCRIPTS, 'server.mjs'), '--project', root],
    {
      env: { ANNOTANT_PORT: String(port), ANNOTANT_HOOKS: '1' },
    },
  )
  assert.equal(second.code, 3)
  assert.match(second.stdout, /PORT_BUSY .* another .* session for this project/)
})

test("refuses to start when Claude Code did not load the plugin's hooks", async () => {
  const started = await run(
    process.execPath,
    [path.join(SCRIPTS, 'server.mjs'), '--project', root],
    { env: { ANNOTANT_PORT: String(await freePort()), ANNOTANT_HOOKS: '' } },
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
  const file = path.join(root, '.annotant', 'images', created.id, 'm1-1.png')
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
      Array.from({ length: 101 }, () => ({ type: 'image/png', data: PNG })),
      'at most 100 images per message',
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

/** A PNG of `bytes`, as the widget sends it. */
function pngOf(bytes) {
  const full = Buffer.alloc(bytes)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(full)
  return { type: 'image/png', data: full.toString('base64') }
}

test('takes any number of images in one message, up to 32 MB together', async () => {
  const mb = 1024 * 1024
  const five = pngOf(5 * mb)
  const taken = await post(
    JSON.stringify({
      route: '/images',
      body: 'All of them',
      images: [...Array.from({ length: 6 }, () => five), pngOf(2 * mb)],
    }),
  )
  assert.equal(taken.status, 201)
  assert.equal((await json(taken)).messages[0].images.length, 7)

  const refused = await post(
    JSON.stringify({
      route: '/images',
      body: 'Too much',
      // Past 32 MB by a little: a request may hold that much, its text's room.
      images: [...Array.from({ length: 6 }, () => five), pngOf(2 * mb), pngOf(60_000)],
    }),
  )
  assert.equal(refused.status, 422)
  assert.deepEqual(await json(refused), {
    error: 'the images of a message may hold at most 32 MB together',
  })
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
  await mkdir(path.join(root, '.annotant', 'images', created.id, 'm1-2.png'))
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
      headers: { 'content-type': 'application/json', 'content-length': '50000000' },
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
  assert.equal(existsSync(path.join(root, '.annotant', 'images', created.id)), false)
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
        // One per message: the first the server can keep.
        elements: [title, { ...title, route: '/help' }, { ...title, route: '/cart' }],
      }),
    ),
  )
  assert.equal(created.messages[0].body, '')
  assert.deepEqual(created.messages[0].elements, [{ ...title, route: '/help' }])
  const event = await nextLine(`NEW ${created.id} `, printed)
  assert.match(event, / page-level body="" elements=\["<h1> Cart on \/help"\]$/)
})

test('takes the area the reader drew with a reply, and tells the hooks', async () => {
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
  const area = {
    top: 300,
    left: 10,
    width: 500,
    height: 60,
    viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0 },
    covers: [{ selector: '#buy', tag: 'button', text: 'Buy' }],
    crosses: [],
  }
  // The page it was on is unknown: dropped.
  const unplaced = await json(await patch({ followUp: 'Here', area }))
  assert.equal(unplaced.messages.at(-1).area, undefined)

  await patch({ status: 'resolved' })
  const printed = output.length
  const reopened = await json(
    await patch({ followUp: 'And here', area: { ...area, route: '/help' } }),
  )
  assert.deepEqual(reopened.messages.at(-1).area, { ...area, route: '/help' })
  const event = await nextLine(`FOLLOWUP ${created.id} `, printed)
  assert.match(
    event,
    / followup="And here" picked-area=500x60@10,300 covers=\["<button> Buy"\] crosses=\[\] on="\/help" messages=\d+$/,
  )

  // One target per message: with an element, the area is dropped; alone, it is a reply.
  await patch({ status: 'resolved' })
  const button = {
    selector: '#buy',
    tag: 'button',
    text: 'Buy',
    html: '',
    route: '/cart',
  }
  const both = await json(
    await patch({
      followUp: 'Both',
      elements: [button],
      area: { ...area, route: '/cart' },
    }),
  )
  assert.equal(both.messages.at(-1).area, undefined)
  assert.equal(both.messages.at(-1).elements.length, 1)
  await patch({ status: 'resolved' })
  const alone = await json(await patch({ area: { ...area, route: '/cart' } }))
  assert.equal(alone.state, 'open')
  assert.equal(alone.messages.at(-1).body, '')
  assert.equal(alone.messages.at(-1).area.route, '/cart')
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
        // The page it was on is unknown: dropped.
        { ...button },
        {
          selector: 'footer > a',
          tag: 'a',
          text: 'Help',
          html: '<a href="/help?token=abc" data-token="x">Help</a>',
          route: '/help',
        },
        { ...button, route: '/cart' },
      ],
    }),
  )
  const { elements } = reopened.messages.at(-1)
  // The one with no route dropped, then the first left: one per message, the
  // html redacted as a comment's.
  assert.equal(elements.length, 1)
  assert.equal(elements[0].html, '<a href="/help?token=redacted">Help</a>')
  const event = await nextLine(`FOLLOWUP ${created.id} `, printed)
  assert.match(
    event,
    / followup="This one too" elements=\["<a> Help on \/help"\] messages=2$/,
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
