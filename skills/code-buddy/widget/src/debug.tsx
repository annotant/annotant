// The debug panel: every comment as the widget holds it, for whoever works on
// Code Buddy. Only reachable behind CODE_BUDDY_DEBUG, so a release build drops
// this whole module: keep it free of top-level side effects.
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { useCommentHistory } from './api'
import type { ReviewComment, ReviewMessage, ReviewProgress, ReviewState } from './domain'
import { readSession, writeSession } from './session'
import { Chip, IconButton } from './ui'

const DEBUG_CSS = `
.cb-debug { position: fixed; left: 16px; bottom: 16px; width: min(520px, calc(100vw - 32px)); max-height: min(80vh, 720px); display: flex; flex-direction: column; background: var(--cb-surface); color: var(--cb-text); border: 1px solid var(--cb-border); border-radius: 12px; box-shadow: 0 12px 32px rgba(19, 41, 75, .18); font-size: 12px; overflow: hidden; }
.cb-debug-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 8px 8px 14px; border-bottom: 1px solid var(--cb-border); }
.cb-debug-head h2 { margin: 0; font-size: 13px; font-weight: 600; }
.cb-debug-hint { color: var(--cb-muted); font-weight: 400; }
.cb-debug-list { display: flex; gap: 4px; padding: 8px 14px; overflow-x: auto; border-bottom: 1px solid var(--cb-border); flex-shrink: 0; }
.cb-debug-list button { all: unset; cursor: pointer; padding: 2px 8px; border: 1px solid var(--cb-border); border-radius: 999px; white-space: nowrap; font-family: ui-monospace, monospace; }
.cb-debug-list button[aria-pressed="true"] { background: var(--cb-accent-weak); border-color: var(--cb-accent); color: var(--cb-accent-strong); }
.cb-debug-body { overflow: auto; padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.cb-debug-fields { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin: 0; }
.cb-debug-fields dt { color: var(--cb-muted); }
.cb-debug-fields dd { margin: 0; font-family: ui-monospace, monospace; word-break: break-all; }
.cb-debug-timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.cb-debug-event { display: grid; grid-template-columns: 84px 1fr; gap: 8px; }
.cb-debug-event time { color: var(--cb-muted); font-family: ui-monospace, monospace; }
.cb-debug-event strong { font-weight: 600; }
.cb-debug-event p { margin: 2px 0 0; white-space: pre-wrap; }
.cb-debug-event--status strong { color: var(--cb-accent-strong); }
.cb-debug-event--failed strong { color: var(--cb-red); }
.cb-debug-tag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 4px; background: var(--cb-surface-2); color: var(--cb-muted); font-family: ui-monospace, monospace; }
.cb-debug-id { border: 0; cursor: pointer; font-size: inherit; }
.cb-debug-id[aria-expanded="true"] { background: var(--cb-accent-weak); color: var(--cb-accent-strong); }
.cb-debug-call { display: flex; flex-direction: column; gap: 4px; margin: 4px 0 2px; }
.cb-debug-call pre { margin: 0; padding: 6px 8px; background: var(--cb-surface-2); border-radius: 6px; overflow: auto; max-height: 240px; font-size: 11px; white-space: pre-wrap; word-break: break-word; }
.cb-debug-call .cb-debug-error { color: var(--cb-red); }
.cb-debug-id:hover { color: var(--cb-accent-strong); }
.cb-debug-raw summary { cursor: pointer; color: var(--cb-muted); }
.cb-debug-raw pre { margin: 6px 0 0; padding: 8px; background: var(--cb-surface-2); border-radius: 6px; overflow: auto; font-size: 11px; }
.cb-debug-empty { color: var(--cb-muted); }
.cb-debug-sep { display: flex; align-items: center; gap: 10px; margin: 8px 0 2px; color: var(--cb-muted); font: 600 11px/1.2 ui-monospace, monospace; letter-spacing: .04em; text-transform: uppercase; }
.cb-debug-sep::before, .cb-debug-sep::after { content: ""; flex: 1; border-top: 1px dashed var(--cb-border); }
.cb-debug-sep small { font-weight: 400; text-transform: none; letter-spacing: 0; }
.cb-debug-sep--agent { margin-top: 16px; color: var(--cb-accent-strong); font-size: 12px; }
.cb-debug-sep--agent::before, .cb-debug-sep--agent::after { border-top: 2px solid var(--cb-accent); }
.cb-debug-sep--agent > span { padding: 2px 10px; border: 2px solid var(--cb-accent); border-radius: 999px; background: var(--cb-accent-weak); }
.cb-debug-file { align-self: flex-start; color: var(--cb-accent-strong); }
.cb-debug-runs { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; color: var(--cb-muted); }
.cb-debug-run { border: 0; cursor: pointer; font-size: inherit; }
.cb-debug-run[aria-pressed="true"] { background: var(--cb-accent-weak); color: var(--cb-accent-strong); }
.cb-debug-context { all: unset; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.cb-debug-context:hover { color: var(--cb-accent); }
.cb-debug-context:focus-visible { outline: 2px solid var(--cb-accent); outline-offset: 2px; border-radius: 2px; }
.cb-debug-backdrop { position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; background: rgba(19, 41, 75, .35); }
.cb-debug-dialog { width: min(860px, 100%); max-height: min(88vh, 960px); display: flex; flex-direction: column; background: var(--cb-surface); color: var(--cb-text); border: 1px solid var(--cb-border); border-radius: 12px; box-shadow: 0 12px 32px rgba(19, 41, 75, .25); font-size: 12px; overflow: hidden; outline: none; }
.cb-debug-dialog .cb-debug-call pre { max-height: 45vh; }
.cb-debug-layer { margin: 6px 0 0; font-size: 12px; font-weight: 600; }
.cb-debug-layer small { color: var(--cb-muted); font-weight: 400; }
`

