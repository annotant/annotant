import type { ReactNode } from 'react'
import type { Status } from '../domain'

/** A comment's state, as a pill in the colour of that state. */
export function Chip({
  tone,
  small = false,
  children,
}: {
  tone: Status
  /** The debug panel's: smaller, beside a line of text. */
  small?: boolean
  children: ReactNode
}) {
  return (
    <span className={`an-chip an-chip--${tone}${small ? ' an-chip--small' : ''}`}>
      {children}
    </span>
  )
}

export const CHIP_CSS = `
.an-chip { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 11px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.an-chip--open { background: var(--cb-accent-weak); color: var(--cb-accent); }
.an-chip--claimed { background: var(--cb-accent-tint); color: var(--cb-accent-strong); }
.an-chip--asking { background: var(--cb-amber-bg); color: var(--cb-amber-fg); }
.an-chip--answered { background: var(--cb-violet-bg); color: var(--cb-violet); }
.an-chip--resolved { background: var(--cb-green-bg); color: var(--cb-green); }
.an-chip--stopped { background: var(--cb-red-bg); color: var(--cb-red); }
.an-chip--small { height: 18px; padding: 0 7px; border-radius: 9px; font-size: 11px; vertical-align: 1px; }
`
