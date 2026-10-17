// The hooks module (hooks/register.ts), run by `claude plugin test .` against
// Claude Code itself: the disk, processes and tools beneath it are in memory.
import { expect, mock, test } from 'claude-code/testing'
import type { CommandRunInput, EngineInterface, On } from 'claude-code'

type AgentSpec = Parameters<EngineInterface['agent']['register']>[0]

/** `agent.offer`'s input for one of the plugin's agent types. */
const offerOf = (agent: string): Parameters<EngineInterface['agent']['offer']>[0] => ({
  agent,
  description: '',
  source: 'plugin',
  provider: { plugin: 'code-buddy', tier: 'plugin' },
})

const ROOT = '/repo/web'
const LOG = '/home/u/.cache/code-buddy/hook.log'

type Comment = {
  id: string
  state: string
  route?: string
  anchor?: { quote: string; element?: { tag: string; text: string } }
  messages?: { author: string; body: string; images?: string[] }[]
  events?: { by: string }[]
}

/** The comments file, as lib/format.mjs writes it. */
const commentsFile = (comments: Comment[]) => JSON.stringify({ version: 2, comments })

/** The disk, processes and tools beneath the mod, in memory. */
/** `gitRoot`: the repository the project is in, as `git rev-parse` answers. */
/** `cwd`: the session's folder; `mainCheckout`: the repository's, from a worktree. */
function world(
  on: On,
  comments: Comment[],
  {
    gitRoot,
    cwd = `${ROOT}/src`,
    mainCheckout,
    refused,
  }: { gitRoot?: string; cwd?: string; mainCheckout?: string; refused?: string } = {},
) {
  const files = new Map<string, string>([
    [
      `${ROOT}/.code-buddy.json`,
      JSON.stringify({ commentsFile: '.code-buddy/comments.json' }),
    ],
    [`${ROOT}/.code-buddy/comments.json`, commentsFile(comments)],
  ])
  const removed: string[] = []
  // Another process appending to the hook log (a comment agent's hook.mjs,
  // another session): its line lands right after the mod next reads or
  // appends to it.
  let otherLine: string | undefined
  const otherAppends = (path: string) => {
    if (path !== LOG || otherLine === undefined) return
    files.set(LOG, (files.get(LOG) ?? '') + otherLine)
    otherLine = undefined
  }
  on('fs.read', (_$, e) => {
    // The plugin's agent file.
    if (e.path.endsWith('/agents/worker.md'))
      return { value: '---\nname: worker\n---\n\nYou handle one comment.\n' }
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
  // Claude Code refuses a command named after a skill (`refused`).
  on('command.register', (_$, e) => {
    if (e.name === refused)
      throw new Error(`"/${e.name}" refused: it is the plugin's skill`)
    return { value: { command: e.name } }
  })
  const tools: string[] = []
  on('tool.register', (_$, e) => {
    tools.push(e.name)
    return { value: { tool: `mcp__code-buddy__${e.name}` } }
  })
  on('session.cwd', () => ({ value: cwd }))
  const toasts: string[] = []
  const logged: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  const sent: { to: string; text: string }[] = []
  let delivering = true
  // Agents whose turn ended: a message resumes one as the Agent tool does,
  // through `agent.offer` at dispatch (once `resumesThrough` names the engine,
  // as `watch` does).
  const idle = new Set<string>()
  let engine: { agent: { offer: EngineInterface['agent']['offer'] } } | undefined
  on('session.send', async (_$, e) => {
    sent.push({ to: e.to, text: e.text })
    if (!delivering) return { isDelivered: false as const, reason: 'no agent by that id' }
    const type = spawned[Number(e.to.slice(1)) - 1]?.type
    if (engine && type && idle.has(e.to)) {
      const { isOffered } = await engine.agent.offer(offerOf(type))
      if (!isOffered)
        return {
          isDelivered: false as const,
          reason: `Agent type '${type}' is not offered in this session.`,
        }
      idle.delete(e.to)
    }
    return { isDelivered: true as const }
  })
  on('session.version', () => ({ value: { version: '2.1.287' } }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('process.run', (_$, e) => {
    if (e.argv.includes('--git-common-dir') && mainCheckout) {
      return {
        value: {
          exitCode: 0,
          stdout: `${mainCheckout}/.git\n`,
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    }
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
    // The hook log's appender, `sh -c <script> sh <file> <line> <cap> <kept>`:
    // past the cap, the last <kept> bytes from their first whole line.
    if (e.argv[0] === 'sh' && e.argv[1] === '-c') {
      const [file = '', line = '', cap = '', kept = ''] = e.argv.slice(4)
      let text = (files.get(file) ?? '') + line
      if (text.length > Number(cap)) {
        text = text.slice(-Number(kept))
        text = text.slice(text.indexOf('\n') + 1)
      }
      files.set(file, text)
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
  const stopped: string[] = []
  on('tool.call', (_$, e) => {
    if (e.tool === 'TaskStop') stopped.push(e.task_id ?? '')
    return { result: 'ok' }
  })
  // Claude Code offers the model every agent type no hook keeps from it.
  on('agent.offer', () => ({ isOffered: true }))
  on('turn.complete', (_$, e) => {
    if (e.agentId) idle.add(e.agentId)
    return { text: '' }
  })
  // The agent types the plugin defines, by full name.
  const registered = new Map<string, AgentSpec>()
  on('agent.register', (_$, e) => {
    registered.set(`code-buddy:${e.name}`, e)
    return { value: { agent: `code-buddy:${e.name}` } }
  })
  // Claude Code starts the agent on its type's model, else the parent's.
  const spawned: { model?: string; prompt: string; name?: string; type: string }[] = []
  // A spawn the plugin makes, answered here, carries no id: the list has it.
  on('agent.list', () => ({
    value: spawned.map((agent, index) => ({
      id: `a${index + 1}`,
      name: agent.name,
      type: agent.type,
      description: '',
      status: 'running' as const,
    })),
  }))
  // Held, a spawn answers only once released: an agent slow to start.
  let held: Promise<void> | undefined
  let release = ignore
  on('agent.spawn', async (_$, e) => {
    await held
    // A plugin's spawn reaches here as the Agent tool's input.
    const input: Record<string, unknown> = { ...e }
    const type = String(input.subagent_type ?? e.subagentType)
    const asked = e.model ?? registered.get(type)?.model
    spawned.push({ model: asked, prompt: e.prompt, name: e.name, type })
    const model = { haiku: 'claude-haiku-5-5', opus: 'claude-opus-5-5' }[asked ?? '']
    return {
      model: model ?? asked ?? 'claude-sonnet-5-5',
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

  // The project's server: the lines the test prints, until it ends.
  const servers: string[][] = []
  const printing: string[] = []
  let wake: () => void = ignore
  let exitCode: number | undefined
  on('process.spawn', async function* (_$, e) {
    servers.push([...e.argv])
    for (;;) {
      const line = printing.shift()
      if (line !== undefined) yield { stream: 'stdout' as const, text: `${line}\n` }
      else if (exitCode !== undefined) return { value: { code: exitCode, signal: null } }
      else await new Promise<void>((resolve) => (wake = resolve))
    }
  })
  /** The server prints lines; what they start has started once it resolves. */
  const print = async (...lines: string[]) => {
    printing.push(...lines)
    wake()
    await clock.settle()
  }

  return {
    file: (path: string) => files.get(path),
    /** What the hooks left claim.mjs as they started the comment's agent. */
    route: (id: string) => {
      const path = [...files.keys()].find((one) => one.endsWith(`/routes/${id}.json`))
      return path && JSON.parse(files.get(path) ?? '')
    },
    registered,
    spawned,
    servers,
    print,
    refuseSends: () => {
      delivering = false
    },
    resumesThrough: (next: typeof engine) => {
      engine = next
    },
    holdSpawns: () => {
      held = new Promise<void>((done) => (release = done))
    },
    releaseSpawns: async () => {
      held = undefined
      release()
      await clock.settle()
    },
    exit: async (code: number) => {
      exitCode = code
      wake()
      await clock.settle()
    },
    toasts,
    tools,
    logged,
    sent,
    stopped,
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
  }
}

const ignore = () => undefined

test('tells the server, through the environment, that the hooks are loaded', async ($, on) => {
  const w = world(on, [])
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(w.env.get('CODE_BUDDY_HOOKS')).toBe('1')
})

const titleComment: Comment = {
  id: 'c1',
  state: 'open',
  route: '/pricing',
  anchor: { quote: '', element: { tag: 'h1', text: 'Plans' } },
  messages: [{ author: 'reader', body: 'make the title bigger' }],
}

const watchCommand = (args = ''): CommandRunInput => ({
  command: 'code-buddy',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
})
const READY = `READY http://127.0.0.1:4599 project=${ROOT}`
const newLine = (id: string) =>
  `NEW ${id} route=/ page-level body="make the title bigger"`
const followUpLine = (id: string) =>
  `FOLLOWUP ${id} route=/ page-level followup="smaller, actually" messages=3`
const open = (id: string): Comment => ({
  ...titleComment,
  id,
})
const ended = (agentId: string, answer = '') => ({
  answer,
  durationMs: 1,
  isAborted: false,
  turnId: 'turn',
  agentId,
  reason: 'answer' as const,
})

/** `/code-buddy` from a folder of the project, its server ready. */
async function watch(
  $: Parameters<Parameters<typeof test>[1]>[0],
  w: ReturnType<typeof world>,
) {
  w.resumesThrough($)
  const answer = $.command.run(watchCommand())
  await w.print(READY)
  return (await answer).text
}

const debugCommand = (args: string): CommandRunInput => ({
  command: 'code-buddy-debug',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
})

test('logs nothing while the hook log is off', async ($, on) => {
  const w = world(on, [open('c1')])
  await watch($, w)
  await w.print(newLine('c1'))
  expect(w.file(LOG)).toBeUndefined()
  await w.exit(0)
})

test('/code-buddy-debug turns the hook log on, shows it, and turns it off', async ($, on) => {
  const w = world(on, [open('c1'), open('c2')])
  const turnedOn = await $.command.run(debugCommand('on'))
  expect(turnedOn.text).toMatch(/tail -f \/home\/u\/\.cache\/code-buddy\/hook\.log/)

  await watch($, w)
  await w.print(newLine('c1'))
  const log = w.file(LOG) ?? ''
  expect(log).toMatch(
    / a1 c1 started on claude-sonnet-5-5, the comment classified standard\n/,
  )
  expect(log).toMatch(/ a1 c1 started for NEW\n/)

  const shown = await $.command.run(debugCommand(''))
  expect(shown.text).toMatch(/hook log is on/i)
  expect(shown.text).toMatch(/started for NEW/)

  await $.command.run(debugCommand('off'))
  await w.print(newLine('c2'))
  expect(w.file(LOG)).toBe(log)
  await w.exit(0)
})

test('keeps the lines another process appends to the hook log meanwhile', async ($, on) => {
  const w = world(on, [open('c1'), open('c2')])
  await $.command.run(debugCommand('on'))
  await watch($, w)
  await w.print(newLine('c1'))
  w.appendToLogMeanwhile('2026-10-13T00:00:00.000Z a1 c1 locked src/App.tsx\n')
  await w.print(newLine('c2'))
  const log = w.file(LOG) ?? ''
  expect(log).toMatch(/ a1 c1 locked src\/App\.tsx\n/)
  expect(log).toMatch(/ a2 c2 started for NEW\n/)
  await w.exit(0)
})

test('keeps the hook log under its cap, its newest whole lines', async ($, on) => {
  const w = world(on, [open('c1')])
  await $.command.run(debugCommand('on'))
  w.write(LOG, `${'x'.repeat(99)}\n`.repeat(3000))
  await watch($, w)
  await w.print(newLine('c1'))
  const log = w.file(LOG) ?? ''
  expect(log.length).toBeLessThanOrEqual(128 * 1024)
  expect(log.length).toBeGreaterThan(100 * 1024)
  expect(log).toMatch(/^x{99}\n/)
  expect(log).toMatch(/ a1 c1 started for NEW\n/)
  await w.exit(0)
})

/** A hook of a comment's agent: hook.mjs, the comment and project written in. */
const hookCommand = (mode: string, id: string, lockRoot = ROOT) =>
  expect.stringMatching(
    new RegExp(
      `^'node' '/.+/skills/code-buddy/scripts/hook\\.mjs' '${mode}' '--comment' '${id}' '--project' '${ROOT}' '--lock-root' '${lockRoot}'$`,
    ),
  )

/** Edit and Bash, which hook.mjs may refuse, but not the read-only tools. */
const PRE_TOOLS = expect.stringMatching(
  /^(?!.*\b(?:Read|Grep|Glob)\b)(?=.*\bEdit\b)(?=.*\bBash\b)[\w|.*]+$/,
)

test("starts a comment's agent with hooks of its own, on the model its label maps to", async ($, on) => {
  const w = world(on, [titleComment])
  w.classifyAs('trivial')
  await watch($, w)
  await w.print(newLine('c1'))

  expect(w.spawned[0]).toEqual(
    expect.objectContaining({ type: 'code-buddy:cb-c1', name: 'cb-c1', model: 'haiku' }),
  )
  const spec = w.registered.get('code-buddy:cb-c1')
  // The worker's instructions, its frontmatter left out.
  expect(spec?.prompt).toBe('You handle one comment.\n')
  expect(spec?.hooks).toEqual({
    // Not before Read, Grep or Glob: each hook is a Node start.
    PreToolUse: [
      {
        matcher: PRE_TOOLS,
        hooks: [{ type: 'command', command: hookCommand('pre', 'c1') }],
      },
    ],
    PostToolUse: [
      { matcher: '*', hooks: [{ type: 'command', command: hookCommand('post', 'c1') }] },
    ],
    PostToolUseFailure: [
      { matcher: '*', hooks: [{ type: 'command', command: hookCommand('post', 'c1') }] },
    ],
    Stop: [{ hooks: [{ type: 'command', command: hookCommand('stop', 'c1') }] }],
  })
  // The reader's words, what they point at and the page, after the labels' meaning.
  expect(w.classified[0]).toMatch(/- trivial: copy, spacing/)
  expect(w.classified[0]).toMatch(
    /Page: \/pricing\nElement: <h1> Plans\nComment: make the title bigger$/,
  )
  // What claim.mjs records on the run: the model asked for, which Claude Code
  // resolves outside the test kit.
  expect(w.route('c1')).toEqual({
    model: 'haiku',
    complexity: 'trivial',
    agent: 'a1',
  })
  await w.exit(0)
})

test("locks a comment's files across the git repository the project is in", async ($, on) => {
  const w = world(on, [titleComment], { gitRoot: '/repo' })
  await watch($, w)
  await w.print(newLine('c1'))
  expect(w.registered.get('code-buddy:cb-c1')?.hooks).toEqual(
    expect.objectContaining({
      PreToolUse: [
        {
          matcher: PRE_TOOLS,
          hooks: [{ type: 'command', command: hookCommand('pre', 'c1', '/repo') }],
        },
      ],
    }),
  )
  await w.exit(0)
})

test('a hard comment goes to opus, a standard one keeps the parent model', async ($, on) => {
  const w = world(on, [titleComment, { ...titleComment, id: 'c2' }])
  await watch($, w)
  w.classifyAs('hard')
  await w.print(newLine('c1'))
  w.classifyAs('standard')
  await w.print(newLine('c2'))
  expect(w.spawned.map((agent) => agent.model)).toEqual(['opus', undefined])
  expect(w.route('c2')).toEqual({
    model: 'claude-sonnet-5-5',
    complexity: 'standard',
    agent: 'a2',
  })
  await w.exit(0)
})

test('the classifier reads the elements picked in the page with the message', async ($, on) => {
  const picked: Comment = {
    ...titleComment,
    anchor: { quote: '' },
    messages: [
      {
        author: 'reader',
        body: 'same size as this',
        elements: [
          { tag: 'h1', text: 'Plans' },
          { tag: 'h2', text: 'Pro' },
        ],
      },
    ],
  }
  const w = world(on, [picked])
  w.classifyAs('trivial')
  await watch($, w)
  await w.print(newLine('c1'))
  expect(w.classified[0]).toMatch(
    /Page: \/pricing\nElement: <h1> Plans\nElement: <h2> Pro\nComment: same size as this$/,
  )
  await w.exit(0)
})

const imageOnly: Comment = {
  ...titleComment,
  messages: [{ author: 'reader', body: '', images: ['m1-1.png'] }],
}

test("a comment of an image alone starts on the session's model at a medium effort, unclassified", async ($, on) => {
  const w = world(on, [imageOnly])
  await watch($, w)
  w.classifyAs('trivial')
  await w.print(newLine('c1'))
  expect(w.classified).toEqual([])
  expect(w.spawned[0]?.model).toBeUndefined()
  expect(w.registered.get('code-buddy:cb-c1')?.effort).toBe('medium')
  expect(w.route('c1')).toEqual({
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    agent: 'a1',
  })
  await w.exit(0)
})

test('a comment of an image alone gets its medium effort with routing off too', async ($, on) => {
  const w = world(on, [imageOnly])
  w.write(
    `${ROOT}/.code-buddy.json`,
    JSON.stringify({
      commentsFile: '.code-buddy/comments.json',
      models: { trivial: 'inherit' },
    }),
  )
  await watch($, w)
  await w.print(newLine('c1'))
  expect(w.registered.get('code-buddy:cb-c1')?.effort).toBe('medium')
  await w.exit(0)
})

test('the medium effort of an image alone holds when its agent is resumed or reloaded', async ($, on) => {
  const w = world(on, [imageOnly])
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await watch($, w)
  await w.print(newLine('c1'))
  await $.turn.complete(ended('a1', 'QUESTION: Which part?'))
  w.registered.clear()
  await w.print(followUpLine('c1'))
  expect(w.sent.map((one) => one.to)).toEqual(['a1'])
  expect(w.registered.get('code-buddy:cb-c1')?.effort).toBe('medium')

  w.registered.clear()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await w.clock.settle()
  expect(w.registered.get('code-buddy:cb-c1')?.effort).toBe('medium')
  await w.exit(0)
})

test('a comment of words and an image is classified on its words', async ($, on) => {
  const w = world(on, [
    {
      ...titleComment,
      messages: [{ author: 'reader', body: 'make it like this', images: ['m1-1.png'] }],
    },
  ])
  await watch($, w)
  w.classifyAs('trivial')
  await w.print(newLine('c1'))
  expect(w.classified).toHaveLength(1)
  expect(w.spawned[0]?.model).toBe('haiku')
  await w.exit(0)
})

test('a classifier that fails never blocks the comment: its agent starts on the parent model', async ($, on) => {
  const w = world(on, [titleComment])
  w.classifyAs(new Error('overloaded'))
  await watch($, w)
  await w.print(newLine('c1'))
  expect(w.spawned).toHaveLength(1)
  expect(w.route('c1')).toEqual({ model: 'claude-sonnet-5-5', agent: 'a1' })
  await w.exit(0)
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
  await watch($, w)
  await w.print(newLine('c1'))
  expect(w.classified).toEqual([])
  expect(w.route('c1')).toEqual({ model: 'claude-sonnet-5-5', agent: 'a1' })
  await w.exit(0)
})

test('a classifier that does not answer in time leaves the agent on the parent model', async ($, on) => {
  const w = world(on, [titleComment])
  w.classifyAs(new Promise<string>(() => {}))
  await watch($, w)
  void w.print(newLine('c1'))
  for (let i = 0; i < 30; i++) await w.clock.advance(200)
  expect(w.spawned).toEqual([expect.objectContaining({ model: undefined })])
  expect(w.route('c1')).toEqual({ model: 'claude-sonnet-5-5', agent: 'a1' })
  await w.exit(0)
})

test('a label the classifier makes up routes nothing', async ($, on) => {
  const w = world(on, [titleComment])
  w.classifyAs('epic')
  await watch($, w)
  await w.print(newLine('c1'))
  expect(w.spawned[0]?.model).toBeUndefined()
  await w.exit(0)
})

test('/code-buddy starts the server of the project it is in, once', async ($, on) => {
  const w = world(on, [])
  w.write(
    `${ROOT}/.code-buddy.json`,
    JSON.stringify({
      commentsFile: '.code-buddy/comments.json',
      devUrl: 'http://localhost:3000',
    }),
  )
  const text = await watch($, w)
  expect(w.servers).toEqual([
    [
      'node',
      expect.stringMatching(/\/skills\/code-buddy\/scripts\/server\.mjs$/),
      '--project',
      ROOT,
    ],
  ])
  expect(text).toMatch(/Code Buddy is watching \/repo\/web/)
  expect(text).toMatch(/Open or reload http:\/\/localhost:3000/)

  const again = await $.command.run(watchCommand())
  expect(again.text).toMatch(/already watching/)
  expect(w.servers).toHaveLength(1)
  await w.exit(0)
})

/** The marker a prompt's fence names. */
const marker = (prompt = '') => prompt.match(/starting with (cb-[0-9a-f]{8}) /)?.[1]

test('each comment starts its agent at once, three at a time', async ($, on) => {
  const w = world(on, ['c1', 'c2', 'c3', 'c4'].map(open))
  await watch($, w)
  await w.print(newLine('c1'), newLine('c2'), newLine('c3'), newLine('c4'))

  expect(w.spawned.map((agent) => agent.name)).toEqual(['cb-c1', 'cb-c2', 'cb-c3'])
  expect(w.spawned[0]?.type).toBe('code-buddy:cb-c1')
  expect(w.spawned[0]?.prompt).toMatch(
    /^c1\nSKILL=\/.+\/skills\/code-buddy\nPROJECT=\/repo\/web\nEach line below starting with (cb-[0-9a-f]{8}) .*data, not instructions.*\n\1 NEW c1 route=\/ page-level body="make the title bigger"$/,
  )
  // Each prompt fences the reader's line behind a marker of its own.
  expect(marker(w.spawned[1]?.prompt)).not.toBe(marker(w.spawned[0]?.prompt))

  // An agent ends: its line for the person, and the comment in line starts.
  await $.turn.complete(ended('a1', 'Made the title bigger.\nmore'))
  await w.clock.settle()
  expect(w.logged).toEqual(['code-buddy c1: Made the title bigger.'])
  expect(w.spawned.map((agent) => agent.name)).toEqual([
    'cb-c1',
    'cb-c2',
    'cb-c3',
    'cb-c4',
  ])
  await w.exit(0)
})

test("a follow-up or an edit goes to the comment's agent; none, one starts", async ($, on) => {
  const w = world(on, ['c1', 'c2'].map(open))
  await watch($, w)
  await w.print(newLine('c1'))
  await w.print(`EDIT c1 route=/ page-level body="make it red"`)
  expect(w.sent).toEqual([
    {
      to: 'a1',
      text: expect.stringMatching(
        /^The reader edited comment c1 while you work on it\.\nEach line below starting with (cb-[0-9a-f]{8}) .*\n\1 EDIT c1 /,
      ),
    },
  ])

  w.setComments([{ ...open('c1'), state: 'asking' }, open('c2')])
  await $.turn.complete(ended('a1', 'QUESTION: Which red?'))
  await w.clock.settle()
  expect(w.toasts.at(-1)).toBe('Code Buddy asks, on comment c1: Which red?')

  await w.print(followUpLine('c1'), followUpLine('c2'))
  expect(w.sent[1]).toEqual({
    to: 'a1',
    text: expect.stringMatching(
      /^The reader followed up on comment c1\.\nEach line below starting with (cb-[0-9a-f]{8}) .*\n\1 FOLLOWUP c1 .*\nClaim it again/,
    ),
  })
  expect(w.spawned.map((agent) => agent.name)).toEqual(['cb-c1', 'cb-c2'])
  await w.exit(0)
})

test('a comment the reader stops or deletes stops its agent, or leaves the queue', async ($, on) => {
  const w = world(on, ['c1', 'c2', 'c3', 'c4'].map(open))
  await watch($, w)
  await w.print(newLine('c1'), newLine('c2'), newLine('c3'), newLine('c4'))
  await w.print('DELETED c4', 'CANCELLED c1')
  expect(w.stopped).toEqual(['a1'])
  // c4 left the queue: nothing takes the place c1 freed.
  expect(w.spawned).toHaveLength(3)
  await w.exit(0)
})

test('a comment the reader resolves stops its agent; one its agent resolved does not', async ($, on) => {
  const w = world(on, ['c1', 'c2'].map(open))
  await watch($, w)
  await w.print(newLine('c1'), newLine('c2'))
  w.setComments([
    { ...open('c1'), state: 'resolved', events: [{ by: 'reader' }] },
    { ...open('c2'), state: 'resolved', events: [{ by: 'agent' }] },
  ])

  await w.print('RESOLVED c1', 'RESOLVED c2')
  await w.clock.advance(3_000)
  expect(w.stopped).toEqual(['a1'])
  await w.exit(0)
})

test('a server that cannot start says why, and /code-buddy tries again', async ($, on) => {
  const w = world(on, [])
  w.resumesThrough($)
  const answer = $.command.run(watchCommand())
  await w.print('PORT_BUSY 4599 is used by another program')
  expect((await answer).text).toMatch(
    /cannot start: port 4599 is used by another program\. Another session may already watch/,
  )
  await w.exit(3)
  void $.command.run(watchCommand())
  await w.clock.settle()
  expect(w.servers).toHaveLength(2)
  await w.exit(0)
})

test('the skill starts the watch through its tool', async ($, on) => {
  const w = world(on, [])
  const ran = $.tool.call({
    tool: 'mcp__code-buddy__watch',
    project: ROOT,
    tool_use_id: 'w1',
  })
  await w.print(READY)
  const { result } = await ran
  expect(result).toMatch(/Code Buddy is watching \/repo\/web/)
  await w.exit(0)
})

test('registers the tool even when Claude Code refuses the name /code-buddy', async ($, on) => {
  const w = world(on, [], { refused: 'code-buddy' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(w.tools).toEqual(['watch'])
})

test('the skill ends the watch through its tool', async ($, on) => {
  const w = world(on, [])
  await watch($, w)
  const { result } = await $.tool.call({
    tool: 'mcp__code-buddy__watch',
    stop: true,
    tool_use_id: 'w2',
  })
  expect(result).toMatch(/stopped watching \/repo\/web/)
  await w.exit(0)
})

test('/code-buddy names the folder it found no project in', async ($, on) => {
  const w = world(on, [])
  const { text } = await $.command.run(watchCommand('api'))
  expect(text).toMatch(/^No \.code-buddy\.json in api: \/code-buddy:code-buddy init/)
  expect(w.servers).toEqual([])
})

test('/code-buddy stop ends the watch', async ($, on) => {
  const w = world(on, [])
  await watch($, w)
  const { text } = await $.command.run(watchCommand('stop'))
  expect(text).toMatch(/stopped watching \/repo\/web/)
  expect((await $.command.run(watchCommand('stop'))).text).toMatch(
    /not watching any project/,
  )
  await w.exit(0)
})

test('a follow-up waits its turn when three agents already work', async ($, on) => {
  const w = world(on, ['c1', 'c2', 'c3', 'c4'].map(open))
  await watch($, w)
  await w.print(newLine('c1'))
  await $.turn.complete(ended('a1', 'Done.'))
  await w.print(newLine('c2'), newLine('c3'), newLine('c4'), followUpLine('c1'))
  // c1's agent finished: resuming it would make a fourth.
  expect(w.sent).toEqual([])

  await $.turn.complete(ended('a2', 'Done.'))
  await w.clock.settle()
  expect(w.sent).toEqual([
    { to: 'a1', text: expect.stringMatching(/^The reader followed up on comment c1/) },
  ])
  expect(w.spawned).toHaveLength(4)
  await w.exit(0)
})

test('an edit or a stop while the agent starts reaches it once started', async ($, on) => {
  const w = world(on, ['c1', 'c2', 'c3', 'c4', 'c5'].map(open))
  await watch($, w)
  await w.print(newLine('c1'), newLine('c2'), newLine('c3'), newLine('c4'), newLine('c5'))
  // An agent ends: c4's starts, slowly, while the reader edits it.
  w.holdSpawns()
  await $.turn.complete(ended('a1', 'Done.'))
  await w.clock.settle()
  await w.print(`EDIT c4 route=/ page-level body="make it red"`)
  await w.releaseSpawns()
  expect(w.spawned.map((agent) => agent.name)).toEqual([
    'cb-c1',
    'cb-c2',
    'cb-c3',
    'cb-c4',
  ])
  expect(w.sent).toEqual([
    { to: 'a4', text: expect.stringMatching(/^The reader edited comment c4 /) },
  ])

  // c5's starts the same way, and the reader stops it.
  w.holdSpawns()
  await $.turn.complete(ended('a2', 'Done.'))
  await w.clock.settle()
  await w.print('CANCELLED c5')
  await w.releaseSpawns()
  expect(w.stopped).toEqual(['a5'])
  expect(w.spawned).toHaveLength(5)
  await w.exit(0)
})

test('a comment reopened right after the reader resolved it keeps its agent', async ($, on) => {
  const w = world(on, [open('c1')])
  await watch($, w)
  await w.print(newLine('c1'))
  w.setComments([{ ...open('c1'), state: 'resolved', events: [{ by: 'reader' }] }])
  await w.print('RESOLVED c1', followUpLine('c1'))
  await w.clock.advance(3_000)
  expect(w.stopped).toEqual([])
  await w.exit(0)
})

test("a message resumes the comment's agent with its hooks, which a reload unloads", async ($, on) => {
  const w = world(on, [titleComment])
  w.classifyAs('trivial')
  await watch($, w)
  await w.print(newLine('c1'))
  await $.turn.complete(ended('a1', 'QUESTION: Which title?'))
  w.registered.clear()
  await w.print(followUpLine('c1'))
  expect(w.sent.map((one) => one.to)).toEqual(['a1'])
  expect(w.registered.get('code-buddy:cb-c1')).toEqual(
    expect.objectContaining({
      model: 'haiku',
      hooks: expect.objectContaining({ PreToolUse: expect.any(Array) }),
    }),
  )
  await w.exit(0)
})

test('a reply resumes the agent that finished its turn, whose type the model is not offered', async ($, on) => {
  const w = world(on, [titleComment])
  w.classifyAs('trivial')
  await watch($, w)
  await w.print(newLine('c1'))
  await $.turn.complete(ended('a1', 'QUESTION: Which title?'))
  w.classifyAs('hard')
  await w.print(followUpLine('c1'))
  expect(w.spawned.map((agent) => agent.name)).toEqual(['cb-c1'])
  // Resumed, it is at work: an edit goes to it too.
  await w.print(`EDIT c1 route=/ page-level body="make it red"`)
  expect(w.sent.map((one) => one.to)).toEqual(['a1', 'a1'])
  expect(w.spawned.map((agent) => agent.name)).toEqual(['cb-c1'])
  // Once sent, the model is offered neither the comment's type nor the worker.
  for (const agent of ['code-buddy:cb-c1', 'code-buddy:worker'])
    expect(await $.agent.offer(offerOf(agent))).toEqual({ isOffered: false })
  await w.exit(0)
})

test('a reload gives the agents at work their hooks again, a resumed one too', async ($, on) => {
  const w = world(on, ['c1', 'c2'].map(open))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  w.classifyAs('trivial')
  await watch($, w)
  await w.print(newLine('c1'), newLine('c2'))
  await $.turn.complete(ended('a1', 'QUESTION: Which title?'))
  await $.turn.complete(ended('a2', 'Done.'))
  await w.print(followUpLine('c1'))
  expect(w.sent.map((one) => one.to)).toEqual(['a1'])

  // /reload-plugins while a1 works on the follow-up: the plugin's agent
  // types go, and the module loads again.
  w.registered.clear()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await w.clock.settle()
  expect([...w.registered.keys()]).toEqual(['code-buddy:cb-c1'])
  expect(w.registered.get('code-buddy:cb-c1')).toEqual(
    expect.objectContaining({
      model: 'haiku',
      hooks: expect.objectContaining({ PreToolUse: expect.any(Array) }),
    }),
  )
  await w.exit(0)
})

test('a reply the agent missed as it ended its turn goes to it again', async ($, on) => {
  const w = world(on, ['c1', 'c2'].map(open))
  await watch($, w)
  await w.print(newLine('c1'), newLine('c2'))
  // The reader answers c1's question while its agent ends its turn.
  await w.print(followUpLine('c1'), followUpLine('c2'))
  expect(w.sent.map((one) => one.to)).toEqual(['a1', 'a2'])

  // c1 still waits for an agent; c2's agent took the reply.
  w.setComments([open('c1'), { ...open('c2'), state: 'working' }])
  await $.turn.complete(ended('a1', 'QUESTION: Which title?'))
  await $.turn.complete(ended('a2', 'QUESTION: Which colour?'))
  await w.clock.settle()
  expect(w.sent.map((one) => one.to)).toEqual(['a1', 'a2', 'a1'])
  expect(w.sent[2]?.text).toMatch(
    /^The reader followed up on comment c1\.\nEach line below starting with (cb-[0-9a-f]{8}) .*\n\1 FOLLOWUP c1 /,
  )

  // Once only: a turn that ends again without taking it never loops.
  await $.turn.complete(ended('a1', 'Done.'))
  await w.clock.settle()
  expect(w.sent.map((one) => one.to)).toEqual(['a1', 'a2', 'a1'])
  await w.exit(0)
})

test('an agent that cannot take a message gives way to a new one', async ($, on) => {
  const w = world(on, [open('c1')])
  await watch($, w)
  await w.print(newLine('c1'))
  w.refuseSends()
  await w.print(`EDIT c1 route=/ page-level body="make it red"`)
  expect(w.spawned.map((agent) => agent.name)).toEqual(['cb-c1', 'cb-c1'])
  await w.exit(0)
})

test('a server that stops after it started says so', async ($, on) => {
  const w = world(on, [])
  await watch($, w)
  await w.exit(1)
  expect(w.toasts.at(-1)).toMatch(
    /^Code Buddy stopped watching web: the server exited \(code 1\)\. \/code-buddy starts it again\.$/,
  )
  // Not watching any more: the command starts a new server.
  void $.command.run(watchCommand())
  await w.clock.settle()
  expect(w.servers).toHaveLength(2)
})

test('the skill watches only a project of its session', async ($, on) => {
  const w = world(on, [])
  const ran = await $.tool.call({
    tool: 'mcp__code-buddy__watch',
    project: '/tmp/elsewhere',
    tool_use_id: 'w2',
  })
  expect(ran.deny ?? ran.text).toMatch(/outside this session's folder and repository/)
  expect(w.servers).toEqual([])
})

test("/code-buddy in a git worktree watches the main checkout's project", async ($, on) => {
  const w = world(on, [], {
    cwd: '/wt/feature/web/src',
    gitRoot: '/wt/feature',
    mainCheckout: '/repo',
  })
  w.resumesThrough($)
  const answer = $.command.run(watchCommand())
  await w.print(READY)
  expect((await answer).text).toMatch(/watching \/repo\/web/)
  expect(w.servers[0]?.[3]).toBe(ROOT)
  await w.exit(0)
})
