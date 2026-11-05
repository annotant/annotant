import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type {
  GitPlace,
  NewReviewComment,
  ReviewComment,
  ReviewCommentPatch,
} from './domain'
import { parseEditor, type Editor } from './editor'
import { parseRepository, type Repository } from './links'
import { parseTheme, type ThemeSetting } from './theme'

const API = new URL('api/comments', new URL('.', import.meta.url)).href
const EVENTS = new URL('api/events', new URL('.', import.meta.url)).href
const IMAGES = new URL('api/images/', new URL('.', import.meta.url)).href
const HEALTH = new URL('api/health', new URL('.', import.meta.url)).href
const GIT = new URL('api/git', new URL('.', import.meta.url)).href
const SETTINGS = new URL('api/settings', new URL('.', import.meta.url)).href
const RELEASE = new URL('api/release', new URL('.', import.meta.url)).href
// The server pushes its changes: this reload only catches what a dropped
// stream missed.
const POLL_MS = 30_000
const CHANGED = 'annotant:changed'
// A comment as the server returned it once it accepted a change.
const UPDATED = 'annotant:updated'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  // Headers, not an object spread: a spread drops the entries of a Headers or an array.
  const headers = new Headers(init?.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(url, { ...init, headers })
  if (!response.ok) throw new Error(await failure(response))
  // The server is ours: its JSON has the shape the caller asks for.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

/**
 * The server's own words for a refusal (409: a move the comment cannot make;
 * 422: an image it does not take), else the status. A body too large (413)
 * may come with none, the server closing the connection.
 */
async function failure(response: Response): Promise<string> {
  if (response.status === 413) return 'The message is too large to send.'
  if (response.status === 409 || response.status === 422) {
    const body: unknown = await response.json().catch(() => undefined)
    if (
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string'
    ) {
      return body.error
    }
  }
  return `Request failed (${response.status})`
}

const changed = () => window.dispatchEvent(new Event(CHANGED))

/** The server's changes: one stream per tab, whatever the number of lists. */
let stream: EventSource | undefined
let streamUsers = 0
/** The reconnection planned after the browser gave the stream up. */
let retry: ReturnType<typeof setTimeout> | undefined
const RETRY_MS = 5000

/**
 * Opens the stream. Each opening reloads the lists: the first, for the
 * changes made before the server knew this tab; the next, for those made
 * while it was away.
 */
function connect() {
  const source = new EventSource(EVENTS)
  source.addEventListener('changed', changed)
  source.addEventListener('open', changed)
  // npm run watch rebuilt the dev widget: the page loads the new one. A
  // released widget never listens.
  if (ANNOTANT_DEBUG) source.addEventListener('widget', () => location.reload())
  source.addEventListener('error', () => {
    // Dropped: the lists say whether the server is still there. The browser
    // reconnects by itself, unless something else answered: then we do.
    changed()
    if (source.readyState !== EventSource.CLOSED || retry) return
    retry = setTimeout(() => {
      retry = undefined
      disconnect()
      if (streamUsers > 0 && !document.hidden) connect()
    }, RETRY_MS)
  })
  stream = source
}

function disconnect() {
  clearTimeout(retry)
  retry = undefined
  stream?.close()
  stream = undefined
}

/**
 * Closed while the tab is hidden: each stream holds one of the few
 * connections a browser opens to the server, which every tab shares.
 */
function onVisibility() {
  disconnect()
  if (!document.hidden) connect()
}

/**
 * Reloads the lists each time the server says a comment changed, until the
 * returned function is called by every user.
 */
function listen(): () => void {
  // An older browser, or a test without it: the slow reload alone.
  if (typeof EventSource === 'undefined') return () => undefined
  if (streamUsers++ === 0) {
    if (!document.hidden) connect()
    document.addEventListener('visibilitychange', onVisibility)
  }
  return () => {
    if (--streamUsers > 0) return
    document.removeEventListener('visibilitychange', onVisibility)
    disconnect()
  }
}

/**
 * The comments at `url`, reloaded on each change. With `merge`, a comment the
 * server returns for a change replaces its entry at once: the thread shows
 * its new state before the reload lands.
 */
function useCommentList(url: string | undefined, { merge = true } = {}) {
  const [comments, setComments] = useState<ReviewComment[]>([])
  const [loaded, setLoaded] = useState(false)
  const [reachable, setReachable] = useState(true)
  // Counts the merges: a list asked for before one is older than what it merged.
  const merges = useRef(0)

  const load = useCallback(async () => {
    if (!url) return
    const asked = merges.current
    try {
      const list = await request<ReviewComment[]>(url)
      // The same list keeps its reference: a change of a comment elsewhere
      // would read the whole page again for its marks.
      if (asked === merges.current)
        setComments((current) =>
          JSON.stringify(current) === JSON.stringify(list) ? current : list,
        )
      setReachable(true)
    } catch {
      setReachable(false)
    } finally {
      setLoaded(true)
    }
  }, [url])

  useEffect(() => {
    if (!url) return undefined
    // load() never rejects: it records failures as `reachable: false`.
    const reload = () => void load()
    reload()
    const timer = setInterval(reload, POLL_MS)
    window.addEventListener(CHANGED, reload)
    const unlisten = listen()
    return () => {
      clearInterval(timer)
      window.removeEventListener(CHANGED, reload)
      unlisten()
    }
  }, [url, load])

  useEffect(() => {
    if (!url || !merge) return undefined
    const update = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      // Dispatched by updateComment alone, with the server's comment.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const updated = event.detail as ReviewComment
      merges.current++
      // Not in the list, or as it was: the list keeps its reference.
      setComments((current) =>
        current.some(
          (comment) =>
            comment.id === updated.id &&
            JSON.stringify(comment) !== JSON.stringify(updated),
        )
          ? current.map((comment) => (comment.id === updated.id ? updated : comment))
          : current,
      )
    }
    window.addEventListener(UPDATED, update)
    return () => window.removeEventListener(UPDATED, update)
  }, [url, merge])

  return { comments, loaded, reachable }
}