// Shown or not, and the raw JSON unfolded or not: shared by the header's toggle
// and the panel, and kept across reloads (hot ones included) like the panel's own.
const KEY = 'code-buddy:debug'

interface DebugState {
  open: boolean
  raw: boolean
}

// Read once per page load, on first use: never at the module's top level.
let debugState: DebugState | undefined
const listeners = new Set<() => void>()

const saved = () =>
  (debugState ??= readSession<DebugState>(KEY) ?? { open: false, raw: false })

function update(change: Partial<DebugState>) {
  debugState = { ...saved(), ...change }
  writeSession(KEY, debugState)
  listeners.forEach((listener) => listener())
}

/** Shows or hides the panel; flips it without `value`. */
export function toggleDebug(value = !saved().open) {
  update({ open: value })
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const useShown = () => useSyncExternalStore(subscribe, () => saved().open)
const useRaw = () => useSyncExternalStore(subscribe, () => saved().raw)

/** Alt+Shift+D: by its key code, as macOS turns Alt+Shift+D into another character. */
const isShortcut = (event: KeyboardEvent) =>
  !event.repeat &&
  event.altKey &&
  event.shiftKey &&
  !event.ctrlKey &&
  !event.metaKey &&
  event.code === 'KeyD'

/** The header's discreet switch for the panel. */
export function DebugToggle() {
  return (
    <IconButton
      icon="wrench"
      label="Debug panel (Alt+Shift+D)"
      aria-pressed={useShown()}
      onClick={() => toggleDebug()}
    />
  )
}

type TimelineEvent =
  | {
      kind: 'status'
      at: number
      label: string
      /** A move of the comment: drawn as the widget's badge. */
      state?: ReviewState
      detail?: string
      run?: string
    }
  | { kind: 'message'; at: number; message: ReviewMessage }
  | { kind: 'step'; at: number; step: ReviewProgress }

const time = (at: string | undefined) => (at ? Date.parse(at) : NaN)

const stepKeyOf = (step: ReviewProgress) => step.id ?? `${step.at}:${step.kind}`

/**
 * Every step of every run, from the history the panel loads, updated by the
 * live run's steps the widget may have received since.
 */
function stepsOf(comment: ReviewComment): ReviewProgress[] {
  const steps = new Map((comment.history ?? []).map((step) => [stepKeyOf(step), step]))
  for (const step of comment.progress ?? []) steps.set(stepKeyOf(step), step)
  return [...steps.values()]
}

/** The runs the comment had, in order: a claim starts each. */
export const runsOf = (comment: ReviewComment) => [
  ...new Set(comment.events.flatMap((event) => (event.run ? [event.run] : []))),
]

/** Who ran each run: the agent its `working` event names, else its steps'. */
export function agentsOf(comment: ReviewComment): Map<string, string> {
  const agents = new Map<string, string>()
  for (const event of comment.events) {
    if (event.run && event.agent) agents.set(event.run, event.agent)
  }
  for (const step of stepsOf(comment)) {
    if (step.run && step.agent && !agents.has(step.run)) agents.set(step.run, step.agent)
  }
  return agents
}

/** A line across the timeline where a run starts; a bolder one when its agent is another. */
type Separator = { kind: 'separator'; run: string; agent?: string; newAgent: boolean }

/** The timeline with a separator before each run, marking where the agent changes. */
export function withSeparators(
  events: TimelineEvent[],
  agents: Map<string, string>,
): (TimelineEvent | Separator)[] {
  const rows: (TimelineEvent | Separator)[] = []
  let lastRun: string | undefined
  let lastAgent: string | undefined
  for (const event of events) {
    const run = runOf(event)
    if (run && run !== lastRun) {
      const agent = agents.get(run)
      rows.push({
        kind: 'separator',
        run,
        ...(agent ? { agent } : {}),
        newAgent: !!agent && agent !== lastAgent,
      })
      lastRun = run
      if (agent) lastAgent = agent
    }
    rows.push(event)
  }
  return rows
}

/** An agent's id, short enough to read; `main` is the session's main loop. */
const agentName = (agent: string) =>
  agent === 'main' ? 'main session' : agent.slice(0, 8)

/**
 * A run's separator. `context`: the link to what its agent was given, on the
 * agent's first run.
 */
function SeparatorRow({
  separator,
  context,
}: {
  separator: Separator
  context?: ReactNode
}) {
  const { run, agent, newAgent } = separator
  return (
    <li
      className={`cb-debug-sep${newAgent ? ' cb-debug-sep--agent' : ''}`}
      title={agent ? `Agent ${agent}` : undefined}
    >
      <span>
        {newAgent && agent ? `Agent ${agentName(agent)} · run ${run}` : `Run ${run}`}
        {!newAgent && agent && <small> · same agent</small>}
        {context && <> · {context}</>}
      </span>
    </li>
  )
}

const runOf = (event: TimelineEvent) =>
  event.kind === 'status'
    ? event.run
    : event.kind === 'message'
      ? event.message.run
      : event.step.run

/** A line that hands an opening of the comment over to the hooks. */
const HANDOVER = /^(OPEN|NEW|FOLLOWUP) /

/**
 * The whole conversation in order: every move from the comment's events,
 * messages and progress steps. With `run`, only what belongs to that run.
 */
export function timelineOf(comment: ReviewComment, run?: string): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const handovers = (comment.lines ?? [])
    .filter(({ line }) => HANDOVER.test(line))
    .map(({ at }) => time(at))
  let opened = -Infinity
  for (const event of comment.events) {
    const at = time(event.at)
    if (event.state === 'open') opened = at
    // The gap from the hand-over of this opening to the claim: the time the
    // hooks took to start an agent, or a free one to come.
    const handover =
      event.state === 'working'
        ? handovers.findLast((handed) => handed >= opened && handed <= at)
        : undefined
    const gap =
      handover === undefined
        ? ''
        : ` · ${((at - handover) / 1000).toFixed(1)} s after the hand-over`
    events.push({
      kind: 'status',
      at,
      label: event.state,
      state: event.state,
      detail: `by ${event.by}${gap}`,
      ...(event.run ? { run: event.run } : {}),
    })
  }
  for (const message of comment.messages) {
    events.push({ kind: 'message', at: time(message.at), message })
  }
  const openings = comment.events
    .filter((event) => event.state === 'open')
    .map((event) => time(event.at))
  for (const { at, line } of comment.lines ?? []) {
    const printed = time(at)
    // The gap from the opening to its hand-over: the server's read of the file.
    const opening = HANDOVER.test(line)
      ? openings.findLast((open) => open <= printed)
      : undefined
    const label = !HANDOVER.test(line)
      ? 'server line'
      : opening === undefined
        ? 'handed over'
        : `handed over · ${((printed - opening) / 1000).toFixed(1)} s after the opening`
    events.push({ kind: 'status', at: printed, label, detail: line })
  }
  const cancellation = comment.cancellation
  if (cancellation) {
    events.push({
      kind: 'status',
      at: time(cancellation.at),
      label: 'run cancelled',
      detail: `${cancellation.steps} steps, changed: ${cancellation.changed.join(', ') || 'nothing'}`,
      ...(cancellation.run ? { run: cancellation.run } : {}),
    })
  }
  for (const step of stepsOf(comment)) events.push({ kind: 'step', at: step.at, step })
  // Stable: what shares a time keeps the order above. A time that does not
  // parse goes last, as NaN would leave the sort's order undefined.
  const order = (event: TimelineEvent) => (Number.isNaN(event.at) ? Infinity : event.at)
  return events
    .filter((event) => run === undefined || runOf(event) === run)
    .toSorted((a, b) => order(a) - order(b))
}

