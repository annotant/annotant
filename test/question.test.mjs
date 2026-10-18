// A comment's agent's AskUserQuestion: asked in the thread by hook.mjs, which
// waits on the reader's answer through the server and hands it to the tool.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { SCRIPTS, freePort, json, run, tempDir, tempProject } from './helpers.mjs'
import { threadQuestion, toolAnswer } from '../skills/code-buddy/scripts/lib/question.mjs'

const WIDGET = path.join(SCRIPTS, '..', 'widget', 'dist', 'widget.js')
const HOOK = path.join(SCRIPTS, 'hook.mjs')

/** The fence, made plain for the assertions. */
const fence = (/** @type {string} */ text) => `[fenced] ${text}`

const layout = {
  question: 'Which layout?',
  header: 'Layout',
  options: [{ label: 'Grid', description: 'Cards in a grid' }, { label: 'List' }],
  multiSelect: false,
}

test('asks one question with its options, as ask.mjs files them', () => {
  assert.deepEqual(threadQuestion([layout]), {
    body: 'Which layout?',
    options: [{ label: 'Grid', description: 'Cards in a grid' }, { label: 'List' }],
    multiple: false,
  })
  assert.equal(threadQuestion([{ ...layout, multiSelect: true }]).multiple, true)
})

test('asks for words where the thread has no buttons to offer', () => {
  // A value, a text, or options the thread cannot show.
  assert.deepEqual(
    threadQuestion([
      {
        question: 'How wide?',
        kind: 'number',
        description: 'The cards’ width.',
        options: [],
        multiSelect: false,
        min: 200,
        max: 400,
        unit: 'px',
      },
    ]),
    {
      body: 'How wide?\nThe cards’ width.\n(200 to 400 px)',
      options: [],
      multiple: false,
    },
  )
  const twice = [{ label: 'Grid' }, { label: 'Grid' }]
  assert.deepEqual(threadQuestion([{ ...layout, options: twice, multiSelect: true }]), {
    body: 'Which layout?\n- Grid\n- Grid',
    options: [],
    multiple: false,
  })
})

test('asks several questions in one message, each with its options', () => {
  const { body, options } = threadQuestion([
    layout,
    { question: 'Any title?', kind: 'text', options: [], multiSelect: false },
  ])
  assert.equal(body, '1. Which layout?\n- Grid: Cards in a grid\n- List\n\n2. Any title?')
  assert.deepEqual(options, [])
})

test("gives the tool the reader's choices, their words beside them", () => {
  const input = { questions: [layout] }
  assert.deepEqual(
    toolAnswer(input, [layout], { body: 'List\n\nDenser', choices: ['List'] }, fence),
    {
      questions: [layout],
      answers: { 'Which layout?': 'List' },
      annotations: { 'Which layout?': { notes: '[fenced] Denser' } },
    },
  )
  assert.deepEqual(
    toolAnswer(input, [layout], { body: 'Grid', choices: ['Grid'] }, fence),
    {
      questions: [layout],
      answers: { 'Which layout?': 'Grid' },
    },
  )
})

test("gives the tool the reader's own words, and what they attached", () => {
  const answered = toolAnswer(
    { questions: [layout] },
    [layout],
    {
      body: 'Like the pricing page',
      images: ['/state/images/c1/m3-1.png'],
      elements: [
        {
          selector: 'main > ul',
          tag: 'ul',
          text: 'Plans',
          html: '<ul>',
          route: '/pricing',
        },
      ],
    },
    fence,
  )
  assert.deepEqual(answered, {
    questions: [layout],
    answers: {},
    response:
      '[fenced] Like the pricing page\n\n' +
      'The reader attached images; open each with Read: /state/images/c1/m3-1.png\n\n' +
      'The reader picked <ul> "Plans" (main > ul) on /pricing.',
  })
})

test("gives the tool the reader's words for several questions", () => {
  /** @type {import('../skills/code-buddy/scripts/lib/question.mjs').AskedQuestion} */
  const title = { question: 'Any title?', kind: 'text', options: [], multiSelect: false }
  assert.deepEqual(
    toolAnswer(
      { questions: [layout, title] },
      [layout, title],
      { body: 'Grid, no title' },
      fence,
    ),
    { questions: [layout, title], answers: {}, response: '[fenced] Grid, no title' },
  )
})

// ---------------------------------------------------------------------------
// The hook and the server.

let base = ''
let root = ''
let state = ''
let port = 0
let output = ''
/** @type {import('node:child_process').ChildProcess | undefined} */
let server

