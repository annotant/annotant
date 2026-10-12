import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { NewReviewComment, ReviewComment, ReviewCommentPatch } from './domain'

const API = new URL('api/comments', new URL('.', import.meta.url)).href
const EVENTS = new URL('api/events', new URL('.', import.meta.url)).href
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

/** The server's own words for a refusal (409: a move the comment cannot make), else the status. */
async function failure(response: Response): Promise<string> {
  if (response.status === 409) {
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

/** The server's changes, one stream per tab whatever the number of lists. */
let stream: EventSource | undefined
let streamUsers = 0
/** Whether the stream dropped since it last opened. */
let dropped = false

/**
 * Reloads the lists each time the server says a comment changed, until the
 * returned function is called by every user.
 */
function listen(): () => void {
  // An older browser, or a test without it: the slow reload alone.
  if (typeof EventSource === 'undefined') return () => undefined
  if (streamUsers++ === 0) {
    const source = new EventSource(EVENTS)
    source.addEventListener('changed', changed)
    // Dropped (the server stopped): the lists say it is unreachable. Opened
    // again: the changes made meanwhile were missed.
    source.addEventListener('error', () => {
      if (dropped) return
      dropped = true
      changed()
    })
    source.addEventListener('open', () => {
      if (!dropped) return
      dropped = false
      changed()
    })
    stream = source
  }
  return () => {
    if (--streamUsers > 0) return
    stream?.close()
    stream = undefined
    dropped = false
  }
}

function usePolledComments(url: string | undefined) {
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
  return usePolledComments(`${API}?route=${encodeURIComponent(route)}`)
}

export function useAllComments(enabled: boolean) {
  return usePolledComments(enabled ? `${API}?all=1` : undefined)
}

/** Every comment with every step of every run: the debug panel's list. */
export function useCommentHistory(enabled: boolean) {
  return usePolledComments(enabled ? `${API}?all=1&history=1` : undefined)
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
