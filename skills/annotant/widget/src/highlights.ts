import type { ReviewAnchor } from './domain'
import { elementFromAnchor, rangeFromAnchor, scrollToArea } from './anchors'
import { scrollBehavior } from './styles'

/**
 * The text the comment being written is about, until it is saved. Saved, it
 * gets a rainbow (`QuoteBubbles`), which a highlight cannot draw.
 */
const DRAFT_HIGHLIGHT_NAME = 'annotant-draft'

function highlightsApi() {
  return typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : undefined
}

export function paintHighlights(root: Element, draft?: ReviewAnchor): void {
  const highlights = highlightsApi()
  if (!highlights) return
  const drafted = draft && rangeFromAnchor(root, draft)
  highlights.set(DRAFT_HIGHLIGHT_NAME, drafted ? new Highlight(drafted) : new Highlight())
}

export function clearHighlights(): void {
  highlightsApi()?.delete(DRAFT_HIGHLIGHT_NAME)
}

export function scrollToComment(root: Element, anchor: ReviewAnchor): void {
  if (anchor.area) return scrollToArea(root, anchor.area)
  const range = rangeFromAnchor(root, anchor)
  const target =
    elementFromAnchor(root, anchor) ??
    range?.startContainer.parentElement ??
    (anchor.section
      ? Array.from(root.querySelectorAll('h1, h2, h3')).find(
          (heading) => heading.textContent?.trim() === anchor.section,
        )
      : undefined)
  target?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
}
