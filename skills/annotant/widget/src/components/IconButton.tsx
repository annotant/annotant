import type { ButtonHTMLAttributes, Ref } from 'react'
import { Icon, type IconName } from './Icon'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  /** Its accessible name and its tooltip. */
  label: string
  /** Smaller, in red: what deletes. */
  danger?: boolean
  /** The keyboard shortcut doing the same, shown in the tooltip. */
  keys?: string
  /** React 19 passes it with the props, to the button. */
  ref?: Ref<HTMLButtonElement>
}

/** A button showing only its icon, its label in the tooltip. */
export function IconButton({
  icon,
  label,
  danger,
  keys,
  className = '',
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={keys ? `${label} (${keys})` : label}
      className={`an-icon-btn ${danger ? 'an-icon-btn--danger' : ''} ${className}`}
      {...props}
    >
      <Icon name={icon} />
    </button>
  )
}

export const ICON_BUTTON_CSS = `
.an-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: var(--cb-text); cursor: pointer;
}
.an-icon-btn:hover { background: var(--cb-surface-2); }
.an-icon-btn:disabled { cursor: default; opacity: .35; background: transparent; }
.an-icon-btn svg { width: 18px; height: 18px; }
.an-icon-btn--danger { color: var(--cb-red); width: 22px; height: 22px; }
.an-icon-btn--danger svg { width: 14px; height: 14px; }
`