/** The widget's badge tone for each state; `working` is its "In progress". */
const TONES = {
  open: 'open',
  working: 'claimed',
  asking: 'asking',
  answered: 'answered',
  stopped: 'stopped',
  resolved: 'resolved',
} as const

/** A state as the widget's badge, smaller. */
const StateChip = ({ state }: { state: ReviewState }) => (
  <Chip tone={TONES[state]} small>
    {state}
  </Chip>
)

/** A run's id: a click shows only that run in the timeline, another click all of them. */
function RunTag({
  run,
  selected,
  onSelect,
}: {
  run: string
  selected: string | undefined
  onSelect: (run: string | undefined) => void
}) {
  return (
    <button
      type="button"
      className="cb-debug-tag cb-debug-run"
      aria-pressed={selected === run}
      title={selected === run ? 'Show every run' : `Show run ${run} only`}
      onClick={() => onSelect(selected === run ? undefined : run)}
    >
      {run}
    </button>
  )
}

function Time({ at }: { at: number }) {
  if (Number.isNaN(at)) return <time>?</time>
  const iso = new Date(at).toISOString()
  return (
    <time dateTime={iso} title={iso}>
      {new Date(at).toLocaleTimeString(undefined, { hour12: false })}.
      {String(at % 1000).padStart(3, '0')}
    </time>
  )
}

