import { type KeyboardEvent, type Ref, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'
import { IconButton } from './IconButton'

export interface MenuItem {
  icon: IconName
  label: string
  /** A second, quieter line under the label. */
  detail?: string | undefined
  onSelect: () => void
}

const MENU_KEYS: Record<string, (at: number, count: number) => number> = {
  ArrowDown: (at, count) => (at + 1) % count,
  ArrowUp: (at, count) => (at - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
}

/**
 * A button opening a menu of what is used less often. Opened, its first item
 * has the focus and the arrow keys move it; Escape closes it, the focus back
 * on the button. An item chosen closes it too, and so does the focus leaving
 * it: a click outside, or Tab.
 */
export function MenuButton({
  label,
  items,
  dot,
  onOpen,
  ref,
}: {
  label: string
  items: readonly MenuItem[]
  /** Something new in the menu: a dot on its button, and these words for a screen reader. */
  dot?: string | undefined
  /** The menu opened: what the dot told is seen. */
  onOpen?: (() => void) | undefined
  /** Its button: what opens from the menu gives the focus back to it. React 19 passes it with the props. */
  ref: Ref<HTMLButtonElement>
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const closeMenu = () => {
    setOpen(false)
    wrap.current?.querySelector('button')?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // Not the panel's Escape, which closes it.
      event.preventDefault()
      event.stopPropagation()
      closeMenu()
      return
    }
    const move = MENU_KEYS[event.key]
    if (!move) return
    event.preventDefault()
    const all = [
      ...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ]
    const at = all.findIndex((entry) => entry === event.target)
    all[move(at, all.length)]?.focus()
  }

  return (
    <div
      className="an-menu-wrap"
      ref={wrap}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <IconButton
        ref={ref}
        icon="dots"
        label={label}
        className="an-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        // The focus stays where it is: in the menu, so that a click closing it is not a blur
        // reopening it (Safari focuses no button on a click).
        onMouseDown={(event) => event.preventDefault()}
        aria-description={dot}
        onClick={() => {
          if (!open) onOpen?.()
          setOpen(!open)
        }}
      />
      {dot && <span className="an-menu-dot" aria-hidden="true" />}
      {open && (
        <div
          // Its first item takes the focus as it opens.
          ref={(menu) => menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()}
          role="menu"
          aria-label={label}
          className="an-menu"
          onKeyDown={onKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="an-menu-item"
              onClick={() => {
                closeMenu()
                item.onSelect()
              }}
            >
              <Icon name={item.icon} />
              {item.detail ? (
                <span className="an-menu-text">
                  {item.label}
                  <small>{item.detail}</small>
                </span>
              ) : (
                item.label
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export const MENU_BUTTON_CSS = `
/* What the header uses less often, in a menu under its last but one button. */
.an-menu-wrap { position: relative; display: inline-flex; }
.an-menu-btn svg { stroke-width: 3; }
.an-menu {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: 4; min-width: 220px;
  display: flex; flex-direction: column; padding: 4px; border: 1px solid var(--cb-border);
  border-radius: 8px; background: var(--cb-surface); box-shadow: 0 8px 24px rgba(0,0,0,.15);
  animation: an-fade-in .12s ease-out;
}
.an-menu-item {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 10px; border: 0;
  border-radius: 6px; background: none; color: var(--cb-text); font: inherit; font-size: 13px;
  text-align: left; white-space: nowrap; cursor: pointer;
}
.an-menu-item:hover, .an-menu-item:focus-visible { background: var(--cb-surface-2); outline: none; }
.an-menu-item svg { width: 16px; height: 16px; flex-shrink: 0; color: var(--cb-muted); }
/* An item with a second line: what to run, say, under what is new. */
.an-menu-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.an-menu-text small { font-size: 11px; color: var(--cb-muted); font-family: var(--cb-mono); }
/* Something new in the menu, until it opens. */
.an-menu-dot { position: absolute; top: 4px; right: 4px; width: 8px; height: 8px; border-radius: 50%; background: var(--cb-accent); box-shadow: 0 0 0 2px var(--cb-surface); pointer-events: none; }
`
