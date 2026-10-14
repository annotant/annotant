// The hooks module (hooks/register.ts), run by `claude plugin test .` against
// Claude Code itself: the disk, processes and tools beneath it are in memory.
import { expect, mock, test } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

const ROOT = '/repo/web'
const SCRIPTS = '/s/scripts'
const LOG = '/home/u/.cache/code-buddy/hook.log'
const claim = (id: string) => `node ${SCRIPTS}/claim.mjs ${id} --project ${ROOT}`
const resolveCmd = (id: string) =>
  `node ${SCRIPTS}/resolve.mjs ${id} --project ${ROOT} "done"`

type Comment = {
  id: string
  state: string
  route?: string
  anchor?: { quote: string; element?: { tag: string; text: string } }
  messages?: { author: string; body: string }[]
}

/** The comments file, as lib/format.mjs writes it. */
const commentsFile = (comments: Comment[]) => JSON.stringify({ version: 2, comments })

/** The disk, processes and tools beneath the mod, in memory. */
/** `gitRoot`: the repository the project is in, as `git rev-parse` answers. */
function world(on: On, comments: Comment[], { gitRoot }: { gitRoot?: string } = {}) {
  const files = new Map<string, string>([
    [
      `${ROOT}/.code-buddy.json`,
      JSON.stringify({ commentsFile: '.code-buddy/comments.json' }),
    ],
    [`${ROOT}/.code-buddy/comments.json`, commentsFile(comments)],
  ])
  const removed: string[] = []
  // Another process appending to the hook log (an agent's hook.mjs, another
  // session): its line lands right after the mod next reads or appends to it.
  let otherLine: string | undefined
  const otherAppends = (path: string) => {
    if (path !== LOG || otherLine === undefined) return
    files.set(LOG, (files.get(LOG) ?? '') + otherLine)
    otherLine = undefined
  }
  on('fs.read', (_$, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    otherAppends(e.path)
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.version', () => ({ value: { version: '2.1.287' } }))
  on('process.run', (_$, e) => {
    if (e.argv.includes('--show-toplevel')) {
      return {
        value: {
          exitCode: gitRoot ? 0 : 128,
          stdout: gitRoot ? `${gitRoot}\n` : '',
          stderr: gitRoot ? '' : 'fatal: not a git repository',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    }
    // The hook log's appender: `sh -c <script> sh <file> <line> …`.
    if (e.argv[0] === 'sh' && e.argv[1] === '-c') {
      const [file = '', line = ''] = e.argv.slice(4)
      files.set(file, (files.get(file) ?? '') + line)
      otherAppends(file)
    }
    if (e.argv[0] === 'rm') {
      const file = e.argv[e.argv.length - 1] ?? ''
      removed.push(file)
      files.delete(file)
    }
    return {
      value: {
        exitCode: 0,
        stdout: '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('ui.status', () => ({ value: undefined }))
  const env = new Map<string, string | undefined>()
  on('env.set', (_$, e) => {
    env.set(e.name, e.value)
    return { value: undefined }
  })
  // claim.mjs prints the project it found, from the shell's directory, and
  // a new run each time.
  const claims = new Map<string, number>()
  const commands: string[] = []
  on('tool.call', (_$, e) => {
    if (e.tool === 'Bash') commands.push(e.command)
    const claimed =
      e.tool === 'Bash' ? /claim\.mjs (\S+)/.exec(e.command)?.[1] : undefined
    if (claimed === 'gone') return { result: 'ok', text: 'comment gone is resolved\n' }
    const root = claimed === 'moved' ? '/nowhere' : ROOT
    return claimed
      ? {
          result: 'ok',
          text: `claimed ${claimed} (/) project=${root} run=r${claims.set(claimed, (claims.get(claimed) ?? 0) + 1).get(claimed)}\n`,
        }
      : { result: 'ok' }
  })
  on('turn.complete', () => ({ text: '' }))
  // Claude Code starts the agent on the model asked for, else the parent's.
  const spawned: { model?: string; prompt: string }[] = []
  on('agent.spawn', (_$, e) => {
    spawned.push({ model: e.model, prompt: e.prompt })
    const model = { haiku: 'claude-haiku-5-5', opus: 'claude-opus-5-5' }[e.model ?? '']
    return {
      model: model ?? e.model ?? 'claude-sonnet-5-5',
      agentId: `a${spawned.length}`,
    }
  })
  // The classifier: its label, a failed request, or one that never answers.
  let label: string | Error | Promise<string> = 'standard'
  const classified: string[] = []
  on('model.classify', (_$, e) => {
    classified.push(e.text)
    if (label instanceof Error) throw label
    if (label instanceof Promise) return label.then((value) => ({ value }))
    return { value: label }
  })
  mock.env(on, { HOME: '/home/u' })
  const clock = mock.clock(on, { now: 1_000 })

  const progressPath = (id: string) =>
    [...files.keys(), ...removed].find((path) => path.endsWith(`/progress/${id}.jsonl`))
  return {
    file: (path: string) => files.get(path),
    commands,
    spawned,
    classified,
    classifyAs: (next: string | Error | Promise<string>) => {
      label = next
    },
    write: (path: string, text: string) => files.set(path, text),
    appendToLogMeanwhile: (line: string) => {
      otherLine = line
    },
    env,
    clock,
    removed,
    setComments: (next: Comment[]) =>
      files.set(`${ROOT}/.code-buddy/comments.json`, commentsFile(next)),
    progressPath,
    progress: (id: string) =>
      (files.get(progressPath(id) ?? '') ?? '')
        .split('\n')
        .filter(Boolean)
        .map((line): Record<string, unknown> => JSON.parse(line)),
  }
}

let ids = 0
const bash = (agentId: string, command: string) => ({
  tool: 'Bash' as const,
  command,
  tool_use_id: `t${++ids}`,
  agentId,
})
const edit = (agentId: string, file: string) => ({
  tool: 'Edit' as const,
  file_path: file,
  old_string: 'a',
  new_string: 'b',
  tool_use_id: `t${++ids}`,
  agentId,
})

test('a claimed run records its steps and cleans up on resolve', async ($, on) => {
  const w = world(on, [{ id: 'c1', state: 'open' }])

  await $.tool.call(bash('a1', claim('c1')))
  await $.tool.call(edit('a1', `${ROOT}/src/App.tsx`))

  // Each step belongs to the run claim.mjs started.
  expect(w.progress('c1')).toEqual([
    expect.objectContaining({
      kind: 'start',
      label: 'Started',
      state: 'done',
      run: 'r1',
    }),
    expect.objectContaining({
      kind: 'edit',
      label: 'src/App.tsx',
      state: 'running',
      run: 'r1',
    }),
    expect.objectContaining({
      kind: 'edit',
      label: 'src/App.tsx',
      state: 'done',
      run: 'r1',
    }),
  ])
  expect(w.progressPath('c1')).toMatch(
    /^\/home\/u\/\.cache\/code-buddy\/[0-9a-f]{12}\/progress\/c1\.jsonl$/,
  )

  w.setComments([{ id: 'c1', state: 'resolved' }])
  await $.tool.call(bash('a1', resolveCmd('c1')))
  expect(w.removed).toEqual([w.progressPath('c1')])

  // Unbound now: further calls record nothing.
  await $.tool.call(edit('a1', `${ROOT}/src/App.tsx`))
  expect(w.progress('c1')).toEqual([])
})

test('an unbound agent is left alone', async ($, on) => {
  const w = world(on, [{ id: 'c1', state: 'open' }])
  const ran = await $.tool.call(edit('other', `${ROOT}/src/App.tsx`))
  expect(ran.deny).toBeUndefined()
  expect(w.progressPath('c1')).toBeUndefined()
})

// session.append is not covered here: the kit refuses a test hook that
// answers a row without next, and nothing beneath answers it either. It is
// checked live, with a real subagent.

test("a file another comment's agent holds is refused after the wait", async ($, on) => {
  const w = world(on, [
    { id: 'c1', state: 'open' },
    { id: 'c2', state: 'open' },
  ])
  await $.tool.call(bash('a1', claim('c1')))
  await $.tool.call(bash('a2', claim('c2')))
  await $.tool.call(edit('a2', `${ROOT}/src/Other.tsx`))
  await $.tool.call(edit('a1', `${ROOT}/src/App.tsx`))

  const blocked = $.tool.call(edit('a2', `${ROOT}/src/App.tsx`))
  for (let i = 0; i < 40; i++) await w.clock.advance(200)
  const ran = await blocked

  expect(ran.deny ?? ran.text).toMatch(
    /src\/App\.tsx is being changed by the agent of comment c1/,
  )
  expect(ran.deny ?? ran.text).toMatch(/Your 1 lock\(s\) were released/)
  expect(w.progress('c2').at(-1)).toEqual(expect.objectContaining({ state: 'failed' }))

  // a2 released src/Other.tsx: a1 takes it at once.
  expect((await $.tool.call(edit('a1', `${ROOT}/src/Other.tsx`))).deny).toBeUndefined()
})

test('a lock frees once its subagent ends its turn', async ($, on) => {
  const w = world(on, [
    { id: 'c1', state: 'open' },
    { id: 'c2', state: 'open' },
  ])
  await $.tool.call(bash('a1', claim('c1')))
  await $.tool.call(bash('a2', claim('c2')))
  await $.tool.call(edit('a1', `${ROOT}/src/App.tsx`))

  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 'turn',
    agentId: 'a1',
    reason: 'answer',
  })

  expect((await $.tool.call(edit('a2', `${ROOT}/src/App.tsx`))).deny).toBeUndefined()
  void w
})

test('an agent whose comment the reader cancelled is told to stop', async ($, on) => {
  const w = world(on, [{ id: 'c1', state: 'open' }])
  await $.tool.call(bash('a1', claim('c1')))
  w.setComments([{ id: 'c1', state: 'stopped' }])

  const ran = await $.tool.call(edit('a1', `${ROOT}/src/App.tsx`))
  expect(ran.deny ?? ran.text).toMatch(/reply "CANCELLED"/)
})

test('a comment Claude works on stays active; one asking the reader does not', async ($, on) => {
  const w = world(on, [{ id: 'c1', state: 'open' }])
  await $.tool.call(bash('a1', claim('c1')))
  // As claim.mjs writes it.
  w.setComments([{ id: 'c1', state: 'working' }])
  expect((await $.tool.call(edit('a1', `${ROOT}/src/App.tsx`))).deny).toBeUndefined()
  expect(w.progress('c1').at(-1)).toEqual(
    expect.objectContaining({ kind: 'edit', state: 'done' }),
  )

  w.setComments([{ id: 'c1', state: 'asking' }])
  const ran = await $.tool.call(edit('a1', `${ROOT}/src/App.tsx`))
  expect(ran.deny ?? ran.text).toMatch(/reply "CANCELLED"/)
})

test('claim.mjs learns which agent claims, and each step names it', async ($, on) => {
  const w = world(on, [{ id: 'c1', state: 'open' }])
  await $.tool.call(bash('a1', claim('c1')))
  await $.tool.call(edit('a1', `${ROOT}/src/App.tsx`))
  expect(w.commands[0]).toBe(`export CODE_BUDDY_AGENT=a1; ${claim('c1')}`)
  expect(w.progress('c1').map((step) => step.agent)).toEqual(['a1', 'a1', 'a1'])
  // Only the claim: other commands run as the agent wrote them.
  await $.tool.call(bash('a1', 'npm test'))
  expect(w.commands.at(-1)).toBe('npm test')
})

test("a second claim tags the agent's steps with the new run", async ($, on) => {
  const w = world(on, [{ id: 'c1', state: 'open' }])
  await $.tool.call(bash('a1', claim('c1')))
  await $.turn.complete({ turnId: 'turn', agentId: 'a1', reason: 'answer' })
  await $.tool.call(bash('a1', claim('c1')))
  await $.tool.call(edit('a1', `${ROOT}/src/App.tsx`))
  expect(w.progress('c1').map((step) => step.run)).toEqual(['r1', 'r2', 'r2', 'r2'])
})

test('the script that ends a run is done in the history the store keeps', async ($, on) => {
  const w = world(on, [{ id: 'c1', state: 'open' }])
  await $.tool.call(bash('a1', claim('c1')))
  // The store archived the run (a dev widget), resolve.mjs still running.
  const history = (w.progressPath('c1') ?? '').replace(/\.jsonl$/, '.history.jsonl')
  w.write(history, '{"kind":"start"}\n')
  w.setComments([{ id: 'c1', state: 'resolved' }])
  await $.tool.call(bash('a1', resolveCmd('c1')))

  const last = JSON.parse((w.file(history) ?? '').trim().split('\n').at(-1) ?? '{}')
  expect(last).toEqual(
    expect.objectContaining({ kind: 'bash', state: 'done', run: 'r1' }),
  )
})

test('tells the server, through the environment, that the hooks are loaded', async ($, on) => {
  const w = world(on, [])
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(w.env.get('CODE_BUDDY_HOOKS')).toBe('1')
})

test('refuses an agent a Bash command that writes files, which no lock covers', async ($, on) => {
  const w = world(on, [{ id: 'c1', state: 'open' }])
  await $.tool.call(bash('a1', claim('c1')))
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
    const ran = await $.tool.call(bash('a1', command))
    expect(ran.deny ?? ran.text).toMatch(/Edit or Write tool/)
  }
  expect(w.progress('c1').at(-1)).toEqual(expect.objectContaining({ state: 'failed' }))
  for (const command of ['npm test 2>&1 | tail -20', `sed -n '1,20p' src/a.ts`]) {
    expect((await $.tool.call(bash('a1', command))).deny).toBeUndefined()
  }
  // Its answer passes, whatever it quotes.
  const answer = `node ${SCRIPTS}/resolve.mjs c1 --project ${ROOT} <<'EOF'\nNo more open(p, 'w').\nEOF`
  expect((await $.tool.call(bash('a1', answer))).deny).toBeUndefined()
})

const askUser = (agentId: string) => ({
  tool: 'AskUserQuestion' as const,
  questions: [
    {
      question: 'Which layout?',
      header: 'Layout',
      multiSelect: false,
      options: [
        { label: 'Grid', description: 'Cards in a grid' },
        { label: 'List', description: 'One per row' },
      ],
    },
  ],
  tool_use_id: `t${++ids}`,
  agentId,
})

test("sends an agent's AskUserQuestion to the comment's thread", async ($, on) => {
  const w = world(on, [{ id: 'c1', state: 'open' }])
  await $.tool.call(bash('a1', claim('c1')))
  const ran = await $.tool.call(askUser('a1'))
  // The script the agent claimed with, and the project quoted: a path may hold a space.
  expect(ran.deny).toContain(
    `node "${SCRIPTS}/ask.mjs" c1 --project "${ROOT}" "<question>" --option "<label>: <description>"`,
  )
  // Not a step the reader sees.
  expect(w.progress('c1').map((step) => step.kind)).toEqual(['start'])
  // An agent working on no comment asks its own user.
  expect((await $.tool.call(askUser('free'))).deny).toBeUndefined()
})

test('leaves Bash alone for an agent that claimed no comment', async ($, on) => {
  world(on, [])
  expect(
    (await $.tool.call(bash('free', `sed -i '' 's/a/b/' a.ts`))).deny,
  ).toBeUndefined()
})

test('locks files across the git repository, outside the project too', async ($, on) => {
  const w = world(
    on,
    [
      { id: 'c1', state: 'open' },
      { id: 'c2', state: 'open' },
    ],
    { gitRoot: '/repo' },
  )
  await $.tool.call(bash('a1', claim('c1')))
  await $.tool.call(bash('a2', claim('c2')))
  expect((await $.tool.call(edit('a1', '/repo/ssd_scanner/x.py'))).deny).toBeUndefined()
  expect(w.progress('c1').at(-1)).toEqual(
    expect.objectContaining({ kind: 'edit', label: '../ssd_scanner/x.py' }),
  )

  const blocked = $.tool.call(edit('a2', '/repo/ssd_scanner/x.py'))
  for (let i = 0; i < 40; i++) await w.clock.advance(200)
  const ran = await blocked
  expect(ran.deny ?? ran.text).toMatch(
    /ssd_scanner\/x\.py is being changed by the agent of comment c1/,
  )
})

test('binds the project claim.mjs found, whatever --project says', async ($, on) => {
  const w = world(on, [{ id: 'c1', state: 'open' }])
  const cdThen = (script: string) =>
    `cd ${ROOT} && node ${SCRIPTS}/${script} c1 --project . ; echo done`
  await $.tool.call(bash('a1', cdThen('claim.mjs')))
  await $.tool.call(edit('a1', `${ROOT}/src/App.tsx`))
  expect(w.progress('c1').map((step) => step.kind)).toEqual(['start', 'edit', 'edit'])

  w.setComments([{ id: 'c1', state: 'resolved' }])
  await $.tool.call(bash('a1', cdThen('resolve.mjs')))
  expect(w.removed).toEqual([w.progressPath('c1')])
})

test('lets an agent write from Bash outside the repository, where no lock is needed', async ($, on) => {
  world(on, [{ id: 'c1', state: 'open' }], { gitRoot: '/repo' })
  await $.tool.call(bash('a1', claim('c1')))
  const outside = [
    `cat > /tmp/scratch/g5.py <<'EOF'\nopen_report()\nEOF`,
    `npm test 2>&1 | tee /tmp/scratch/test.log`,
    `sed -i '' 's/a/b/' /tmp/scratch/notes.txt`,
  ]
  for (const command of outside) {
    expect((await $.tool.call(bash('a1', command))).deny).toBeUndefined()
  }
  const inside = [
    `cat > /repo/ssd_scanner/x.py <<'EOF'\nX = 1\nEOF`,
    `echo x | tee /tmp/scratch/a.log /repo/web/src/a.ts`,
    `sed -i '' 's/a/b/' /repo/web/src/a.ts`,
    // An inline script: what it writes cannot be told.
    `python3 -c "open('/tmp/scratch/x', 'w').write('x')"`,
  ]
  for (const command of inside) {
    const ran = await $.tool.call(bash('a1', command))
    expect(ran.deny ?? ran.text).toMatch(/Edit or Write tool/)
  }
})

const debugCommand = (args: string): CommandRunInput => ({
  command: 'code-buddy-debug',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
})

test('logs nothing while the hook log is off', async ($, on) => {
  const w = world(on, [{ id: 'c1', state: 'open' }])
  await $.tool.call(bash('a1', claim('c1')))
  await $.tool.call(edit('a1', `${ROOT}/src/App.tsx`))
  expect(w.file(LOG)).toBeUndefined()
})

test('/code-buddy-debug turns the hook log on, shows it, and turns it off', async ($, on) => {
  const w = world(on, [{ id: 'c1', state: 'open' }])
  const turnedOn = await $.command.run(debugCommand('on'))
  expect(turnedOn.text).toMatch(/tail -f \/home\/u\/\.cache\/code-buddy\/hook\.log/)

  await $.tool.call(bash('a1', claim('c1')))
  await $.tool.call(edit('a1', `${ROOT}/src/App.tsx`))
  const log = w.file(LOG) ?? ''
  expect(log).toMatch(/ a1 c1 bound to comment c1 in \/repo\/web, run r1\n/)
  expect(log).toMatch(/ a1 c1 locked src\/App\.tsx\n/)
  expect(log).toMatch(/ a1 c1 recorded edit done "src\/App\.tsx"\n/)

  const shown = await $.command.run(debugCommand(''))
  expect(shown.text).toMatch(/hook log is on/i)
  expect(shown.text).toMatch(/locked src\/App\.tsx/)

  await $.command.run(debugCommand('off'))
  await $.tool.call(edit('a1', `${ROOT}/src/App.tsx`))
  expect(w.file(LOG)).toBe(log)
})

test('keeps the lines another process appends to the hook log meanwhile', async ($, on) => {
  const w = world(on, [{ id: 'c1', state: 'open' }])
  await $.command.run(debugCommand('on'))
  await $.tool.call(bash('a1', claim('c1')))
  w.appendToLogMeanwhile('2026-10-13T00:00:00.000Z cb-c2 c2 locked src/Other.tsx\n')
  await $.tool.call(edit('a1', `${ROOT}/src/App.tsx`))
  const log = w.file(LOG) ?? ''
  expect(log).toMatch(/ cb-c2 c2 locked src\/Other\.tsx\n/)
  expect(log).toMatch(/ a1 c1 locked src\/App\.tsx\n/)
})

test('logs why an agent is not bound, or no longer', async ($, on) => {
  const w = world(on, [{ id: 'c1', state: 'open' }])
  await $.command.run(debugCommand('on'))
  await $.tool.call(bash('a1', claim('gone')))
  await $.tool.call(bash('a2', claim('moved')))
  await $.tool.call(edit('a2', `${ROOT}/src/App.tsx`))
  const log = w.file(LOG) ?? ''
  expect(log).toMatch(
    / a1 - claim\.mjs printed no project, so the agent is not bound: comment gone is resolved\n/,
  )
  expect(log).toMatch(
    / a2 moved cannot read \/nowhere\/\.code-buddy\.json.*: binding dropped\n/,
  )
})

/** The prompt the manager writes for a comment's agent (SKILL.md). */
const workerPrompt = (id: string) =>
  `${id}\nNEW ${id} / "make the title bigger"\nSKILL=/s\nPROJECT=${ROOT}`
const spawnWorker = ($: Parameters<Parameters<typeof test>[1]>[0], id: string) =>
  $.agent.spawn({
    prompt: workerPrompt(id),
    subagentType: 'code-buddy:worker',
    description: 'comment',
  })
const titleComment: Comment = {
  id: 'c1',
  state: 'open',
  route: '/pricing',
  anchor: { quote: '', element: { tag: 'h1', text: 'Plans' } },
  messages: [{ author: 'reader', body: 'make the title bigger' }],
}

test("starts a comment's agent on the model its label maps to, and claim.mjs records it", async ($, on) => {
  const w = world(on, [titleComment])
  w.classifyAs('trivial')

  const started = await spawnWorker($, 'c1')
  expect(started.model).toBe('claude-haiku-5-5')
  expect(w.spawned[0]?.model).toBe('haiku')
  // The reader's words, what they point at and the page, after the labels' meaning.
  expect(w.classified[0]).toMatch(/- trivial: copy, spacing/)
  expect(w.classified[0]).toMatch(
    /Page: \/pricing\nElement: <h1> Plans\nComment: make the title bigger$/,
  )

  await $.tool.call(bash('a1', claim('c1')))
  expect(w.commands[0]).toBe(
    `export CODE_BUDDY_AGENT=a1 CODE_BUDDY_MODEL='claude-haiku-5-5' CODE_BUDDY_COMPLEXITY=trivial; ${claim('c1')}`,
  )
  expect(w.progress('c1')[0]).toEqual(
    expect.objectContaining({
      kind: 'start',
      model: 'claude-haiku-5-5',
      complexity: 'trivial',
    }),
  )

  // A follow-up resumes the same agent, with no spawn: it keeps its model.
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 'turn',
    agentId: 'a1',
    reason: 'answer',
  })
  await $.tool.call(bash('a1', claim('c1')))
  expect(w.commands[1]).toMatch(/CODE_BUDDY_MODEL='claude-haiku-5-5'/)
})

test('a hard comment goes to opus, a standard one keeps the parent model', async ($, on) => {
  const w = world(on, [titleComment, { ...titleComment, id: 'c2' }])
  w.classifyAs('hard')
  expect((await spawnWorker($, 'c1')).model).toBe('claude-opus-5-5')
  w.classifyAs('standard')
  expect((await spawnWorker($, 'c2')).model).toBe('claude-sonnet-5-5')
  expect(w.spawned[1]?.model).toBeUndefined()
  await $.tool.call(bash('a2', claim('c2')))
  expect(w.commands[0]).toMatch(
    /CODE_BUDDY_MODEL='claude-sonnet-5-5' CODE_BUDDY_COMPLEXITY=standard;/,
  )
})

test('a classifier that fails never blocks the comment: its agent starts on the parent model', async ($, on) => {
  const w = world(on, [titleComment])
  w.classifyAs(new Error('overloaded'))
  const started = await spawnWorker($, 'c1')
  expect(started.deny).toBeUndefined()
  expect(started.model).toBe('claude-sonnet-5-5')
  await $.tool.call(bash('a1', claim('c1')))
  expect(w.commands[0]).toBe(
    `export CODE_BUDDY_AGENT=a1 CODE_BUDDY_MODEL='claude-sonnet-5-5'; ${claim('c1')}`,
  )
})

test('models set to inherit turn routing off: no classifier, the model still recorded', async ($, on) => {
  const w = world(on, [titleComment])
  w.write(
    `${ROOT}/.code-buddy.json`,
    JSON.stringify({
      commentsFile: '.code-buddy/comments.json',
      models: { trivial: 'inherit' },
    }),
  )
  w.classifyAs('trivial')
  expect((await spawnWorker($, 'c1')).model).toBe('claude-sonnet-5-5')
  expect(w.classified).toEqual([])
  await $.tool.call(bash('a1', claim('c1')))
  expect(w.commands[0]).toMatch(/CODE_BUDDY_MODEL='claude-sonnet-5-5';/)
})

test('other agents start as they were asked', async ($, on) => {
  const w = world(on, [titleComment])
  w.classifyAs('trivial')
  await $.agent.spawn({ prompt: workerPrompt('c1'), subagentType: 'Explore' })
  expect(w.classified).toEqual([])
  expect(w.spawned[0]?.model).toBeUndefined()
})

test("only the agent started for a comment claims it with that comment's model", async ($, on) => {
  const w = world(on, [titleComment])
  w.classifyAs('trivial')
  await spawnWorker($, 'c1')
  // Another agent, the main loop say, claims the comment later.
  await $.tool.call(bash('main', claim('c1')))
  expect(w.commands[0]).toBe(`export CODE_BUDDY_AGENT=main; ${claim('c1')}`)
  expect(w.progress('c1')[0]).not.toHaveProperty('model')
})

test('a classifier that does not answer in time leaves the agent on the parent model', async ($, on) => {
  const w = world(on, [titleComment])
  w.classifyAs(new Promise<string>(() => {}))
  const started = spawnWorker($, 'c1')
  for (let i = 0; i < 30; i++) await w.clock.advance(200)
  expect((await started).model).toBe('claude-sonnet-5-5')
  await $.tool.call(bash('a1', claim('c1')))
  expect(w.commands[0]).toBe(
    `export CODE_BUDDY_AGENT=a1 CODE_BUDDY_MODEL='claude-sonnet-5-5'; ${claim('c1')}`,
  )
})

test('a label the classifier makes up routes nothing', async ($, on) => {
  const w = world(on, [titleComment])
  w.classifyAs('epic')
  expect((await spawnWorker($, 'c1')).model).toBe('claude-sonnet-5-5')
  expect(w.spawned[0]?.model).toBeUndefined()
})

test('a model name reaches claim.mjs quoted for the shell', async ($, on) => {
  const w = world(on, [titleComment])
  w.write(
    `${ROOT}/.code-buddy.json`,
    JSON.stringify({
      commentsFile: '.code-buddy/comments.json',
      models: { trivial: "it's" },
    }),
  )
  w.classifyAs('trivial')
  await spawnWorker($, 'c1')
  await $.tool.call(bash('a1', claim('c1')))
  expect(w.commands[0]).toMatch(
    /CODE_BUDDY_MODEL='it'\\''s' CODE_BUDDY_COMPLEXITY=trivial;/,
  )
})
