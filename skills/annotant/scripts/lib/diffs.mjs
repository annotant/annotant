// What each run did to each file it changed: the file before the run's first
// write of it and after its last, beside the comments file as
// `diffs/<comment id>/<run>/<key>.json`: what the reader or other agents
// changed before or after the run is not in it, what they changed between
// its writes is. The hooks write them, the server serves the
// line diff of one, the store finds the first line a run changed.
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './errors.mjs'

/** The most bytes a side of a diff keeps: past it, "too large to show". */
export const MAX_SNAPSHOT_BYTES = 256 * 1024
/** The lines kept around each change. */
const CONTEXT = 3
/** The most cells the LCS table may take: past it, the middle is replaced whole. */
const MAX_CELLS = 4_000_000
/** A run's id as the store makes it. */
export const RUN_ID = /^r\d+$/

/**
 * A file's two sides, `null` when it did not exist (before: the run created
 * it; after: it deleted it); a side not known yet is absent. `skipped`: a side
 * was too large or not text, and neither is kept.
 * @typedef {{ file: string, before?: string | null, after?: string | null, skipped?: 'large' | 'binary' }} Snapshot
 */

/**
 * One line of a diff: kept, added or removed.
 * @typedef {{ kind: 'context' | 'added' | 'removed', text: string }} DiffLine
 * @typedef {{ oldStart: number, oldLines: number, newStart: number, newLines: number, lines: DiffLine[] }} Hunk
 */

/**
 * The folder of comment `id`'s diffs, beside the comments file.
 * @param {{ commentsFile: string }} project
 * @param {string} id
 */
export const diffsDir = (project, id) =>
  path.join(path.dirname(project.commentsFile), 'diffs', id)

/**
 * Where run `run` keeps `file`, as a message's `changed` names it.
 * @param {{ commentsFile: string }} project
 * @param {string} id
 * @param {string} run
 * @param {string} file
 */
export function snapshotPath(project, id, run, file) {
  const key = createHash('sha1').update(file).digest('hex').slice(0, 16)
  return path.join(diffsDir(project, id), run, `${key}.json`)
}

/**
 * `abs` as it is now: its text, `null` when missing, or why it is not kept
 * (too large, or not a regular text file).
 * @param {string} abs
 * @returns {Promise<{ text: string | null } | { skipped: 'large' | 'binary' }>}
 */
async function sideOf(abs) {
  /** @type {import('node:fs').Stats} */
  let found
  try {
    found = await stat(abs)
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR')
      return { text: null }
    throw error
  }
  // Sized before it is read; a pipe or a device is never read, it may not end.
  if (!found.isFile()) return { skipped: 'binary' }
  if (found.size > MAX_SNAPSHOT_BYTES) return { skipped: 'large' }
  const data = await readFile(abs)
  if (data.length > MAX_SNAPSHOT_BYTES) return { skipped: 'large' }
  if (data.includes(0)) return { skipped: 'binary' }
  // Not UTF-8 (Latin-1…): decoded loosely, two different bytes would read alike.
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(data) }
  } catch {
    return { skipped: 'binary' }
  }
}

/** A side as a snapshot holds it: text, `null`, or not known yet. */
const isSide = (/** @type {unknown} */ side) =>
  side === undefined || side === null || typeof side === 'string'

/**
 * @param {string} file
 * @returns {Promise<Snapshot | undefined>}
 */
async function readSnapshot(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.file === 'string' &&
      isSide(parsed.before) &&
      isSide(parsed.after)
    )
      return parsed
    throw new Error(`not a snapshot: ${file}`)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Written whole or not at all: a reader never sees half a snapshot.
 * @param {string} file
 * @param {Snapshot} snapshot
 */
async function writeSnapshot(file, snapshot) {
  await mkdir(path.dirname(file), { recursive: true })
  // Copies of the project's files, `.env` included: never committed, even
  // where the comments file is (a project that keeps `.annotant/` in git).
  const ignore = path.join(file, '..', '..', '..', '.gitignore')
  await writeFile(ignore, '*\n', { flag: 'wx' }).catch((error) => {
    if (errorCode(error) !== 'EEXIST') throw error
  })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(snapshot))
  await rename(temporary, file)
}

