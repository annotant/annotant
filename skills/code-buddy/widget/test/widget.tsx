import { render } from '@testing-library/react'
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

/** The step the thread draws, without the one sliding away or the text read aloud. */
export const shownStep = () =>
  document.querySelector(
    '[data-testid="cb-progress"] .cb-current-line:not(.cb-current-line--out)',
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