before(async (t) => {
  if (!existsSync(WIDGET)) throw new Error('build the widget first: npm run build')
  root = await tempProject(t)
  port = await freePort()
  state = await tempDir(t)
  const child = spawn(
    process.execPath,
    [path.join(SCRIPTS, 'server.mjs'), '--project', root],
    {
      env: {
        ...process.env,
        CODE_BUDDY_PORT: String(port),
        CODE_BUDDY_STATE_DIR: state,
        CODE_BUDDY_HOOKS: '1',
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

/** The first line starting with `prefix` the server printed after `from`. */
async function nextLine(/** @type {string} */ prefix, /** @type {number} */ from) {
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

/**
 * A comment its agent claimed, as claim.mjs leaves it.
 * @param {string} body
 * @returns {Promise<string>} Its id.
 */
async function claimed(body) {
  const posting = output.length
  const created = await json(
    await fetch(`${base}/api/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ route: '/cards', body }),
    }),
  )
  // Seen open first: a comment the server first reads asking is no news to the hooks.
  await nextLine(`NEW ${created.id} `, posting)
  const claim = await run(
    process.execPath,
    [path.join(SCRIPTS, 'claim.mjs'), created.id, '--project', root],
    { env: { CODE_BUDDY_STATE_DIR: state } },
  )
  assert.equal(claim.code, 0, claim.stderr)
  return created.id
}

/**
 * The agent's AskUserQuestion, through hook.mjs's pre: resolves to what the
 * hook printed once it returns.
 * @param {string} id
 * @param {Record<string, string>} [env]
 */
async function askUserQuestion(id, env = {}) {
  const ran = await run(
    process.execPath,
    [HOOK, 'pre', '--comment', id, '--project', root],
    {
      input: JSON.stringify({
        agent_id: 'a1',
        tool_name: 'AskUserQuestion',
        tool_input: { questions: [layout] },
        tool_use_id: 't1',
      }),
      env: { CODE_BUDDY_STATE_DIR: state, CODE_BUDDY_PORT: String(port), ...env },
    },
  )
  assert.equal(ran.code, 0, ran.stderr)
  return JSON.parse(ran.stdout).hookSpecificOutput
}

/** @param {string} id */
const commentOf = async (id) =>
  (await json(await fetch(`${base}/api/comments?all=1`))).find(
    (/** @type {{ id: string }} */ comment) => comment.id === id,
  )

/**
 * The reader's move on comment `id`.
 * @param {string} id
 * @param {Record<string, unknown>} body
 */
const patch = (id, body) =>
  fetch(`${base}/api/comments/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

test("waits on the reader's answer in the thread, and the agent goes on in a new run", async () => {
  const id = await claimed('Rework the cards')
  const from = output.length
  const asked = askUserQuestion(id)
  await nextLine(`ASKED ${id}`, from)
  // The question in the thread, as ask.mjs files it.
  const asking = await commentOf(id)
  assert.deepEqual(asking.messages.at(-1), {
    id: 'm2',
    run: 'r1',
    author: 'claude',
    body: 'Which layout?',
    at: asking.messages.at(-1).at,
    question: true,
    options: [{ label: 'Grid', description: 'Cards in a grid' }, { label: 'List' }],
  })
  assert.equal((await patch(id, { choices: ['List'], followUp: 'Denser' })).status, 200)
  const decided = await asked
  assert.equal(decided.permissionDecision, 'allow')
  assert.deepEqual(decided.updatedInput.answers, { 'Which layout?': 'List' })
  assert.match(
    decided.updatedInput.annotations['Which layout?'].notes,
    /^Each line below starting with (cb-\w+) is the reader's comment[^\n]*\n\1 Denser$/,
  )
  // Claimed for the agent, in a run of its own; the hooks module hears nothing.
  const working = await commentOf(id)
  assert.equal(working.state, 'working')
  assert.equal(working.events.at(-1).run, 'r2')
  assert.ok(!output.slice(from).includes(`FOLLOWUP ${id}`), output.slice(from))
})

test('leaves the answer to a follow-up once it waited long enough', async () => {
  const id = await claimed('Rework the list')
  const from = output.length
  const refused = await askUserQuestion(id, { CODE_BUDDY_ASK_WAIT_MS: '300' })
  assert.equal(refused.permissionDecision, 'deny')
  assert.match(refused.permissionDecisionReason, /replying "QUESTION: <your question>"/)
  // The question stays in the thread; the answer goes to the hooks module.
  assert.equal((await commentOf(id)).state, 'asking')
  assert.equal((await patch(id, { choices: ['Grid'] })).status, 200)
  await nextLine(`FOLLOWUP ${id} `, from)
})

test('tells the agent to stop when the reader resolves the question instead', async () => {
  const id = await claimed('Rework the grid')
  const from = output.length
  const asked = askUserQuestion(id)
  await nextLine(`ASKED ${id}`, from)
  assert.equal((await patch(id, { status: 'resolved' })).status, 200)
  const refused = await asked
  assert.equal(refused.permissionDecision, 'deny')
  assert.match(refused.permissionDecisionReason, /reply "CANCELLED"/)
})

test("refuses a page's request for an answer", async () => {
  const id = await claimed('Rework the footer')
  const response = await fetch(`${base}/api/comments/${id}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({ wait: 0 }),
  })
  assert.equal(response.status, 403)
})

test('leaves the answer to a follow-up once the hook went away', async () => {
  const id = await claimed('Rework the header')
  const from = output.length
  const hook = spawn(
    process.execPath,
    [HOOK, 'pre', '--comment', id, '--project', root],
    {
      env: { ...process.env, CODE_BUDDY_STATE_DIR: state, CODE_BUDDY_PORT: String(port) },
      stdio: ['pipe', 'ignore', 'ignore'],
    },
  )
  hook.stdin.end(
    JSON.stringify({ tool_name: 'AskUserQuestion', tool_input: { questions: [layout] } }),
  )
  await nextLine(`ASKED ${id}`, from)
  // Its request open, then the agent stopped.
  await new Promise((resolve) => setTimeout(resolve, 200))
  hook.kill()
  await new Promise((resolve) => hook.on('exit', resolve))
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal((await patch(id, { choices: ['Grid'] })).status, 200)
  await nextLine(`FOLLOWUP ${id} `, from)
  assert.equal((await commentOf(id)).state, 'open')
})

test('lets one hook only wait on a question', async () => {
  const id = await claimed('Rework the sidebar')
  const from = output.length
  const asked = askUserQuestion(id)
  await nextLine(`ASKED ${id}`, from)
  await new Promise((resolve) => setTimeout(resolve, 200))
  const second = await fetch(`${base}/api/comments/${id}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wait: 1000 }),
  })
  assert.equal(second.status, 409)
  assert.equal((await patch(id, { choices: ['Grid'] })).status, 200)
  assert.equal((await asked).permissionDecision, 'allow')
})