function MessageEvent({
  message,
  run,
  onRun,
}: {
  message: ReviewMessage
  run: string | undefined
  onRun: (run: string | undefined) => void
}) {
  return (
    <div>
      <strong>{message.author}</strong>
      <span className="cb-debug-tag">{message.id}</span>
      {message.run && <RunTag run={message.run} selected={run} onSelect={onRun} />}
      {message.question && <span className="cb-debug-tag">question</span>}
      {message.multiple && <span className="cb-debug-tag">multiple</span>}
      <p>{message.body}</p>
      {!!message.options?.length && (
        <p>
          options:{' '}
          {message.options
            .map((option) =>
              option.description
                ? `${option.label} (${option.description})`
                : option.label,
            )
            .join(' | ')}
        </p>
      )}
      {!!message.choices?.length && <p>choices: {message.choices.join(' | ')}</p>}
    </div>
  )
}

interface ToolCall {
  transcript: string
  name: string
  input: unknown
  result?: string
  error?: boolean
}

/** What an agent was given, as the server read it. */
interface AgentPrompt {
  transcript: string
  /** Its first message, exactly as it was sent. */
  prompt: string
  agentType?: string
  /** Its instructions, for one of the plugin's agents, as on disk now. */
  instructions?: { file: string; text: string }
}

