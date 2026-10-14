import assert from 'node:assert/strict'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { SCRIPTS, run, tempDir, tempProject } from './helpers.mjs'

/** @type {typeof import('../skills/code-buddy/scripts/lib/store.mjs')} */
let store
/** @type {typeof import('../skills/code-buddy/scripts/lib/project.mjs')} */
let projects

before(async (t) => {
  process.env.CODE_BUDDY_STATE_DIR = await tempDir(t)
  store = await import('../skills/code-buddy/scripts/lib/store.mjs')
  projects = await import('../skills/code-buddy/scripts/lib/project.mjs')
})

test('prints the project it found, for the hooks, which cannot see the shell directory', async (t) => {
  const root = await tempProject(t)
  const comment = await store.createStore(projects.project(root)).create({
    route: '/',
    url: 'http://localhost/',
    anchor: { section: '', quote: '', occurrence: 0 },
    body: 'Make it blue',
  })
  const claimed = await run(
    process.execPath,
    [path.join(SCRIPTS, 'claim.mjs'), comment.id, '--project', '.'],
    { cwd: root },
  )
  assert.equal(claimed.code, 0)
  // The shell's directory, as the operating system names it (/private/var on macOS).
  const found = await realpath(root)
  assert.equal(claimed.stdout, `claimed ${comment.id} (/) project=${found} run=r1\n`)
})

test('records the agent the hooks name in the run it opens', async (t) => {
  const root = await tempProject(t)
  const comments = store.createStore(projects.project(root))
  const comment = await comments.create({
    route: '/',
    anchor: { section: '', quote: '', occurrence: 0 },
    body: 'Make it blue',
  })
  const claimed = await run(
    process.execPath,
    [path.join(SCRIPTS, 'claim.mjs'), comment.id, '--project', root],
    { env: { CODE_BUDDY_AGENT: 'a1b2c3' } },
  )
  assert.equal(claimed.code, 0, claimed.stderr)
  const [saved] = await comments.readAll()
  assert.deepEqual(saved.events[saved.events.length - 1], {
    at: saved.events[saved.events.length - 1].at,
    state: 'working',
    by: 'agent',
    run: 'r1',
    agent: 'a1b2c3',
  })
})

test('refuses a comment that waits on the reader, and says to stop', async (t) => {
  const root = await tempProject(t)
  const comments = store.createStore(projects.project(root))
  const comment = await comments.create({
    route: '/',
    anchor: { section: '', quote: '', occurrence: 0 },
    body: 'Make it blue',
  })
  await comments.answer(comment.id, 'Which blue?', { question: true })
  const claimed = await run(process.execPath, [
    path.join(SCRIPTS, 'claim.mjs'),
    comment.id,
    '--project',
    root,
  ])
  assert.equal(claimed.code, 1)
  assert.equal(
    claimed.stderr,
    `comment ${comment.id} is waiting on the reader's answer; stop working on it\n`,
  )
})

test('records the model the hooks routed the comment to, and its label', async (t) => {
  const root = await tempProject(t)
  const comments = store.createStore(projects.project(root))
  const comment = await comments.create({
    route: '/',
    anchor: { section: '', quote: '', occurrence: 0 },
    body: 'Make it blue',
  })
  const claimed = await run(
    process.execPath,
    [path.join(SCRIPTS, 'claim.mjs'), comment.id, '--project', root],
    {
      env: {
        CODE_BUDDY_AGENT: 'a1b2c3',
        CODE_BUDDY_MODEL: 'claude-haiku-5-5',
        CODE_BUDDY_COMPLEXITY: 'trivial',
      },
    },
  )
  assert.equal(claimed.code, 0, claimed.stderr)
  const [saved] = await comments.readAll()
  const working = saved.events[saved.events.length - 1]
  assert.equal(working.model, 'claude-haiku-5-5')
  assert.equal(working.complexity, 'trivial')
})

test('records the agent, model and label the hooks module left as it started the agent', async (t) => {
  const root = await tempProject(t)
  const project = projects.project(root)
  const comments = store.createStore(project)
  const comment = await comments.create({
    route: '/',
    anchor: { section: '', quote: '', occurrence: 0 },
    body: 'Make it blue',
  })
  const route = store.routePath(project, comment.id)
  await mkdir(path.dirname(route), { recursive: true })
  await writeFile(
    route,
    JSON.stringify({ agent: 'a1b2c3', model: 'claude-haiku-5-5', complexity: 'trivial' }),
  )
  const claimed = await run(process.execPath, [
    path.join(SCRIPTS, 'claim.mjs'),
    comment.id,
    '--project',
    root,
  ])
  assert.equal(claimed.code, 0, claimed.stderr)
  const [saved] = await comments.readAll()
  const working = saved.events[saved.events.length - 1]
  assert.equal(working.agent, 'a1b2c3')
  assert.equal(working.model, 'claude-haiku-5-5')
  assert.equal(working.complexity, 'trivial')
})

test('drops a label the classifier does not give', async (t) => {
  const root = await tempProject(t)
  const comments = store.createStore(projects.project(root))
  const comment = await comments.create({
    route: '/',
    anchor: { section: '', quote: '', occurrence: 0 },
    body: 'Make it blue',
  })
  await comments.claim(comment.id, { model: 'claude-opus-5-5', complexity: 'epic' })
  const [saved] = await comments.readAll()
  const working = saved.events[saved.events.length - 1]
  assert.equal(working.model, 'claude-opus-5-5')
  assert.equal('complexity' in working, false)
})
