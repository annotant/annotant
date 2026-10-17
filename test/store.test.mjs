import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { appendFile, chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { tempDir, tempProject } from './helpers.mjs'

/** Writes steps as the hooks module does, one JSON line each. */
async function appendProgress(project, comment, ...steps) {
  await mkdir(project.progressDir, { recursive: true })
  await appendFile(
    path.join(project.progressDir, `${comment}.jsonl`),
    steps.map((step) => `${JSON.stringify(step)}\n`).join(''),
  )
}

/** @type {typeof import('../skills/code-buddy/scripts/lib/store.mjs')} */
let store
/** @type {typeof import('../skills/code-buddy/scripts/lib/project.mjs')} */
let projects

before(async (t) => {
  process.env.CODE_BUDDY_STATE_DIR = await tempDir(t)
  store = await import('../skills/code-buddy/scripts/lib/store.mjs')
  projects = await import('../skills/code-buddy/scripts/lib/project.mjs')
})

async function setUp(t) {
  const project = projects.project(await tempProject(t))
  const comments = store.createStore(project)
  const comment = await comments.create({
    route: '/',
    url: 'http://localhost/',
    anchor: { section: '', quote: '', occurrence: 0 },
    body: 'Make it blue',
  })
  return { project, comments, comment }
}

const claim = (comments, id) => comments.claim(id)

/**
 * The reader's move, on a comment the test knows exists.
 * @param {ReturnType<typeof store.createStore>} comments
 * @param {string} id
 * @param {Parameters<ReturnType<typeof store.createStore>['update']>[1]} patch
 */
async function update(comments, id, patch) {
  const updated = await comments.update(id, patch)
  assert.ok(updated)
  return updated
}

/** @template T @param {T[]} list @returns {T} */
const lastOf = (list) => list[list.length - 1]

/** The states the comment went through, oldest first. */
const statesOf = (comment) => comment.events.map((event) => event.state)

test('an answer resolves the comment, without the run log in comments.json', async (t) => {
  const { project, comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  await appendProgress(project, comment.id, {
    at: 1,
    kind: 'thinking',
    label: 'secret plan',
  })
  await comments.answer(comment.id, 'Done: it is blue now.')
  const [saved] = await comments.readAll()
  assert.equal(saved.state, 'resolved')
  assert.deepEqual(statesOf(saved), ['open', 'working', 'resolved'])
  // The whole thread, the reader's comment first; the answer names its run.
  assert.deepEqual(
    saved.messages.map((m) => [m.id, m.author, m.body, m.run]),
    [
      ['m1', 'reader', 'Make it blue', undefined],
      ['m2', 'claude', 'Done: it is blue now.', 'r1'],
    ],
  )
  const file = JSON.parse(await readFile(project.commentsFile, 'utf8'))
  assert.equal(file.version, 2)
  assert.doesNotMatch(await readFile(project.commentsFile, 'utf8'), /secret plan/)
  assert.equal(existsSync(path.join(project.progressDir, `${comment.id}.jsonl`)), false)
})

test('a question leaves the comment open, waiting on the reader', async (t) => {
  const { comments, comment } = await setUp(t)
  const asked = await comments.answer(comment.id, 'Which blue?', { question: true })
  assert.equal(asked.state, 'asking')
  assert.equal(store.isActive(asked), false)
  assert.equal(store.isAsking(asked), true)
  await assert.rejects(comments.answer(comment.id, 'Guessed'), store.StoreRefusal)
})

const LAYOUTS = [
  { label: 'Grid', description: 'Cards in a grid' },
  { label: 'List' },
  { label: 'Table' },
]

test("the reader's choice answers a question with options", async (t) => {
  const { comments, comment } = await setUp(t)
  await comments.answer(comment.id, 'Which layout?', { question: true, options: LAYOUTS })
  const answered = await update(comments, comment.id, {
    choices: ['List', 'Grid', 'Carousel'],
    followUp: 'With bigger gaps',
  })
  assert.equal(store.isActive(answered), true)
  const [, asked, reply] = answered.messages
  assert.deepEqual(asked.options, LAYOUTS)
  assert.equal(asked.multiple, undefined)
  // One option only, among those offered, then the reader's own words.
  assert.deepEqual(reply.choices, ['Grid'])
  assert.equal(reply.body, 'Grid\n\nWith bigger gaps')
})

test('a multiple-choice question takes several options, in their order', async (t) => {
  const { comments, comment } = await setUp(t)
  await comments.answer(comment.id, 'Which layouts?', {
    question: true,
    options: LAYOUTS,
    multiple: true,
  })
  const answered = await update(comments, comment.id, { choices: ['Table', 'Grid'] })
  assert.deepEqual(lastOf(answered.messages).choices, ['Grid', 'Table'])
  assert.equal(lastOf(answered.messages).body, 'Grid, Table')
})

test("the reader's new words, sent again, drop the options they had chosen", async (t) => {
  const { comments, comment } = await setUp(t)
  await comments.answer(comment.id, 'Which layout?', { question: true, options: LAYOUTS })
  await update(comments, comment.id, { choices: ['Grid'] })
  await update(comments, comment.id, { cancelled: true })
  const resent = await update(comments, comment.id, {
    text: 'List please',
    cancelled: false,
  })
  const last = lastOf(resent.messages)
  assert.equal(last.body, 'List please')
  assert.equal(last.choices, undefined)
})

test('choices outside a question with options are ignored', async (t) => {
  const { comments, comment } = await setUp(t)
  await comments.answer(comment.id, 'Which blue?', { question: true })
  const unchanged = await update(comments, comment.id, { choices: ['Grid'] })
  assert.ok(store.isAsking(unchanged))
  assert.equal(unchanged.messages.length, 2)
})

test('only a claimed comment shows progress, a tool merged from start to end', async (t) => {
  const { project, comments, comment } = await setUp(t)
  await appendProgress(project, comment.id, {
    at: 1,
    id: 't1',
    kind: 'read',
    label: 'a.ts',
    state: 'running',
  })
  assert.equal((await comments.list('/'))[0].progress, undefined)
  await claim(comments, comment.id)
  await appendProgress(project, comment.id, {
    at: 2,
    id: 't1',
    kind: 'read',
    label: 'a.ts',
    state: 'done',
  })
  const [listed] = await comments.list('/')
  assert.deepEqual(listed.progress, [
    { at: 1, id: 't1', kind: 'read', label: 'a.ts', state: 'done' },
  ])
})

test("an agent's Understood line stays served once later steps push it out of progress", async (t) => {
  const { project, comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  await appendProgress(
    project,
    comment.id,
    { at: 1, kind: 'thinking', label: 'Understood: not said to the reader' },
    {
      at: 2,
      kind: 'message',
      label: 'I read the card. **Understood:** the title becomes "Plans", in Home.tsx',
    },
    ...Array.from({ length: 12 }, (_, i) => ({ at: 3 + i, kind: 'thinking', label: '' })),
  )
  const [listed] = await comments.list('/')
  assert.equal(listed.progress?.length, 10)
  assert.equal(listed.understood, 'the title becomes "Plans", in Home.tsx')
})

test('after an edit, the latest Understood line replaces the first', async (t) => {
  const { project, comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  await appendProgress(
    project,
    comment.id,
    { at: 1, kind: 'message', label: 'Understood: the card title' },
    { at: 2, kind: 'message', label: 'Understood: the page title, in index.html' },
  )
  assert.equal((await comments.list('/'))[0].understood, 'the page title, in index.html')
})

test('steps show in the order they happened, whichever process wrote one first', async (t) => {
  const { project, comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  // The hooks module notes the thinking after hook.mjs started the tool.
  await appendProgress(
    project,
    comment.id,
    { at: 2, id: 't1', kind: 'edit', label: 'a.ts', state: 'running' },
    { at: 1, kind: 'thinking', label: '' },
    { at: 3, id: 't1', kind: 'edit', label: 'a.ts', state: 'done' },
  )
  const [listed] = await comments.list('/')
  assert.deepEqual(listed.progress, [
    { at: 1, kind: 'thinking', label: '' },
    { at: 2, id: 't1', kind: 'edit', label: 'a.ts', state: 'done' },
  ])
})

test('a cancellation lists the files written and counts tools, not narration', async (t) => {
  const { project, comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  await appendProgress(
    project,
    comment.id,
    { at: 1, kind: 'thinking', label: '' },
    { at: 2, kind: 'message', label: 'Editing the header' },
    { at: 3, id: 'a', kind: 'edit', label: 'src/a.ts', state: 'done' },
    { at: 4, id: 'b', kind: 'edit', label: 'src/b.ts', state: 'failed' },
    { at: 5, id: 'c', kind: 'read', label: 'src/c.ts', state: 'done' },
  )
  const cancelled = await update(comments, comment.id, { cancelled: true })
  assert.equal(cancelled.state, 'stopped')
  assert.ok(cancelled.cancellation)
  assert.deepEqual(cancelled.cancellation.changed, ['src/a.ts'])
  assert.equal(cancelled.cancellation.steps, 3)
  assert.equal(cancelled.cancellation.run, 'r1')
  assert.deepEqual(cancelled.events.at(-1), {
    at: lastOf(cancelled.events).at,
    state: 'stopped',
    by: 'reader',
    run: 'r1',
  })
})

test('with a dev widget, the debug history keeps every run, and goes with the comment', async (t) => {
  const { project, comment } = await setUp(t)
  const comments = store.createStore(project, { history: true })
  const history = path.join(project.progressDir, `${comment.id}.history.jsonl`)
  await claim(comments, comment.id)
  await appendProgress(
    project,
    comment.id,
    { at: 1, id: 't1', kind: 'read', label: 'a.ts', state: 'running' },
    { at: 2, id: 't1', kind: 'read', label: 'a.ts', state: 'done' },
  )
  await comments.answer(comment.id, 'Which colour?', { question: true })
  // The reader answers: a second run, still going.
  await update(comments, comment.id, { followUp: 'Blue' })
  await claim(comments, comment.id)
  await appendProgress(project, comment.id, {
    at: 3,
    id: 't2',
    kind: 'edit',
    label: 'b.ts',
    state: 'running',
  })

  assert.equal((await comments.list('/'))[0].history, undefined)
  const [listed] = await comments.list('/', { history: true })
  // A run that ended tags the steps the hooks left untagged.
  assert.deepEqual(listed.history, [
    { at: 1, id: 't1', kind: 'read', label: 'a.ts', state: 'done', run: 'r1' },
    { at: 3, id: 't2', kind: 'edit', label: 'b.ts', state: 'running' },
  ])

  await comments.remove(comment.id)
  assert.equal(existsSync(history), false)
})

test('with a released widget, a run leaves no history', async (t) => {
  const { project, comment } = await setUp(t)
  const comments = store.createStore(project, { history: false })
  await claim(comments, comment.id)
  await appendProgress(project, comment.id, { at: 1, kind: 'thinking', label: 'plan' })
  await comments.answer(comment.id, 'Done.')
  assert.equal(
    existsSync(path.join(project.progressDir, `${comment.id}.history.jsonl`)),
    false,
  )
})

test('a move outside the graph is refused, and writes nothing', async (t) => {
  const { project, comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  // Working: no follow-up from the reader.
  await assert.rejects(
    comments.update(comment.id, { followUp: 'And red' }),
    /is being worked on/,
  )
  await comments.answer(comment.id, 'Done.')
  const resolved = await readFile(project.commentsFile, 'utf8')
  await assert.rejects(comments.claim(comment.id), /is resolved/)
  await assert.rejects(comments.answer(comment.id, 'Again'), store.StoreRefusal)
  assert.equal(await readFile(project.commentsFile, 'utf8'), resolved)
  const [saved] = await comments.readAll()
  assert.deepEqual(statesOf(saved), ['open', 'working', 'resolved'])
})

test('the same move twice, as a double click sends it, changes nothing', async (t) => {
  const { comments, comment } = await setUp(t)
  // Stopped before any agent claimed it.
  await update(comments, comment.id, { cancelled: true })
  const again = await update(comments, comment.id, { cancelled: true })
  assert.deepEqual(statesOf(again), ['open', 'stopped'])
  await update(comments, comment.id, { status: 'resolved' })
  const resolved = await update(comments, comment.id, { status: 'resolved' })
  assert.deepEqual(statesOf(resolved), ['open', 'stopped', 'resolved'])
})

test('two questions give two asking events, each run its own', async (t) => {
  const { comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  await comments.answer(comment.id, 'Which blue?', { question: true })
  await update(comments, comment.id, { followUp: 'Navy' })
  const { run } = await claim(comments, comment.id)
  assert.equal(run, 'r2')
  // Claimed again while working: the same run.
  assert.equal((await claim(comments, comment.id)).run, 'r2')
  const asked = await comments.answer(comment.id, 'Darker?', { question: true })
  assert.deepEqual(
    asked.events.map((event) => [event.state, event.by, event.run]),
    [
      ['open', 'reader', undefined],
      ['working', 'agent', 'r1'],
      ['asking', 'agent', 'r1'],
      ['open', 'reader', undefined],
      ['working', 'agent', 'r2'],
      ['asking', 'agent', 'r2'],
    ],
  )
  assert.deepEqual(
    asked.messages.map((message) => [message.id, message.author, message.run]),
    [
      ['m1', 'reader', undefined],
      ['m2', 'claude', 'r1'],
      ['m3', 'reader', undefined],
      ['m4', 'claude', 'r2'],
    ],
  )
})

test('a stop or a re-send the comment is past changes nothing', async (t) => {
  const { comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  const asked = await comments.answer(comment.id, 'Which blue?', { question: true })
  // Clicked a poll late: Claude had just asked.
  await update(comments, comment.id, { cancelled: true })
  const resent = await update(comments, comment.id, { cancelled: false, text: 'Red' })
  assert.deepEqual(statesOf(resent), statesOf(asked))
  assert.deepEqual(resent.messages, asked.messages)
})

test('the reader resolving a working comment ends its run', async (t) => {
  const { project, comment } = await setUp(t)
  const comments = store.createStore(project, { history: true })
  await claim(comments, comment.id)
  await appendProgress(project, comment.id, { at: 1, kind: 'read', label: 'a.ts' })
  const resolved = await update(comments, comment.id, { status: 'resolved' })
  assert.deepEqual(lastOf(resolved.events), {
    at: lastOf(resolved.events).at,
    state: 'resolved',
    by: 'reader',
    run: 'r1',
  })
  assert.equal(existsSync(path.join(project.progressDir, `${comment.id}.jsonl`)), false)
  const [listed] = await comments.list('/', { history: true })
  assert.deepEqual(listed.history, [{ at: 1, kind: 'read', label: 'a.ts', run: 'r1' }])
})

test('a follow-up reopens a resolved comment; a re-send keeps the thread', async (t) => {
  const { comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  await comments.answer(comment.id, 'Done.')
  const reopened = await update(comments, comment.id, { followUp: 'Bluer' })
  assert.equal(reopened.state, 'open')
  assert.deepEqual(
    reopened.messages.map((m) => [m.id, m.author, m.body]),
    [
      ['m1', 'reader', 'Make it blue'],
      ['m2', 'claude', 'Done.'],
      ['m3', 'reader', 'Bluer'],
    ],
  )
  await update(comments, comment.id, { cancelled: true })
  const resent = await update(comments, comment.id, { cancelled: false })
  assert.deepEqual(resent.messages, reopened.messages)
  assert.deepEqual(statesOf(resent).slice(-3), ['open', 'stopped', 'open'])
})

test("once resolved, Claude's answers wait on the reader, who resolves", async (t) => {
  const { comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  await comments.answer(comment.id, 'Bigger.')
  await update(comments, comment.id, { followUp: 'Bolder too' })
  await claim(comments, comment.id)
  const answered = await comments.answer(comment.id, 'Bolder.')
  assert.equal(answered.state, 'answered')
  assert.equal(store.isActive(answered), false)
  // An agent claims it only once the reader follows up again.
  await assert.rejects(comments.claim(comment.id), /answered, waiting on the reader/)
  const resolved = await update(comments, comment.id, { status: 'resolved' })
  assert.deepEqual(statesOf(resolved).slice(-3), ['working', 'answered', 'resolved'])
  assert.equal(lastOf(resolved.events).by, 'reader')
})

test('a stop is dated once: its event and its cancellation agree', async (t) => {
  const { comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  const stopped = await update(comments, comment.id, { cancelled: true })
  assert.ok(stopped.cancellation)
  assert.equal(stopped.cancellation.at, lastOf(stopped.events).at)
})

test('refuses a file in the old format, and leaves it untouched', async (t) => {
  const project = projects.project(await tempProject(t))
  const comments = store.createStore(project)
  const old = JSON.stringify([{ id: 'c1', status: 'open', body: 'Make it blue' }])
  await mkdir(path.dirname(project.commentsFile), { recursive: true })
  await writeFile(project.commentsFile, old)
  await assert.rejects(comments.readAll(), {
    message: `old comments format: delete ${project.commentsFile}`,
  })
  await assert.rejects(
    comments.create({
      route: '/',
      anchor: { section: '', quote: '', occurrence: 0 },
      body: 'More',
    }),
    store.StoreRefusal,
  )
  assert.equal(await readFile(project.commentsFile, 'utf8'), old)
})

test('the step files read as on disk: the ended runs, then the current one', async (t) => {
  const { project, comment } = await setUp(t)
  const comments = store.createStore(project, { history: true })
  assert.equal(await store.stepFiles(project, comment.id), '')
  await claim(comments, comment.id)
  await appendProgress(project, comment.id, { at: 1, kind: 'read', label: 'a.ts' })
  await comments.answer(comment.id, 'Which colour?', { question: true })
  await update(comments, comment.id, { followUp: 'Blue' })
  await claim(comments, comment.id)
  await appendProgress(project, comment.id, { at: 2, kind: 'edit', label: 'b.ts' })
  assert.equal(
    await store.stepFiles(project, comment.id),
    '{"at":1,"kind":"read","label":"a.ts","run":"r1"}\n' +
      '{"at":2,"kind":"edit","label":"b.ts"}\n',
  )
})

test('only a dev build of the widget counts as one', async (t) => {
  const dir = await tempDir(t)
  const dev = path.join(dir, 'dev.js')
  const release = path.join(dir, 'release.js')
  await writeFile(dev, '/* code-buddy widget (dev build, with the debug panel): x */')
  await writeFile(release, '/* code-buddy widget: served by the code-buddy skill */')
  assert.equal(projects.isDevWidget(dev), true)
  assert.equal(projects.isDevWidget(release), false)
  assert.equal(projects.isDevWidget(path.join(dir, 'missing.js')), false)
})

/** The first bytes of a PNG file: enough for the store, which writes what it is given. */
const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

test("the reader's images go beside the comments file, and with the comment", async (t) => {
  const project = projects.project(await tempProject(t))
  const comments = store.createStore(project)
  const comment = await comments.create({
    route: '/',
    anchor: { section: '', quote: '', occurrence: 0 },
    body: 'Like this',
    images: [
      { data: PNG, ext: 'png' },
      { data: PNG, ext: 'png' },
    ],
  })
  assert.deepEqual(comment.messages[0].images, ['m1-1.png', 'm1-2.png'])
  const dir = path.join(path.dirname(project.commentsFile), 'images', comment.id)
  assert.deepEqual(await readFile(path.join(dir, 'm1-2.png')), PNG)

  await claim(comments, comment.id)
  await comments.answer(comment.id, 'Done.')
  const reopened = await update(comments, comment.id, {
    followUp: 'And this',
    images: [{ data: PNG, ext: 'png' }],
  })
  assert.deepEqual(lastOf(reopened.messages).images, ['m3-1.png'])
  assert.equal(existsSync(path.join(dir, 'm3-1.png')), true)

  await comments.remove(comment.id)
  assert.equal(existsSync(dir), false)
})

test('a reply the comment refuses leaves no image behind', async (t) => {
  const { project, comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  await assert.rejects(
    comments.update(comment.id, { followUp: 'Now', images: [{ data: PNG, ext: 'png' }] }),
    store.StoreRefusal,
  )
  const dir = path.join(path.dirname(project.commentsFile), 'images', comment.id)
  assert.equal(existsSync(dir), false)
})

test('a comment left unsaved leaves no image behind', async (t) => {
  const project = projects.project(await tempProject(t))
  const comments = store.createStore(project)
  // The comments file cannot be written: its temp file's place is taken.
  await mkdir(`${project.commentsFile}.${process.pid}.tmp`, { recursive: true })
  await assert.rejects(
    comments.create({
      route: '/',
      anchor: { section: '', quote: '', occurrence: 0 },
      body: 'Like this',
      images: [{ data: PNG, ext: 'png' }],
    }),
  )
  const images = path.join(path.dirname(project.commentsFile), 'images')
  assert.deepEqual(existsSync(images) ? await readdir(images) : [], [])
})

test('a reply with an image that cannot be written leaves none behind', async (t) => {
  const { project, comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  await comments.answer(comment.id, 'Done.')
  const dir = path.join(path.dirname(project.commentsFile), 'images', comment.id)
  // The second image's place is taken: the first, written, goes too, and the
  // error is the write's, not the cleanup's.
  await mkdir(path.join(dir, 'm3-2.png'), { recursive: true })
  await assert.rejects(
    comments.update(comment.id, {
      followUp: 'Like these',
      images: [
        { data: PNG, ext: 'png' },
        { data: PNG, ext: 'png' },
      ],
    }),
    { code: 'EISDIR' },
  )
  assert.equal(existsSync(path.join(dir, 'm3-1.png')), false)
  const kept = await comments.list()
  assert.equal(kept.find((entry) => entry.id === comment.id)?.messages.length, 2)
})

test('a stopped comment with an image goes again with its words removed', async (t) => {
  const project = projects.project(await tempProject(t))
  const comments = store.createStore(project)
  const comment = await comments.create({
    route: '/',
    anchor: { section: '', quote: '', occurrence: 0 },
    body: 'Make it red',
    images: [{ data: PNG, ext: 'png' }],
  })
  await update(comments, comment.id, { cancelled: true })
  const resent = await update(comments, comment.id, { cancelled: false, text: '' })
  assert.deepEqual(
    resent.messages.map((m) => [m.body, m.images]),
    [['', ['m1-1.png']]],
  )
})

test('a stopped comment without an image keeps its words when sent again with none', async (t) => {
  const { comments, comment } = await setUp(t)
  await update(comments, comment.id, { cancelled: true })
  const resent = await update(comments, comment.id, { cancelled: false, text: '' })
  assert.equal(resent.messages[0].body, 'Make it blue')
})

test("a reply left unsaved removes its images, not the thread's earlier ones", async (t) => {
  const project = projects.project(await tempProject(t))
  const comments = store.createStore(project)
  const comment = await comments.create({
    route: '/',
    anchor: { section: '', quote: '', occurrence: 0 },
    body: 'Like this',
    images: [{ data: PNG, ext: 'png' }],
  })
  await claim(comments, comment.id)
  await comments.answer(comment.id, 'Done.')
  // The comments file cannot be written: its temp file's place is taken.
  await mkdir(`${project.commentsFile}.${process.pid}.tmp`, { recursive: true })
  await assert.rejects(
    comments.update(comment.id, {
      followUp: 'And this',
      images: [{ data: PNG, ext: 'png' }],
    }),
  )
  const dir = path.join(path.dirname(project.commentsFile), 'images', comment.id)
  assert.deepEqual(await readdir(dir), ['m1-1.png'])
})

test("a reply's options and images go together", async (t) => {
  const { comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  await comments.answer(comment.id, 'Which layout?', { question: true, options: LAYOUTS })
  const answered = await update(comments, comment.id, {
    choices: [LAYOUTS[0].label],
    images: [{ data: PNG, ext: 'png' }],
  })
  const reply = lastOf(answered.messages)
  assert.deepEqual([reply.choices, reply.images], [[LAYOUTS[0].label], ['m3-1.png']])
})

test('a comment whose images cannot be removed is still deleted', async (t) => {
  const project = projects.project(await tempProject(t))
  const comments = store.createStore(project)
  const comment = await comments.create({
    route: '/',
    anchor: { section: '', quote: '', occurrence: 0 },
    body: 'Like this',
    images: [{ data: PNG, ext: 'png' }],
  })
  const images = path.join(path.dirname(project.commentsFile), 'images')
  // Its folder cannot go: the folder holding it is read-only.
  await chmod(images, 0o555)
  try {
    assert.equal(await comments.remove(comment.id), true)
  } finally {
    await chmod(images, 0o755)
  }
  assert.deepEqual(await comments.list(), [])
})
