import { Icon } from './Icon'

/** One choice of a `Select`: its value, and the text the reader sees. */
export type SelectOption<T extends string> = { value: T; label: string }

/**
 * A drop-down: the browser's own `<select>`, so the keyboard, screen readers
 * and the phone's picker work as everywhere, drawn as the widget's fields with
 * its chevron, clear of the edge. `onChange` gets an option's value, typed.
 * Name it with `id` and a `<label htmlFor>`, or with `aria-label`.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  id,
  'aria-label': ariaLabel,
  disabled,
}: {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  id?: string
  'aria-label'?: string
  disabled?: boolean
}) {
  return (
    <span className="an-select" data-disabled={disabled || undefined}>
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const picked = options.find((option) => option.value === event.target.value)
          if (picked) onChange(picked.value)
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" />
    </span>
  )
}

/** The browser's arrow hidden, ours drawn clear of the edge. */
export const SELECT_CSS = `
.an-select { position: relative; display: inline-flex; align-items: center; min-width: 0; }
.an-select select {
  appearance: none; -webkit-appearance: none; width: 100%; min-width: 0; height: 30px; margin: 0;
  padding: 0 32px 0 10px; border: 1px solid var(--cb-border); border-radius: 6px;
  background: var(--cb-surface-2); color: inherit; font: inherit; font-size: 13px;
  line-height: 28px; text-overflow: ellipsis; cursor: pointer; outline: none;
  transition: border-color .12s ease, box-shadow .12s ease;
}
.an-select select:hover { border-color: var(--cb-muted); }
.an-select select:focus-visible { border-color: var(--cb-accent); box-shadow: 0 0 0 3px var(--cb-accent-weak); }
.an-select svg { position: absolute; right: 10px; width: 14px; height: 14px; color: var(--cb-muted); pointer-events: none; }
.an-select select:hover + svg, .an-select select:focus-visible + svg { color: var(--cb-text); }
.an-select[data-disabled] select { cursor: not-allowed; opacity: .55; }
`
