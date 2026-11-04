import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileDiff } from './api'
import { Code, languageOfFile } from './syntax'

/** How many lines a run added to a file and removed from it. */
export type LineCounts = { added: number; removed: number }

/** A file's diff, as far as it has loaded. */
export type Loaded =
  | { state: 'loading' }
  | { state: 'failed'; error: string }
  | { state: 'done'; diff: FileDiff }

/**
 * The run's diff of each of `files` (a folder has none), each loaded once,
 * from the first render where `active` holds: the list shows each file's
 * counts before the reader opens it, and opening it again loads nothing.
 * `retry` loads again a file whose diff failed; a new `version` loads them all
 * again.
 */
export function useDiffs(
  files: string[],
  load: ((file: string) => Promise<FileDiff>) | undefined,
  active: boolean,
  /** Changes when the files may have changed again: each one loads again. */
  version?: string,
): { diffs: Readonly<Record<string, Loaded>>; retry: (file: string) => void } {
  const [diffs, setDiffs] = useState<Readonly<Record<string, Loaded>>>({})
  // The files asked for, so that each loads once, unless `retry` asks again.
  const asked = useRef(new Set<string>())
  const loadedFor = useRef(version)
  // Each file's latest call: an earlier one that answers late is dropped.
  const calls = useRef(new Map<string, number>())
  const request = useCallback(
    (file: string, ask: (file: string) => Promise<FileDiff>) => {
      if (file.endsWith('/') || asked.current.has(file)) return
      asked.current.add(file)
      const call = (calls.current.get(file) ?? 0) + 1
      calls.current.set(file, call)
      const set = (loaded: Loaded) =>
        setDiffs((current) =>
          calls.current.get(file) === call ? { ...current, [file]: loaded } : current,
        )
      // Loaded again, a diff stays on screen until the new one is there.
      setDiffs((current) =>
        current[file]?.state === 'done'
          ? current
          : { ...current, [file]: { state: 'loading' } },
      )
      void (async () => {
        try {
          set({ state: 'done', diff: await ask(file) })
        } catch (error) {
          set({
            state: 'failed',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })()
    },
    [],
  )
  useEffect(() => {
    if (loadedFor.current !== version) {
      // A run at work wrote again: what was loaded may be out of date.
      loadedFor.current = version
      asked.current.clear()
    }
    // `load` is a new function each render: `asked` keeps each file to one call.
    if (!active || !load) return
    for (const file of files) request(file, load)
  }, [active, files, load, request, version])
  const retry = (file: string) => {
    if (!load || diffs[file]?.state !== 'failed') return
    asked.current.delete(file)
    request(file, load)
  }
  return { diffs, retry }
}

/** The lines `loaded` added and removed, once it has hunks that change any. */
export function countsOf(loaded: Loaded | undefined): LineCounts | undefined {
  if (loaded?.state !== 'done' || !('hunks' in loaded.diff)) return undefined
  const counts = { added: 0, removed: 0 }
  for (const { lines } of loaded.diff.hunks)
    for (const { kind } of lines) if (kind !== 'context') counts[kind]++
  return counts.added || counts.removed ? counts : undefined
}

const LOADING: Loaded = { state: 'loading' }

/**
 * What one run did to one file: its unified diff, added lines green and
 * removed ones red, each with its old and new line numbers, in a box that
 * scrolls when long; the code highlighted when `file` is TypeScript,
 * JavaScript or JSON.
 */
export function FileDiffView({
  file,
  loaded = LOADING,
}: {
  file: string
  loaded?: Loaded | undefined
}) {
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
  const language = languageOfFile(file)
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
              <span className="an-diff-text">
                <Code code={line.text} language={language} />
              </span>
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