/**
 * Before the run's first write of `file` (at `abs`): keeps it as it is. A
 * later write of the same run keeps the first.
 * @param {{ commentsFile: string }} project
 * @param {string} id
 * @param {string} run
 * @param {string} file as a message's `changed` names it
 * @param {string} abs
 */
export async function keepBefore(project, id, run, file, abs) {
  const at = snapshotPath(project, id, run, file)
  if (await readSnapshot(at)) return
  const side = await sideOf(abs)
  await writeSnapshot(
    at,
    'skipped' in side ? { file, skipped: side.skipped } : { file, before: side.text },
  )
}

/**
 * After a write of `file` by the run: keeps it as it is now, over what an
 * earlier write of the run kept. Nothing without the side before it (its
 * write failed, or ran before the claim), or once a side was too large.
 * @returns {Promise<boolean>} whether it kept the side after
 * @param {{ commentsFile: string }} project
 * @param {string} id
 * @param {string} run
 * @param {string} file
 * @param {string} abs
 */
export async function keepAfter(project, id, run, file, abs) {
  const at = snapshotPath(project, id, run, file)
  const snapshot = await readSnapshot(at)
  if (!snapshot) return false
  if (snapshot.skipped || snapshot.before === undefined) return true
  const side = await sideOf(abs)
  await writeSnapshot(
    at,
    'skipped' in side
      ? { file, skipped: side.skipped }
      : { ...snapshot, after: side.text },
  )
  return true
}

/**
 * A text's lines, without the empty one after its last line break.
 * @param {string | null} text
 */
function linesOf(text) {
  if (!text) return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/**
 * The lines of `a` and `b`, each kept, removed or added: the longest
 * common subsequence of their middle, once their common start and end are set
 * aside. A middle too large for the table is removed then added whole.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {DiffLine['kind'][]} in order, one per line of `a` (kept or removed) and per added line of `b`
 */
function editsOf(a, b) {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  /** @type {DiffLine['kind'][]} */
  const middle = []
  const n = endA - start
  const m = endB - start
  if (n * m > MAX_CELLS) {
    for (let i = 0; i < n; i++) middle.push('removed')
    for (let j = 0; j < m; j++) middle.push('added')
  } else {
    // lengths[i][j]: the length of the LCS of a[start + i…endA) and b[start + j…endB).
    const width = m + 1
    const lengths = new Uint32Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lengths[i * width + j] =
          a[start + i] === b[start + j]
            ? lengths[(i + 1) * width + j + 1] + 1
            : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        middle.push('context')
        i++
        j++
      } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
        middle.push('removed')
        i++
      } else {
        middle.push('added')
        j++
      }
    }
    for (; i < n; i++) middle.push('removed')
    for (; j < m; j++) middle.push('added')
  }
  return [
    ...Array(start).fill('context'),
    ...middle,
    ...Array(a.length - endA).fill('context'),
  ]
}

/**
 * The unified diff from `before` to `after`, in hunks like `diff -u`'s with
 * CONTEXT lines around each change; none when they hold the same lines (a
 * change of the line break at the end alone is not seen).
 * @param {string | null} before
 * @param {string | null} after
 * @returns {Hunk[]}
 */
