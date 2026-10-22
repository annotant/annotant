import assert from 'node:assert/strict'
import path from 'node:path'
import { before, test } from 'node:test'
import { SCRIPTS, run, tempDir, tempProject } from './helpers.mjs'

/** @type {typeof import('../skills/annotant/scripts/lib/store.mjs')} */
let store
/** @type {typeof import('../skills/annotant/scripts/lib/project.mjs')} */
let projects

before(async (t) => {
  process.env.ANNOTANT_STATE_DIR = await tempDir(t)
  store = await import('../skills/annotant/scripts/lib/store.mjs')
  projects = await import('../skills/annotant/scripts/lib/project.mjs')
})

async function setUp(t) {
  const root = await tempProject(t)
  const comments = store.createStore(projects.project(root))
  const comment = await comments.create({
    route: '/',
    url: 'http://localhost/',
    anchor: { section: '', quote: '', occurrence: 0 },
    body: 'Rework the cards',
  })
  /** @param {string[]} args */
  const ask = (...args) =>
    run(process.execPath, [
      path.join(SCRIPTS, 'ask.mjs'),
      comment.id,
      '--project',
      root,
      ...args,
    ])
  return { root, comments, comment, ask }
}

test('asks a question with options, the reader picking several', async (t) => {
  const { comments, ask } = await setUp(t)
  const asked = await ask(
    'Which layouts?',
    '--option',
    'Grid: Cards in a grid: three per row',
    '--option',
    'List',
    '--multiple',
  )
  assert.equal(asked.code, 0, asked.stderr)
  const [saved] = await comments.readAll()
  assert.ok(store.isAsking(saved))
  assert.deepEqual(saved.messages[saved.messages.length - 1], {
    id: 'm2',
    run: 'r1',
    author: 'claude',
    body: 'Which layouts?',
    at: saved.events[saved.events.length - 1].at,
    question: true,
    options: [
      { label: 'Grid', description: 'Cards in a grid: three per row' },
      { label: 'List' },
    ],
    multiple: true,
  })
})

test('refuses one option, or the same label twice, and asks nothing', async (t) => {
  const { comments, ask } = await setUp(t)
  /** @type {[string[], RegExp][]} */
  const refusals = [
    [['--option', 'Grid'], /2 to 6 options/],
    [['--option', 'Grid', '--option', 'Grid: again'], /its own label/],
    [['--multiple'], /--multiple needs options/],
  ]
  for (const [options, problem] of refusals) {
    const asked = await ask('Which layout?', ...options)
    assert.equal(asked.code, 2)
    assert.match(asked.stderr, problem)
    assert.match(asked.stderr, /--option "<label>: <description>"/)
  }
  const [saved] = await comments.readAll()
  assert.ok(store.isActive(saved))
})

test('says how to ask a question that starts with a dash', async (t) => {
  const { comments, ask } = await setUp(t)
  const refused = await ask('-1px or 0?')
  assert.equal(refused.code, 2)
  // parseArgs's own hint: the text goes after "--".
  assert.match(refused.stderr, /'--'/)
  const asked = await ask('--option', 'Grid', '--option', 'List', '--', '-1px or 0?')
  assert.equal(asked.code, 0, asked.stderr)
  const [saved] = await comments.readAll()
  assert.equal(saved.messages[saved.messages.length - 1].body, '-1px or 0?')
})

test('finds the project given as --project=<dir>', async (t) => {
  const { root, comments, comment } = await setUp(t)
  const asked = await run(
    process.execPath,
    [path.join(SCRIPTS, 'ask.mjs'), comment.id, `--project=${root}`, 'Which blue?'],
    // Elsewhere: the working directory would not find the project.
    { cwd: await tempDir(t) },
  )
  assert.equal(asked.code, 0, asked.stderr)
  assert.ok(store.isAsking((await comments.readAll())[0]))
})
