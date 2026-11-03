import { useEffect, useState } from 'react'
import type { FileDiff } from './api'

/** How many lines a run added to a file and removed from it. */
export type LineCounts = { added: number; removed: number }

type Loaded =
  | { state: 'loading' }
  | { state: 'failed'; error: string }
  | { state: 'done'; diff: FileDiff }

/**
 * What one run did to one file: its unified diff, loaded once it opens, added
 * lines green and removed ones red, each with its old and new line numbers, in
 * a box that scrolls when long. `onCounts` hears how many lines it changed.
 */
export function FileDiffView({
  load,
  onCounts,
}: {
  load: () => Promise<FileDiff>
  onCounts?: ((counts: LineCounts) => void) | undefined
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  useEffect(() => {
    let current = true
    void (async () => {
      try {
        const diff = await load()
        if (!current) return
        setLoaded({ state: 'done', diff })
        if ('hunks' in diff) onCounts?.(countLines(diff.hunks))
      } catch (error) {
        if (current)
          setLoaded({
            state: 'failed',
            error: error instanceof Error ? error.message : String(error),
          })
      }
    })()
    return () => {
      current = false
    }
    // Loaded once per opening: the run's diff never changes.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `load` is a new function each render
  }, [])
  if (loaded.state === 'loading')
    return (
      <div className="an-diff an-diff--note" role="status">
        Loading the diff…
      </div>
    )
  if (loaded.state === 'failed')
    return (
      <div className="an-diff an-diff--note" role="alert">
        The diff could not be loaded: {loaded.error}
      </div>
    )
  const { diff } = loaded
  if ('missing' in diff)
    return <div className="an-diff an-diff--note">No diff was kept for this file.</div>
  if ('skipped' in diff)
    return (
      <div className="an-diff an-diff--note">
        {diff.skipped === 'large'
          ? 'Too large to show.'
          : 'Not a text file: nothing to show.'}
      </div>
    )
  if (!diff.hunks.length)
    return (
      <div className="an-diff an-diff--note">No line changed (line endings aside).</div>
    )
  return (
    <div className="an-diff" data-testid="an-diff">
      {diff.hunks.map((hunk) => (
        <div
          key={`${hunk.oldStart},${hunk.newStart}`}
          className="an-diff-hunk"
          role="group"
        >
          <div className="an-diff-head">
            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
          </div>
          {numbered(hunk).map(({ line, old, now }, index) => (
            <div
              // Lines have no id: their place in the hunk is theirs.
              // oxlint-disable-next-line react/no-array-index-key -- the hunk never changes
              key={index}
              className={`an-diff-line an-diff-line--${line.kind}`}
            >
              <span className="an-diff-num">{old}</span>
              <span className="an-diff-num">{now}</span>
              <span
                className="an-diff-sign"
                aria-label={
                  line.kind === 'added'
                    ? 'Added'
                    : line.kind === 'removed'
                      ? 'Removed'
                      : undefined
                }
              >
                {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
              </span>
              <span className="an-diff-text">{line.text}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

type Hunk = Extract<FileDiff, { hunks: unknown }>['hunks'][number]

/** Each line of `hunk` with its number before the run (`old`) and after (`now`). */
function numbered(hunk: Hunk) {
  let old = hunk.oldStart
  let now = hunk.newStart
  return hunk.lines.map((line) => ({
    line,
    old: line.kind === 'added' ? undefined : old++,
    now: line.kind === 'removed' ? undefined : now++,
  }))
}

function countLines(hunks: Hunk[]): LineCounts {
  const counts = { added: 0, removed: 0 }
  for (const { lines } of hunks)
    for (const { kind } of lines) if (kind !== 'context') counts[kind]++
  return counts
}
