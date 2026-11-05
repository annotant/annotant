import type { KeyboardEvent } from 'react'

/** Arrow keys step through a radio group, wrapping; Home and End jump to its ends. */
const RADIO_STEPS: Record<string, (index: number, count: number) => number> = {
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  ArrowUp: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
}

/**
 * A radio group as screen readers expect it: one Tab stop, the checked radio,
 * and arrow keys that check and focus the next one.
 */
export function Toggle<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  /** The group's accessible name. */
  label: string
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Alt+Left and the like are the browser's, not the group's.
    const step =
      !event.altKey && !event.ctrlKey && !event.metaKey && RADIO_STEPS[event.key]
    if (!step) return
    event.preventDefault()
    const current = options.findIndex((option) => option.value === value)
    const next = step(Math.max(current, 0), options.length)
    const option = options[next]
    if (!option) return
    onChange(option.value)
    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
  }
  return (
    <div className="an-toggle" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export const TOGGLE_CSS = `
.an-toggle { align-self: flex-start; display: inline-flex; padding: 2px; border: 1px solid var(--cb-border); border-radius: 6px; }
.an-toggle button { border: 0; background: transparent; padding: 2px 10px; border-radius: 4px; cursor: pointer; font-size: 13px; }
.an-toggle button[aria-checked='true'] { background: var(--cb-accent-weak); color: var(--cb-accent); }
`
