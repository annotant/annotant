import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Filled in the accent, framed on the surface, or text alone. */
  variant?: 'primary' | 'secondary' | 'tertiary'
  /** 28px high instead of 36px. */
  small?: boolean
  /** Before the label. */
  icon?: IconName
}

/** A button with a label: `type="button"` unless told otherwise. */
export function Button({
  variant = 'primary',
  small,
  icon,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`an-btn an-btn--${variant} ${small ? 'an-btn--sm' : ''} ${className}`}
      {...props}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  )
}

export const BUTTON_CSS = `
.an-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 14px; border-radius: var(--cb-radius);
  border: 1px solid transparent; cursor: pointer; font-weight: 600;
  background: var(--cb-accent); color: var(--cb-on-accent); white-space: nowrap;
  transition: background .15s, border-color .15s, color .15s;
}
.an-btn:hover { background: var(--cb-accent-strong); }
.an-btn:disabled { cursor: default; background: var(--cb-accent-weak); color: var(--cb-disabled); }
.an-btn--secondary { background: var(--cb-surface); color: var(--cb-accent); border-color: var(--cb-border); }
.an-btn--secondary:hover { background: var(--cb-surface-2); border-color: var(--cb-accent); }
.an-btn--tertiary { background: transparent; color: var(--cb-accent); }
.an-btn--tertiary:hover { background: var(--cb-surface-2); }
.an-btn--sm { height: 28px; padding: 0 10px; font-size: 13px; }
.an-btn svg { width: 16px; height: 16px; }
`
