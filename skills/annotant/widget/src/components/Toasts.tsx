import { useSyncExternalStore } from 'react'

interface Toast {
  id: number
  text: string
  error?: boolean
}

let toasts: Toast[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

/** Shows `text` for a few seconds in `Toasts`, in red when it is an `error`. */
export function toast(text: string, error = false) {
  const id = Date.now() + Math.random()
  toasts = [...toasts, { id, text, error }]
  emit()
  setTimeout(() => {
    toasts = toasts.filter((entry) => entry.id !== id)
    emit()
  }, 3500)
}

/** The toasts `toast` shows, at the bottom of the page, read out by screen readers. */
export function Toasts() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => toasts,
  )
  const list = (error: boolean) =>
    current
      .filter((entry) => Boolean(entry.error) === error)
      .map((entry) => (
        <div
          key={entry.id}
          className={`an-toast ${entry.error ? 'an-toast--error' : ''}`}
        >
          {entry.text}
        </div>
      ))
  // Both always there, even empty: a screen reader only announces what
  // changes in a live region it already knew. Side by side, not nested, so
  // an error is announced once, and interrupts.
  return (
    <div className="an-toasts an-live">
      <div role="status">{list(false)}</div>
      <div role="alert">{list(true)}</div>
    </div>
  )
}

export const TOASTS_CSS = `
.an-toasts { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); }
.an-toasts > div { display: flex; flex-direction: column; gap: 8px; }
.an-toasts > :not(:empty) ~ :not(:empty) { margin-top: 8px; }
.an-toast { padding: 10px 14px; border-radius: var(--cb-radius); background: var(--cb-text); color: var(--cb-surface); font-size: 13px; box-shadow: var(--cb-shadow); }
.an-toast--error { background: var(--cb-red); }
`