export function lineDiff(before, after) {
  const a = linesOf(before)
  const b = linesOf(after)
  /** @type {(DiffLine & { old: number, new: number })[]} */
  const lines = []
  let old = 0
  let next = 0
  for (const kind of editsOf(a, b)) {
    // Numbered from 1: the line it is, or the one it comes before.
    const at = { old: old + 1, new: next + 1 }
    if (kind === 'added') lines.push({ kind, text: b[next++] ?? '', ...at })
    else if (kind === 'removed') lines.push({ kind, text: a[old++] ?? '', ...at })
    else {
      lines.push({ kind, text: a[old] ?? '', ...at })
      old++
      next++
    }
  }
  /** @type {Hunk[]} */
  const hunks = []
  let index = 0
  while (index < lines.length) {
    const change = lines.findIndex((line, at) => at >= index && line.kind !== 'context')
    if (change === -1) break
    const from = Math.max(index, change - CONTEXT)
    let to = change
    // Up to the last change whose context touches the next one's.
    for (let at = change; at < lines.length; at++) {
      if (lines[at].kind !== 'context') to = at
      else if (at - to > 2 * CONTEXT) break
    }
    const end = Math.min(lines.length, to + CONTEXT + 1)
    const slice = lines.slice(from, end)
    const first = slice[0]
    const oldLines = slice.filter((line) => line.kind !== 'added').length
    const newLines = slice.filter((line) => line.kind !== 'removed').length
    hunks.push({
      // As `diff -u` writes them: a side with no line starts before its first.
      oldStart: oldLines ? first.old : first.old - 1,
      oldLines,
      newStart: newLines ? first.new : first.new - 1,
      newLines,
      lines: slice.map(({ kind, text }) => ({ kind, text })),
    })
    index = end
  }
  return hunks
}

/**
 * The first line of `after` the run changed, from 1: where the editor opens the
 * file. Undefined when the file is gone, or no line changed.
 * @param {string | null} before
 * @param {string | null} after
 */
export function firstChanged(before, after) {
  if (after === null) return undefined
  const a = linesOf(before)
  const b = linesOf(after)
  let line = 0
  while (line < a.length && line < b.length && a[line] === b[line]) line++
  if (line === a.length && line === b.length) return undefined
  // Only lines removed at the end: the line before them.
  return Math.max(1, Math.min(line + 1, b.length))
}

/**
 * Run `run`'s diff of `file`: its hunks, or why
 * it is not shown: `missing` when the run kept none (before this was
 * recorded, or cut short before the write ended).
 * @param {{ commentsFile: string }} project
 * @param {string} id
 * @param {string} run
 * @param {string} file
 * @returns {Promise<{ hunks: Hunk[] } | { skipped: 'large' | 'binary' } | { missing: true }>}
 */
export async function readDiff(project, id, run, file) {
  const snapshot = await readSnapshot(snapshotPath(project, id, run, file))
  if (!snapshot || snapshot.file !== file) return { missing: true }
  if (snapshot.skipped) return { skipped: snapshot.skipped }
  const { before, after } = snapshot
  if (before === undefined || after === undefined) return { missing: true }
  return { hunks: lineDiff(before, after) }
}

/**
 * The first line run `run` changed in each of `files` it kept, for the
 * message that lists them; the files gone, too large or not kept left out.
 * @param {{ commentsFile: string }} project
 * @param {string} id
 * @param {string} run
 * @param {string[]} files
 * @returns {Promise<Record<string, number>>}
 */
export async function firstLines(project, id, run, files) {
  /** @type {Record<string, number>} */
  const lines = {}
  for (const file of files) {
    const snapshot = await readSnapshot(snapshotPath(project, id, run, file)).catch(
      (error) => {
        // The answer goes on without it: the link opens at line 1.
        console.error(`annotant: could not read the diff of ${file}: ${String(error)}`)
        return undefined
      },
    )
    if (!snapshot || snapshot.file !== file || snapshot.skipped) continue
    if (snapshot.before === undefined || snapshot.after === undefined) continue
    const line = firstChanged(snapshot.before, snapshot.after)
    if (line !== undefined) lines[file] = line
  }
  return lines
}

/**
 * Removes comment `id`'s diffs. At best, as its images.
 * @param {{ commentsFile: string }} project
 * @param {string} id
 */
export async function removeDiffs(project, id) {
  const dir = diffsDir(project, id)
  await rm(dir, { recursive: true, force: true }).catch((error) => {
    console.error(`annotant: could not remove ${dir}: ${String(error)}`)
  })
}
