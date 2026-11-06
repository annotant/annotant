import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'

interface ToolButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  /** Its accessible name and its tooltip, while it is idle. */
  label: string
  /** In progress: the button says Cancel after its icon. */
  active?: boolean
}

/**
 * A tool of the dock: its icon alone, or Cancel while it is in progress. The
 * same button either way, so it keeps the focus.
 */
export function ToolButton({
  icon,
  label,
  active,
  className = '',
  ...props
}: ToolButtonProps) {
  return (
    <button
      type="button"
      aria-label={active ? undefined : label}
      title={active ? undefined : label}
      className={`an-btn an-btn--secondary an-btn--sm an-tool ${active ? '' : 'an-tool--idle'} ${className}`}
      {...props}
    >
      <Icon name={icon} />
      {active && 'Cancel'}
    </button>
  )
}

/** After the button's: it overrides `.an-btn--secondary` and `.an-btn--sm`. */
export const TOOL_BUTTON_CSS = `
.an-tool { border-radius: 7px; }
.an-tool:not(.an-tool--idle) { background: var(--cb-accent-weak); border-color: transparent; }
.an-tool:not(.an-tool--idle):hover { background: var(--cb-accent-tint); }
.an-tool--idle { width: 30px; height: 30px; padding: 0; justify-content: center; border-color: transparent; }
.an-tool--idle svg { width: 18px; height: 18px; }
`