/** A comment's step files, every run's, as the server has them on disk. */
const stepsUrl = (id: string) =>
  new URL(`api/debug/steps/${id}`, new URL('.', import.meta.url)).href

/** What the server read in Claude Code's transcripts; null when it could not. */
async function fetchDebug<T>(path: string): Promise<T | null> {
  try {
    const url = new URL(`api/debug/${path}`, new URL('.', import.meta.url))
    const response = await fetch(url.href)
    // The server's JSON has the shape it answers with.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return response.ok ? ((await response.json()) as T) : null
  } catch {
    return null
  }
}

/** The first run of each agent but the main session's: where its prompt shows. */
export function firstRunsOf(comment: ReviewComment): Set<string> {
  const agents = agentsOf(comment)
  const seen = new Set<string>()
  const first = new Set<string>()
  for (const run of runsOf(comment)) {
    const agent = agents.get(run)
    if (!agent || seen.has(agent)) continue
    seen.add(agent)
    if (agent !== 'main') first.add(run)
  }
  return first
}

/**
 * A button that unfolds what the server read in Claude Code's transcripts,
 * `load`ed on the first click.
 */
function TranscriptFold<T>({
  load,
  label,
  title,
  render,
}: {
  load: () => Promise<T | null>
  label: string
  title: string
  render: (found: T) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [found, setFound] = useState<T | null>()
  const toggle = () => {
    setOpen(!open)
    if (found === undefined) void load().then(setFound)
  }
  return (
    <>
      <button
        type="button"
        className="cb-debug-tag cb-debug-id"
        aria-expanded={open}
        title={title}
        onClick={toggle}
      >
        {label}
      </button>
      {open && (
        <div className="cb-debug-call">
          {found === undefined ? (
            <span className="cb-debug-empty">Reading the transcripts…</span>
          ) : found === null ? (
            <span className="cb-debug-empty">
              Not in Claude Code's transcripts of the last 7 days.
            </span>
          ) : (
            render(found)
          )}
        </div>
      )}
    </>
  )
}

/** The transcript's file name, its whole path on hover. */
const TranscriptName = ({
  transcript,
  prefix,
}: {
  transcript: string
  prefix?: string
}) => (
  <span className="cb-debug-empty" title={transcript}>
    {prefix && `${prefix} · `}
    {transcript.split('/').at(-1)}
  </span>
)

/**
 * What an agent was given, in a dialog over the page: its instructions, and
 * its first message exactly as Claude Code recorded it. Escape, the backdrop
 * or ✕ close it.
 */
function AgentPromptDialog({ agent, onClose }: { agent: string; onClose: () => void }) {
  const [found, setFound] = useState<AgentPrompt | null>()
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void fetchDebug<AgentPrompt>(`agent/${agent}`).then(setFound)
  }, [agent])
  useEffect(() => {
    dialog.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    // The backdrop closes it on a click; the keyboard has Escape and the close button.
    <div
      className="cb-debug-backdrop cb-live"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialog}
        className="cb-debug-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`What agent ${agentName(agent)} was given`}
        tabIndex={-1}
      >
        <header className="cb-debug-head">
          <h2>
            Agent {agentName(agent)}{' '}
            <span className="cb-debug-hint">· what it was given</span>
          </h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </header>
        <div className="cb-debug-body cb-debug-call">
          {found === undefined ? (
            <span className="cb-debug-empty">Reading the transcripts…</span>
          ) : found === null ? (
            <span className="cb-debug-empty">
              Not in Claude Code's transcripts of the last 7 days.
            </span>
          ) : (
            <>
              <h3 className="cb-debug-layer">
                Agent{found.agentType && ` ${found.agentType}`}{' '}
                <small>
                  ·{' '}
                  {found.instructions
                    ? `${found.instructions.file}, as on disk now`
                    : 'instructions not found'}
                </small>
              </h3>
              {found.instructions && <pre>{found.instructions.text}</pre>}
              <h3 className="cb-debug-layer">
                First message <small>· exactly as it was sent</small>
              </h3>
              <pre title={found.transcript}>{found.prompt}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** A link on the agent's first run that opens what it was given in a dialog. */
function AgentPromptLink({ agent }: { agent: string }) {
  // The panel it opens in, set by the click: in the separator, the dialog
  // would take its capitals and its pill.
  const [panel, setPanel] = useState<Element | null>(null)
  // Stable: the dialog takes the focus again whenever its onClose changes.
  const close = useCallback(() => setPanel(null), [])
  return (
    <>
      <button
        type="button"
        className="cb-debug-context"
        aria-haspopup="dialog"
        title="What this agent was given: its instructions and its first message"
        onClick={(event) => setPanel(event.currentTarget.closest('.cb-debug'))}
      >
        Context
      </button>
      {panel && createPortal(<AgentPromptDialog agent={agent} onClose={close} />, panel)}
    </>
  )
}

/** A tool call's id: a click unfolds what the agent sent and got back. */
function ToolId({ id }: { id: string }) {
  return (
    <TranscriptFold
      load={() => fetchDebug<ToolCall>(`tool/${id}`)}
      label={id}
      title="Show what the agent sent and got back"
      render={(call) => (
        <>
          <TranscriptName transcript={call.transcript} prefix={call.name} />
          <pre>{JSON.stringify(call.input, null, 2)}</pre>
          {call.result !== undefined && (
            <pre className={call.error ? 'cb-debug-error' : undefined}>{call.result}</pre>
          )}
        </>
      )}
    />
  )
}

function StepEvent({
  step,
  run,
  onRun,
}: {
  step: ReviewProgress
  run: string | undefined
  onRun: (run: string | undefined) => void
}) {
  return (
    <div>
      <strong>{step.kind}</strong>
      {step.state && <span className="cb-debug-tag">{step.state}</span>}
      {step.run && <RunTag run={step.run} selected={run} onSelect={onRun} />}
      {step.id && <ToolId id={step.id} />}
      {step.label && <p>{step.label}</p>}
      {step.error && <p>error: {step.error}</p>}
    </div>
  )
}

function Timeline({
  comment,
  run,
  onRun,
}: {
  comment: ReviewComment
  run: string | undefined
  onRun: (run: string | undefined) => void
}) {
  const runs = runsOf(comment)
  const firstRuns = firstRunsOf(comment)
  return (
    <>
      {runs.length > 0 && (
        <div className="cb-debug-runs" role="group" aria-label="Runs">
          Runs:
          {runs.map((id) => (
            <RunTag key={id} run={id} selected={run} onSelect={onRun} />
          ))}
        </div>
      )}
      <ol className="cb-debug-timeline" aria-label="Conversation">
        {withSeparators(timelineOf(comment, run), agentsOf(comment)).map(
          (event, index) =>
            event.kind === 'separator' ? (
              // One per run: keyed by it, its dialog stays open while rows come in above it.
              <SeparatorRow
                key={`run ${event.run}`}
                separator={event}
                // On the agent's first run, filtered or not; the main session's prompt is the user's.
                context={
                  event.agent && firstRuns.has(event.run) ? (
                    <AgentPromptLink agent={event.agent} />
                  ) : undefined
                }
              />
            ) : (
              <li
                // The timeline is rebuilt from the comment on every change: its order is its identity.
                // oxlint-disable-next-line react/no-array-index-key
                key={index}
                className={`cb-debug-event cb-debug-event--${event.kind}${
                  event.kind === 'step' && event.step.state === 'failed'
                    ? ' cb-debug-event--failed'
                    : ''
                }`}
              >
                <Time at={event.at} />
                {event.kind === 'status' ? (
                  <div>
                    {event.state ? (
                      <StateChip state={event.state} />
                    ) : (
                      <strong>{event.label}</strong>
                    )}
                    {event.run && (
                      <RunTag run={event.run} selected={run} onSelect={onRun} />
                    )}
                    {event.detail && <p>{event.detail}</p>}
                  </div>
                ) : event.kind === 'message' ? (
                  <MessageEvent message={event.message} run={run} onRun={onRun} />
                ) : (
                  <StepEvent step={event.step} run={run} onRun={onRun} />
                )}
              </li>
            ),
        )}
      </ol>
    </>
  )
}

function Fields({ comment }: { comment: ReviewComment }) {
  const { anchor } = comment
  const rows: [string, ReactNode][] = [
    ['id', comment.id],
    ['state', <StateChip key="state" state={comment.state} />],
    ['route', comment.route],
    ['url', comment.url],
    ['section', anchor.section],
    ['quote', anchor.quote && `${anchor.quote} (#${anchor.occurrence})`],
    ['element', anchor.element?.selector],
    ['createdAt', comment.createdAt],
    [
      'runs',
      runsOf(comment)
        .map((id) => {
          const agent = agentsOf(comment).get(id)
          return agent ? `${id} (${agentName(agent)})` : id
        })
        .join(', '),
    ],
  ]
  return (
    <dl className="cb-debug-fields">
      {rows
        .filter(([, value]) => !!value)
        .map(([name, value]) => (
          <Fragment key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
    </dl>
  )
}

/**
 * The panel itself, toggled by DebugToggle or Alt+Shift+D. `held` is what the
 * widget holds; comments of other pages come from a list of its own.
 */
export function DebugPanel({
  held,
  current,
}: {
  held: ReviewComment[]
  current?: string
}) {
  const open = useShown()
  const raw = useRaw()
  // Picked while the widget showed `current`: a thread opened since takes over.
  const [selected, setSelected] = useState<{ id: string; current?: string }>()
  // The run the timeline shows alone, for the comment it was picked on.
  const [run, setRun] = useState<{ comment: string; run: string }>()
  const others = useCommentHistory(open)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcut(event)) return
      // What the reader types in a field stays theirs: Alt+Shift+D is a character on macOS.
      const target = event.composedPath()[0]
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return
      }
      event.preventDefault()
      toggleDebug()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!open) return null
  // The history's copy also has the server's lines: the widget's own lists do not.
  const polled = new Map(others.comments.map((entry) => [entry.id, entry]))
  const comments = [...held, ...others.comments]
    .filter(
      (comment, index, list) =>
        list.findIndex((other) => other.id === comment.id) === index,
    )
    .map((comment) => {
      const { history, lines } = polled.get(comment.id) ?? {}
      return {
        ...comment,
        ...(history ? { history } : {}),
        ...(lines ? { lines } : {}),
      }
    })
  const comment =
    comments.find((entry) => entry.id === selected?.id && selected.current === current) ??
    comments.find((entry) => entry.id === current) ??
    comments[0]

  return (
    <section className="cb-debug cb-live" data-testid="cb-debug" aria-label="Debug panel">
      <style>{DEBUG_CSS}</style>
      <header className="cb-debug-head">
        <h2>
          Debug <span className="cb-debug-hint">· {comments.length} comments</span>
        </h2>
        <IconButton
          icon="x"
          label="Close the debug panel"
          onClick={() => toggleDebug(false)}
        />
      </header>
      {comments.length > 0 && (
        <nav className="cb-debug-list" aria-label="Comments">
          {comments.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={entry.id === comment?.id}
              title={entry.messages[0]?.body}
              onClick={() =>
                setSelected({ id: entry.id, ...(current ? { current } : {}) })
              }
            >
              {entry.id}
            </button>
          ))}
        </nav>
      )}
      <div className="cb-debug-body">
        {comment ? (
          <>
            <Fields comment={comment} />
            <a
              className="cb-debug-file"
              href={stepsUrl(comment.id)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open the step files ({comment.id}.history.jsonl)
            </a>
            <Timeline
              comment={comment}
              run={run?.comment === comment.id ? run.run : undefined}
              onRun={(picked) =>
                setRun(picked ? { comment: comment.id, run: picked } : undefined)
              }
            />
            <details
              className="cb-debug-raw"
              open={raw}
              onToggle={(event) => update({ raw: event.currentTarget.open })}
            >
              <summary>Raw ReviewComment</summary>
              <pre>{JSON.stringify(comment, null, 2)}</pre>
            </details>
          </>
        ) : (
          <span className="cb-debug-empty">No comment yet.</span>
        )}
      </div>
    </section>
  )
}
