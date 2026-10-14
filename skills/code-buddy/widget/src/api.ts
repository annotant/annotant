import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { NewReviewComment, ReviewComment, ReviewCommentPatch } from './domain'

const API = new URL('api/comments', new URL('.', import.meta.url)).href
const EVENTS = new URL('api/events', new URL('.', import.meta.url)).href
const IMAGES = new URL('api/images/', new URL('.', import.meta.url)).href
// The server pushes its changes: this reload only catches what a dropped
// stream missed.
const POLL_MS = 30_000
const CHANGED = 'code-buddy:changed'

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
 * 422: an image it does not take), else the status.
 */
async function failure(response: Response): Promise<string> {
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

function useCommentList(url: string | undefined) {
  const [comments, setComments] = useState<ReviewComment[]>([])
  const [loaded, setLoaded] = useState(false)
  const [reachable, setReachable] = useState(true)

  const load = useCallback(async () => {
    if (!url) return
    try {
      setComments(await request<ReviewComment[]>(url))
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
  return useCommentList(enabled ? `${API}?all=1&history=1` : undefined)
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
