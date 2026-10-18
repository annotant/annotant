// scripts/hook.mjs, run as Claude Code runs a comment's agent's hooks: the
// event as JSON on stdin, a deny as JSON on stdout.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { SCRIPTS, run, tempDir, tempProject } from './helpers.mjs'

/** @type {typeof import('../skills/code-buddy/scripts/lib/store.mjs')} */
let store
/** @type {typeof import('../skills/code-buddy/scripts/lib/project.mjs')} */
let projects
/** @type {string} */
let stateDir

before(async (t) => {
  stateDir = await tempDir(t)
  process.env.CODE_BUDDY_STATE_DIR = stateDir
  store = await import('../skills/code-buddy/scripts/lib/store.mjs')
  projects = await import('../skills/code-buddy/scripts/lib/project.mjs')
})

const HOOK = path.join(SCRIPTS, 'hook.mjs')
let ids = 0

/**
 * A project with comments, each one open; `lockRoot`: the repository it is in,
 * `folder` the project's folder there.
 * @param {import('node:test').TestContext} t
 * @param {number} [count]
 * @param {{ lockRoot?: string, folder?: string }} [options]
 */
async function world(t, count = 1, { lockRoot, folder = 'web' } = {}) {
  const root = lockRoot ? path.join(lockRoot, folder) : await tempProject(t)
  if (lockRoot) {
    await mkdir(root, { recursive: true })
    await writeFile(
      path.join(root, '.code-buddy.json'),
      JSON.stringify({ version: 1, commentsFile: '.code-buddy/comments.json' }),
    )
  }
  const project = projects.project(root)
  const comments = store.createStore(project, { history: false })
  const created = []
  for (let i = 0; i < count; i++) {
    created.push(
      await comments.create({
        route: '/',
        anchor: { section: '', quote: '', occurrence: 0 },
        body: `Comment ${i + 1}`,
      }),
    )
  }
  /**
   * Runs the hook of comment `index`'s agent.
   * @param {number} index
   * @param {string} mode
   * @param {Record<string, unknown> | string} [event] A string as is.
   */
  const hook = async (index, mode, event = {}) => {
    const ran = await run(
      process.execPath,
      [
        HOOK,
        mode,
        '--comment',
        created[index].id,
        '--project',
        root,
        ...(lockRoot ? ['--lock-root', lockRoot] : []),
      ],
      {
        input:
          typeof event === 'string'
            ? event
            : JSON.stringify({ agent_id: `a${index + 1}`, ...event }),
        env: { CODE_BUDDY_STATE_DIR: stateDir, CODE_BUDDY_LOCK_WAIT_MS: '300' },
      },
    )
    assert.equal(ran.code, 0, ran.stderr)
    return ran.stdout
      ? JSON.parse(ran.stdout).hookSpecificOutput.permissionDecisionReason
      : undefined
  }
  /**
   * A tool's two hooks, `between` run between them; the deny when pre refuses it.
   * @param {number} index
   * @param {string} name
   * @param {Record<string, unknown>} input
   * @param {{ between?: () => Promise<unknown>, error?: string }} [options]
   */
  const tool = async (index, name, input, { between, error } = {}) => {
    const event = { tool_name: name, tool_input: input, tool_use_id: `t${++ids}` }
    const deny = await hook(index, 'pre', event)
    if (deny) return deny
    await between?.()
    await hook(index, 'post', error ? { ...event, error } : event)
    return undefined
  }
  const id = (index) => created[index].id
  const claim = (index) =>
    tool(
      index,
      'Bash',
      { command: `node ${SCRIPTS}claim.mjs ${id(index)} --project ${root}` },
      {
        between: () =>
          comments.claim(id(index), { model: 'claude-haiku-5-5', complexity: 'trivial' }),
      },
    )
  const progress = async (index) =>
    (await readFile(store.progressPath(project, id(index)), 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  /** Moves the comment as the reader would, in the file. */
  const setState = async (index, state) => {
    const file = JSON.parse(await readFile(project.commentsFile, 'utf8'))
    file.comments.find((one) => one.id === id(index)).state = state
    await writeFile(project.commentsFile, JSON.stringify(file))
  }
  return { root, project, comments, hook, tool, claim, progress, setState, id }
}

const edit = (file) => ({ file_path: file, old_string: 'a', new_string: 'b' })

test("records a claimed run's steps, and ends the run on resolve", async (t) => {
  const w = await world(t, 2)
  await w.tool(0, 'Read', { file_path: path.join(w.root, '.code-buddy.json') })
  await w.claim(0)
  await w.tool(0, 'Edit', edit(path.join(w.root, 'src/App.tsx')))
  const steps = await w.progress(0)
  // Nothing before the claim: no run yet. The Started step names the model.
  assert.deepEqual(
    steps.map((step) => ({
      kind: step.kind,
      label: step.label,
      state: step.state,
      run: step.run,
      agent: step.agent,
    })),
    [
      { kind: 'start', label: 'Started', state: 'done', run: 'r1', agent: 'a1' },
      { kind: 'edit', label: 'src/App.tsx', state: 'running', run: 'r1', agent: 'a1' },
      { kind: 'edit', label: 'src/App.tsx', state: 'done', run: 'r1', agent: 'a1' },
    ],
  )
  assert.equal(steps[0].model, 'claude-haiku-5-5')
  assert.equal(steps[0].complexity, 'trivial')

  await w.tool(
    0,
    'Bash',
    { command: `node ${SCRIPTS}resolve.mjs ${w.id(0)} --project . "Done."` },
    { between: () => w.comments.answer(w.id(0), 'Done.') },
  )
  assert.deepEqual(await w.progress(0), [])
  // Its locks went with the run.
  await w.claim(1)
  assert.equal(await w.tool(1, 'Edit', edit(path.join(w.root, 'src/App.tsx'))), undefined)
})

test("refuses a file another comment's agent holds, after the wait", async (t) => {
  const w = await world(t, 2)
  await w.claim(0)
  await w.claim(1)
  assert.equal(
    await w.tool(1, 'Edit', edit(path.join(w.root, 'src/Other.tsx'))),
    undefined,
  )
  assert.equal(await w.tool(0, 'Edit', edit(path.join(w.root, 'src/App.tsx'))), undefined)

  const deny = await w.tool(1, 'Edit', edit(path.join(w.root, 'src/App.tsx')))
  assert.match(
    deny ?? '',
    new RegExp(`src/App\\.tsx is being changed by the agent of comment ${w.id(0)}`),
  )
  assert.match(deny ?? '', /Your 1 lock\(s\) were released/)
  assert.equal((await w.progress(1)).at(-1).state, 'failed')
  // The second agent let src/Other.tsx go: the first takes it at once.
  assert.equal(
    await w.tool(0, 'Edit', edit(path.join(w.root, 'src/Other.tsx'))),
    undefined,
  )
})

test('an agent that stops holds nothing; one whose comment ended neither', async (t) => {
  const w = await world(t, 3)
  for (const index of [0, 1, 2]) await w.claim(index)
  await w.tool(0, 'Edit', edit(path.join(w.root, 'src/App.tsx')))
  await w.hook(0, 'stop', { hook_event_name: 'Stop' })
  assert.equal(await w.tool(1, 'Edit', edit(path.join(w.root, 'src/App.tsx'))), undefined)
  // The reader stopped comment 2: its agent's lock is stale.
  await w.setState(1, 'stopped')
  assert.equal(await w.tool(2, 'Edit', edit(path.join(w.root, 'src/App.tsx'))), undefined)
})

test('tells an agent whose comment the reader cancelled to stop, or that waits on them', async (t) => {
  const w = await world(t)
  await w.claim(0)
  for (const state of ['stopped', 'asking']) {
    await w.setState(0, state)
    assert.match(
      (await w.tool(0, 'Edit', edit(path.join(w.root, 'src/App.tsx')))) ?? '',
      /reply "CANCELLED"/,
    )
  }
})

test('refuses a Bash command that writes files, which no lock covers', async (t) => {
  const w = await world(t)
  await w.claim(0)
  const writes = [
    `python3 - <<'EOF'\np='src/a.ts'\nopen(p, 'w').write('x')\nEOF`,
    `python3 -c "import pathlib; pathlib.Path('src/a.ts').write_text('x')"`,
    `node -e "require('fs').writeFileSync('src/a.ts', 'x')"`,
    `sed -i '' 's/a/b/' src/a.ts`,
    `perl -pi -e 's/a/b/' src/a.ts`,
    `cat > src/a.ts <<'EOF'\nx\nEOF`,
    `echo x | tee src/a.ts`,
  ]
  for (const command of writes) {
    assert.match(
      (await w.tool(0, 'Bash', { command })) ?? '',
      /Edit or Write tool/,
      command,
    )
  }
  assert.equal((await w.progress(0)).at(-1).state, 'failed')
  for (const command of ['npm test 2>&1 | tail -20', `sed -n '1,20p' src/a.ts`]) {
    assert.equal(await w.tool(0, 'Bash', { command }), undefined, command)
  }
  // Its answer passes, whatever it quotes.
  const answer = `node ${SCRIPTS}resolve.mjs ${w.id(0)} --project ${w.root} <<'EOF'\nNo more open(p, 'w').\nEOF`
  assert.equal(
    await w.hook(0, 'pre', { tool_name: 'Bash', tool_input: { command: answer } }),
    undefined,
  )
})

test("sends AskUserQuestion to the comment's thread", async (t) => {
  const w = await world(t)
  await w.claim(0)
  const deny = await w.tool(0, 'AskUserQuestion', { questions: [] })
  // The project quoted: a path may hold a space.
  assert.ok(
    deny?.includes(
      `node ${JSON.stringify(path.join(SCRIPTS, 'ask.mjs'))} ${w.id(0)} --project ${JSON.stringify(w.root)} "<question>"`,
    ),
    deny,
  )
  // Not a step the reader sees.
  assert.deepEqual(
    (await w.progress(0)).map((step) => step.kind),
    ['start'],
  )
})

test('locks files across the git repository, outside the project too', async (t) => {
  const repo = await tempDir(t)
  const w = await world(t, 2, { lockRoot: repo })
  await w.claim(0)
  await w.claim(1)
  const shared = path.join(repo, 'scanner/x.py')
  assert.equal(await w.tool(0, 'Edit', edit(shared)), undefined)
  assert.equal((await w.progress(0)).at(-1).label, '../scanner/x.py')
  assert.match(
    (await w.tool(1, 'Edit', edit(shared))) ?? '',
    /scanner\/x\.py is being changed/,
  )
})

test('keeps a lock another project of the repository holds while its comment is at work', async (t) => {
  const repo = await tempDir(t)
  const web = await world(t, 1, { lockRoot: repo })
  const admin = await world(t, 1, { lockRoot: repo, folder: 'admin' })
  await web.claim(0)
  await admin.claim(0)
  const shared = path.join(repo, 'packages/ui/Button.tsx')
  assert.equal(await web.tool(0, 'Edit', edit(shared)), undefined)
  assert.match(
    (await admin.tool(0, 'Edit', edit(shared))) ?? '',
    /packages\/ui\/Button\.tsx is being changed/,
  )
  // Stale once the reader stopped it, in its own project's comments.
  await web.setState(0, 'stopped')
  assert.equal(await admin.tool(0, 'Edit', edit(shared)), undefined)
})

test('lets an agent write from Bash outside the repository, where no lock is needed', async (t) => {
  const repo = await tempDir(t)
  const w = await world(t, 1, { lockRoot: repo })
  await w.claim(0)
  for (const command of [
    `cat > /tmp/scratch/g5.py <<'EOF'\nopen_report()\nEOF`,
    `npm test 2>&1 | tee /tmp/scratch/test.log`,
    `sed -i '' 's/a/b/' /tmp/scratch/notes.txt`,
  ]) {
    assert.equal(await w.tool(0, 'Bash', { command }), undefined, command)
  }
  for (const command of [
    `cat > ${repo}/scanner/x.py <<'EOF'\nX = 1\nEOF`,
    `echo x | tee /tmp/scratch/a.log ${repo}/web/src/a.ts`,
    `python3 -c "open('/tmp/scratch/x', 'w').write('x')"`,
  ]) {
    assert.match(
      (await w.tool(0, 'Bash', { command })) ?? '',
      /Edit or Write tool/,
      command,
    )
  }
})

test('a build holds the build lock until it ends, failed or not', async (t) => {
  const w = await world(t, 2)
  await w.claim(0)
  await w.claim(1)
  let during
  await w.tool(
    0,
    'Bash',
    { command: 'npm run build' },
    {
      between: async () => {
        during = await w.tool(1, 'Bash', { command: 'npx vite build' })
      },
      error: 'Exit code 1',
    },
  )
  assert.match(during ?? '', /@build is being changed/)
  assert.equal((await w.progress(0)).at(-1).error, 'Exit code 1')
  assert.equal(await w.tool(1, 'Bash', { command: 'npx vite build' }), undefined)
})

test("records what the hooks module notes of the agent's thinking, in the run", async (t) => {
  const w = await world(t)
  await w.hook(0, 'note', '{"at":1,"kind":"message","label":"Before the claim"}')
  await w.claim(0)
  await w.hook(
    0,
    'note',
    '{"at":2,"kind":"thinking","label":""}\n{"at":3,"kind":"message","label":"Looking"}',
  )
  const steps = await w.progress(0)
  assert.deepEqual(
    steps.map((step) => [step.kind, step.run]),
    [
      ['start', 'r1'],
      ['thinking', 'r1'],
      ['message', 'r1'],
    ],
  )
})

test('never stands in the way of the tool when it cannot read its input', async (t) => {
  const w = await world(t)
  assert.equal(await w.hook(0, 'pre', 'not json'), undefined)
})
