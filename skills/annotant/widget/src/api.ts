import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { NewReviewComment, ReviewComment, ReviewCommentPatch } from './domain'

const API = new URL('api/comments', new URL('.', import.meta.url)).href
const EVENTS = new URL('api/events', new URL('.', import.meta.url)).href
const IMAGES = new URL('api/images/', new URL('.', import.meta.url)).href
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
