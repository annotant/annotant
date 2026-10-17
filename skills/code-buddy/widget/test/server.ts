import { act } from '@testing-library/react'
import { expect, vi } from 'vitest'
import type {
  NewReviewComment,
  ReviewAnchor,
  ReviewComment,
  ReviewCommentPatch,
  ReviewMessage,
} from '../src/domain'

const PAGE = '/'

type Fields = Partial<Omit<ReviewComment, 'anchor' | 'messages'>> &
  Partial<ReviewAnchor> & {
    /** The reader's comment, the thread's first message. */
    body?: string
    /** The thread after the reader's comment: numbered from m2. */
    messages?: Omit<ReviewMessage, 'id'>[]
  }

/**
 * A comment on the page, open and not yet claimed: override what the test
 * needs, the anchor's fields and the thread after the comment included.
 */
export function comment({
  body = 'Make the title bigger',
  messages = [],
  section = '',
  quote = '',
  occurrence = 0,
  element,
  area,
  ...fields
}: Fields = {}): ReviewComment {
  const createdAt = fields.createdAt ?? '2026-01-01T10:00:00.000Z'
  const state = fields.state ?? 'open'
  return {
    id: 'c1',
    route: PAGE,
    url: `http://localhost${PAGE}`,
    anchor: {
      section,
      quote,
      occurrence,
      ...(element ? { element } : {}),
      ...(area ? { area } : {}),
    },
    state: 'open',
    createdAt,
    messages: [
      { id: 'm1', author: 'reader', body, at: createdAt },
      ...messages.map((message, index) => ({ id: `m${index + 2}`, ...message })),
    ],
    // The state is always the last event's.
    events: [
      { at: createdAt, state: 'open', by: 'reader' },
      ...(state === 'open'
        ? []
        : [
            {
              at: createdAt,
              state,
              by: state === 'stopped' ? 'reader' : 'agent',
            } as const,
          ]),
    ],
    ...fields,
  }
}

/**
 * Stands in for the Code Buddy server: serves `comments`, adds the ones POSTed
 * and records each PATCH. `reachable: false` fails the page's list, as when no session runs.
 */
export function fakeServer(comments: ReviewComment[], { reachable = true } = {}) {
  const patches: { id: string; patch: ReviewCommentPatch }[] = []
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    if (init?.method === 'PATCH') {
      const id = url.pathname.split('/').at(-1) ?? ''
      const body = typeof init.body === 'string' ? init.body : ''
      // The widget sends a patch: the test reads it back as one.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const patch = JSON.parse(body) as ReviewCommentPatch
      patches.push({ id, patch })
      return Response.json(comments.find((entry) => entry.id === id))
    }
    if (init?.method === 'POST') {
      const body = typeof init.body === 'string' ? init.body : ''
      // The widget sends a new comment: the test reads it back as one.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const { anchor, elements, ...fields } = JSON.parse(body) as NewReviewComment
      const created = comment({ id: `c${comments.length + 1}`, ...fields, ...anchor })
      const [first] = created.messages
      if (elements && first) created.messages[0] = { ...first, elements }
      comments.push(created)
      return Response.json(created)
    }
    if (!reachable && url.searchParams.has('route')) {
      return new Response(null, { status: 502 })
    }
    // Like the server, the lines it printed only come with the history.
    return Response.json(
      url.searchParams.get('history') === '1'
        ? comments
        : comments.map((entry) => ({ ...entry, lines: undefined })),
    )
  })
  vi.stubGlobal('fetch', fetch)
  return { patches, fetch }
}

/** Opens the panel on a thread, as the reader left it. */
export function openThread(id: string, view: 'page' | 'all' = 'page') {
  openPanel(view, id)
}

/** Opens the panel on the list of `view`, or on a thread. */
export function openPanel(view: 'page' | 'all' = 'page', threadId?: string) {
  sessionStorage.setItem(
    'code-buddy:ui',
    JSON.stringify({ open: true, docked: false, width: 380, view, threadId }),
  )
}

/** Stands in for the server's event stream: the test sends its events. */
export function fakeEvents() {
  const streams: FakeEventSource[] = []
  class FakeEventSource extends EventTarget {
    static readonly CLOSED = 2
    /** Connecting or open: the browser retries by itself. */
    readyState = 0
    closed = false
    constructor(readonly url: string) {
      super()
      streams.push(this)
    }
    close() {
      this.closed = true
    }
  }
  vi.stubGlobal('EventSource', FakeEventSource)
  return {
    streams,
    /** Sends `type` on the stream the widget listens to. */
    send(type: string) {
      const open = streams.filter((stream) => !stream.closed)
      expect(open).toHaveLength(1)
      act(() => {
        open[0]?.dispatchEvent(new Event(type))
      })
    },
  }
}