export function useComments(route: string) {
  return useCommentList(`${API}?route=${encodeURIComponent(route)}`)
}

export function useAllComments(enabled: boolean) {
  return useCommentList(enabled ? `${API}?all=1` : undefined)
}

/** Every comment with every step of every run: the debug panel's list. */
export function useCommentHistory(enabled: boolean) {
  // The server returns a comment without its history: the reload brings it.
  return useCommentList(enabled ? `${API}?all=1&history=1` : undefined, {
    merge: false,
  })
}

/**
 * What the server tells the widget about the project: how the app switches
 * between light and dark and the editor its files open in, as it read them
 * in `.annotant.json`, the project's root, and the repository of its `origin`
 * remote. Each undefined until it answers, and when it has none.
 */
export function useServerSettings() {
  const [settings, setSettings] = useState<{
    theme?: ThemeSetting | undefined
    repository?: Repository | undefined
    root?: string | undefined
    editor?: Editor | undefined
    /** `editor` in `.annotant.json` names nothing the widget can open. */
    editorIgnored?: true | undefined
  }>({})
  useEffect(() => {
    let live = true
    const load = async () => {
      const health = await request<unknown>(HEALTH)
      if (!live || !health || typeof health !== 'object') return
      const theme = 'theme' in health ? health.theme : undefined
      const parsed = parseTheme(theme)
      // A hand-edited setting the widget cannot read: said, then the page's background.
      if (theme !== undefined && !parsed) {
        console.warn('Annotant: ignoring `theme` in .annotant.json:', theme)
      }
      const remote = 'repository' in health ? health.repository : undefined
      const repository = parseRepository(remote)
      // A server from another release: its issues stay text.
      if (remote !== undefined && !repository) {
        console.warn("Annotant: ignoring the server's `repository`:", remote)
      }
      const project = 'project' in health ? health.project : undefined
      const root = typeof project === 'string' && project ? project : undefined
      const named = 'editor' in health ? health.editor : undefined
      const editor = parseEditor(named)
      const editorIgnored = named !== undefined && named !== false && !editor
      if (editorIgnored) {
        console.warn('Annotant: ignoring `editor` in .annotant.json:', named)
      }
      setSettings({
        theme: parsed,
        repository,
        root,
        editor,
        ...(editorIgnored && { editorIgnored }),
      })
    }
    // No server: the lists say so; the page's background picks the theme meanwhile.
    load().catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  return settings
}

/** A release of Annotant newer than this widget: its version and its notes. */
export type Release = { version: string; url: string }

const versionParts = (version: string) => version.split('.').map(Number)

/** `a` is a later `x.y.z` than `b`. */
export function isNewer(a: string, b: string) {
  const [x, y] = [versionParts(a), versionParts(b)]
  for (let at = 0; at < 3; at++) {
    const diff = (x[at] ?? 0) - (y[at] ?? 0)
    if (diff) return diff > 0
  }
  return false
}

/**
 * The newest release of Annotant, as the server learnt it from GitHub, when it
 * is newer than this widget; undefined otherwise, and while it is not known.
 */
export function useNewerRelease(current: string) {
  const [release, setRelease] = useState<Release>()
  useEffect(() => {
    let live = true
    const load = async () => {
      const body = await request<unknown>(RELEASE)
      if (!live || !body || typeof body !== 'object') return
      const version = 'version' in body ? body.version : undefined
      const url = 'url' in body ? body.url : undefined
      if (
        typeof version === 'string' &&
        /^\d+\.\d+\.\d+$/.test(version) &&
        typeof url === 'string' &&
        url.startsWith('https://github.com/annotant/annotant/releases/') &&
        isNewer(version, current)
      )
        setRelease({ version, url })
    }
    // An older server (404), or none: nothing to say.
    load().catch(() => undefined)
    return () => {
      live = false
    }
  }, [current])
  return release
}

/** A model the settings dialog offers; `inherit` is the session's. */
export type AgentModel = 'haiku' | 'sonnet' | 'opus' | 'inherit'

/**
 * How each comment's model is picked (lib/settings.mjs): `auto`, the
 * classifier's label then a model per label; `fixed`, one model; `custom`, a
 * `models` written by hand the dialog cannot show, its JSON.
 */
export type ModelsSetting =
  | { strategy: 'auto'; trivial: AgentModel; standard: AgentModel; hard: AgentModel }
  | { strategy: 'fixed'; model: AgentModel }
  | { strategy: 'custom'; text: string }

/**
 * The settings dialog's: the instructions `.annotant.json` holds for the
 * agents, and their models (none from an older server).
 */
export type ProjectSettings = {
  instructions: string
  max: number
  models?: ModelsSetting
}

export const fetchSettings = () => request<ProjectSettings>(SETTINGS)

/** Saves what changed: the instructions, the models, or both. */
export const saveSettings = (changes: {
  instructions?: string
  models?: Exclude<ModelsSetting, { strategy: 'custom' }>
}) =>
  request<ProjectSettings>(SETTINGS, {
    method: 'POST',
    body: JSON.stringify(changes),
  })

/** Where the project is in git now, and whether that is its default branch. */
export type GitNow = GitPlace & { default?: true }

/** The server's answer, when it says a place; anything else says none. */
function parseGitNow(value: unknown): GitNow | undefined {
  if (!value || typeof value !== 'object') return undefined
  const text = (key: string) => {
    const field: unknown = Reflect.get(value, key)
    return typeof field === 'string' && field ? field : undefined
  }
  const branch = text('branch')
  const commit = text('commit')
  const worktree = text('worktree')
  const named = branch ? { branch } : commit ? { commit } : undefined
  if (!named) return undefined
  return {
    ...named,
    ...(worktree && { worktree }),
    // Only a branch is a default one.
    ...(branch && Reflect.get(value, 'default') === true && { default: true }),
  }
}

/**
 * Where the agents write: the project's branch and worktree, read again on
 * each change the server pushes, when the reader comes back to the page (they
 * may have switched branch in a terminal) and every POLL_MS, while `enabled`
 * (the panel is open). Undefined outside a git repository, until the server
 * answers, and when it fails: never a branch that may be stale.
 */
export function useGitPlace(enabled: boolean) {
  const [place, setPlace] = useState<GitNow>()
  useEffect(() => {
    if (!enabled) return undefined
    let live = true
    // Each read numbered: an answer slower than a later one is dropped, never
    // shown over it.
    let asked = 0
    let shown = 0
    const show = (read: number, now: GitNow | undefined) => {
      if (!live || read < shown) return
      shown = read
      setPlace((current) =>
        JSON.stringify(current) === JSON.stringify(now) ? current : now,
      )
    }
    // No server, or an older one: no branch, rather than one that may be stale.
    const load = () => {
      const read = ++asked
      void request<unknown>(GIT).then(
        (answer) => show(read, parseGitNow(answer)),
        () => show(read, undefined),
      )
    }
    load()
    const timer = setInterval(load, POLL_MS)
    window.addEventListener(CHANGED, load)
    window.addEventListener('focus', load)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener(CHANGED, load)
      window.removeEventListener('focus', load)
      // Opened again, the panel waits for a fresh answer.
      setPlace(undefined)
    }
  }, [enabled])
  return place
}

export async function createComment(input: NewReviewComment): Promise<ReviewComment> {
  const comment = await request<ReviewComment>(API, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  changed()
  return comment
}

export async function updateComment(
  id: string,
  patch: ReviewCommentPatch,
): Promise<ReviewComment> {
  const comment = await request<ReviewComment>(`${API}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  window.dispatchEvent(new CustomEvent(UPDATED, { detail: comment }))
  changed()
  return comment
}

/** Where the server serves image `name` of comment `id`. */
export const imageUrl = (id: string, name: string) =>
  `${IMAGES}${encodeURIComponent(id)}/${encodeURIComponent(name)}`

/** One line of a run's diff of a file: kept, added or removed. */
interface DiffLine {
  kind: 'context' | 'added' | 'removed'
  text: string
}

/**
 * A run's diff of a file: its hunks, like `diff -u`'s, or why it is not shown;
 * `diffs.mjs` in the scripts is the reference.
 */
export type FileDiff =
  | {
      hunks: {
        oldStart: number
        oldLines: number
        newStart: number
        newLines: number
        lines: DiffLine[]
      }[]
    }
  | { skipped: 'large' | 'binary' }
  /** The run kept none: before this was recorded, or cut short. */
  | { missing: true }

/**
 * What run `run` of comment `id` did to `file`, as its message's `changed`
 * names it. A 404 is a server without the route: an error, not "none kept".
 */
export async function fetchDiff(
  id: string,
  run: string,
  file: string,
): Promise<FileDiff> {
  const url = `${API}/${encodeURIComponent(id)}/runs/${encodeURIComponent(run)}/diff?file=${encodeURIComponent(file)}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(await failure(response))
  // The server is ours: its JSON has the shape asked for.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (await response.json()) as FileDiff
}

export async function deleteComment(id: string): Promise<void> {
  await request<void>(`${API}/${id}`, { method: 'DELETE' })
  changed()
}

const ROUTE_POLL_MS = 300

/** The page's path, following client-side navigation of any router. */
export function useRoute(): string {
  return useSyncExternalStore(
    (listener) => {
      const timer = setInterval(listener, ROUTE_POLL_MS)
      window.addEventListener('popstate', listener)
      return () => {
        clearInterval(timer)
        window.removeEventListener('popstate', listener)
      }
    },
    () => window.location.pathname,
  )
}
