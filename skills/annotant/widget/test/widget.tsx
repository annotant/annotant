import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import App from '../src/App'

/** The widget over a page of its own, as main.tsx mounts it (without the shadow root). */
export function renderWidget() {
  const page = document.createElement('main')
  page.innerHTML = '<h1>Playground</h1>'
  document.body.append(page)
  const view = render(<App root={page} />)
  return {
    ...view,
    unmount() {
      view.unmount()
      page.remove()
    },
  }
}

/** A comment on the page: the strip's Comments, then New comment, needed when it showed threads that need the reader (disabled otherwise). */
export async function startPageComment() {
  fireEvent.click(await screen.findByRole('button', { name: /^Comments/ }))
  fireEvent.click(screen.getByRole('button', { name: 'New comment' }))
}

/** The step the thread draws, without the one sliding away or the text read aloud. */
export const shownStep = () =>
  document.querySelector(
    '[data-testid="an-progress"] .an-current-line:not(.an-current-line--out)',
  )?.textContent

/** happy-dom has no CSS Custom Highlight API: a registry to read back. */
export function stubHighlights() {
  const highlights = new Map<string, Set<Range>>()
  vi.stubGlobal('CSS', { escape: CSS.escape, highlights })
  vi.stubGlobal(
    'Highlight',
    class extends Set<Range> {
      constructor(...ranges: Range[]) {
        super(ranges)
      }
    },
  )
  return highlights
}

/** A ResizeObserver whose callbacks the test calls: happy-dom lays nothing out. */
export function resizes() {
  const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      targets = new Set<Element>()
      constructor(callback: ResizeObserverCallback) {
        observers.push({ callback, targets: this.targets })
      }
      observe(target: Element) {
        this.targets.add(target)
      }
      unobserve(target: Element) {
        this.targets.delete(target)
      }
      disconnect() {
        this.targets.clear()
      }
    },
  )
  return (target: Element | null) => {
    for (const { callback, targets } of observers) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the widget reads no entry
      if (target && targets.has(target)) callback([], {} as ResizeObserver)
    }
  }
}
