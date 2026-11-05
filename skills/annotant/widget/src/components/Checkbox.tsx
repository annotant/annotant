import type { ReactNode } from 'react'

/** A checkbox with its label, `children`, which toggles it too. */
export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
}) {
  return (
    <label className="an-checkbox">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{children}</span>
    </label>
  )
}

export const CHECKBOX_CSS = `
.an-checkbox { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: var(--cb-accent); }
.an-checkbox input { width: 16px; height: 16px; margin: 0; accent-color: var(--cb-accent); }
`
