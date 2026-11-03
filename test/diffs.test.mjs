// scripts/lib/diffs.mjs: the sides a run kept of a file, and their line diff.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import {
  MAX_SNAPSHOT_BYTES,
  firstChanged,
  firstLines,
  keepAfter,
  keepBefore,
  lineDiff,
  readDiff,
  removeDiffs,
  snapshotPath,
} from '../skills/annotant/scripts/lib/diffs.mjs'
import { tempDir } from './helpers.mjs'

const lines = (/** @type {number} */ count, prefix = 'line') =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`)
const text = (/** @type {string[]} */ all) => `${all.join('\n')}\n`

test('a change in the middle: one hunk, three lines of context around it', () => {
  const before = lines(10)
  const after = [...before]
  after[4] = 'changed'
  assert.deepEqual(lineDiff(text(before), text(after)), [
    {
      oldStart: 2,
      oldLines: 7,
      newStart: 2,
      newLines: 7,
      lines: [
        { kind: 'context', text: 'line 2' },
        { kind: 'context', text: 'line 3' },
        { kind: 'context', text: 'line 4' },
        { kind: 'removed', text: 'line 5' },
        { kind: 'added', text: 'changed' },
        { kind: 'context', text: 'line 6' },
        { kind: 'context', text: 'line 7' },
        { kind: 'context', text: 'line 8' },
      ],
    },
  ])
  assert.equal(firstChanged(text(before), text(after)), 5)
})

test('changes far apart make two hunks; close ones, one', () => {
  const before = lines(30)
  const far = [...before]
  far[2] = 'a'
  far[25] = 'b'
  assert.equal(lineDiff(text(before), text(far)).length, 2)
  const close = [...before]
  close[2] = 'a'
  // Six lines of context between them: still one hunk, as `diff -u` makes it.
  close[9] = 'b'
  assert.equal(lineDiff(text(before), text(close)).length, 1)
})

test('a created file is all added, a deleted one all removed', () => {
  assert.deepEqual(lineDiff(null, 'a\nb\n'), [
    {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 2,
      lines: [
        { kind: 'added', text: 'a' },
        { kind: 'added', text: 'b' },
      ],
    },
  ])
  assert.equal(firstChanged(null, 'a\nb\n'), 1)
  const [gone] = lineDiff('a\n', null)
  assert.deepEqual(gone, {
    oldStart: 1,
    oldLines: 1,
    newStart: 0,
    newLines: 0,
    lines: [{ kind: 'removed', text: 'a' }],
  })
  // A deleted file has no line to open at.
  assert.equal(firstChanged('a\n', null), undefined)
})

test('lines inserted keep the lines around them, and the same text has no hunk', () => {
  const diff = lineDiff('a\nb\nc\n', 'a\nx\nb\nc\ny\n')
  assert.deepEqual(
    diff[0]?.lines.map(({ kind, text: line }) => `${kind[0]}${line}`),
    ['ca', 'ax', 'cb', 'cc', 'ay'],
  )
  assert.deepEqual(lineDiff('a\n', 'a\n'), [])
  // Written again the same: no line to open at.
  assert.equal(firstChanged('a\n', 'a\n'), undefined)
  // Lines removed at the end: the editor opens on the last line left.
  assert.equal(firstChanged('a\nb\nc\n', 'a\n'), 1)
})

test('a middle too large for the table is replaced whole', () => {
  const before = lines(3000, 'old')
  const after = lines(3000, 'new')
  const [hunk] = lineDiff(text(before), text(after))
  assert.equal(hunk?.oldLines, 3000)
  assert.equal(hunk?.newLines, 3000)
  assert.equal(hunk?.lines.filter((line) => line.kind === 'removed').length, 3000)
})

test("keeps the file before the run's first write and after its last", async (t) => {
  const dir = await tempDir(t)
  const project = { commentsFile: path.join(dir, '.annotant', 'comments.json') }
  const file = path.join(dir, 'src.ts')
  await writeFile(file, 'one\n')
  await keepBefore(project, 'c1', 'r1', 'src.ts', file)
  await writeFile(file, 'two\n')
  await keepAfter(project, 'c1', 'r1', 'src.ts', file)
  // A second write of the run: the first side stays, the last moves.
  await keepBefore(project, 'c1', 'r1', 'src.ts', file)
  await writeFile(file, 'three\n')
  await keepAfter(project, 'c1', 'r1', 'src.ts', file)
  // The reader edits it after the run: the run's diff does not move.
  await writeFile(file, 'reader\n')
  const diff = await readDiff(project, 'c1', 'r1', 'src.ts')
  assert.deepEqual(diff && 'hunks' in diff ? diff.hunks[0]?.lines : undefined, [
    { kind: 'removed', text: 'one' },
    { kind: 'added', text: 'three' },
  ])
  assert.deepEqual(await firstLines(project, 'c1', 'r1', ['src.ts', 'other.ts']), {
    'src.ts': 1,
  })
  // Another run, another diff; a run that kept nothing has none.
  assert.deepEqual(await readDiff(project, 'c1', 'r2', 'src.ts'), { missing: true })
  assert.ok(existsSync(snapshotPath(project, 'c1', 'r1', 'src.ts')))
  // Never committed, wherever the comments file is.
  assert.equal(
    await readFile(path.join(dir, '.annotant', 'diffs', '.gitignore'), 'utf8'),
    '*\n',
  )
  await removeDiffs(project, 'c1')
  assert.equal(existsSync(snapshotPath(project, 'c1', 'r1', 'src.ts')), false)
})

test('a file too large or not text is not kept, only said so', async (t) => {
  const dir = await tempDir(t)
  const project = { commentsFile: path.join(dir, 'comments.json') }
  const big = path.join(dir, 'big.txt')
  await writeFile(big, 'x'.repeat(MAX_SNAPSHOT_BYTES + 1))
  await keepBefore(project, 'c1', 'r1', 'big.txt', big)
  await keepAfter(project, 'c1', 'r1', 'big.txt', big)
  assert.deepEqual(await readDiff(project, 'c1', 'r1', 'big.txt'), { skipped: 'large' })
  // Small before, large after: neither side kept.
  const grows = path.join(dir, 'grows.txt')
  await writeFile(grows, 'a\n')
  await keepBefore(project, 'c1', 'r1', 'grows.txt', grows)
  await writeFile(grows, 'x'.repeat(MAX_SNAPSHOT_BYTES + 1))
  await keepAfter(project, 'c1', 'r1', 'grows.txt', grows)
  assert.deepEqual(await readDiff(project, 'c1', 'r1', 'grows.txt'), {
    skipped: 'large',
  })
  const binary = path.join(dir, 'logo.png')
  await writeFile(binary, Buffer.from([0x89, 0, 1, 2]))
  await keepBefore(project, 'c1', 'r1', 'logo.png', binary)
  assert.deepEqual(await readDiff(project, 'c1', 'r1', 'logo.png'), {
    skipped: 'binary',
  })
  assert.deepEqual(await firstLines(project, 'c1', 'r1', ['big.txt', 'logo.png']), {})
})

test('a file created then deleted by the run, each side null', async (t) => {
  const dir = await tempDir(t)
  const project = { commentsFile: path.join(dir, 'comments.json') }
  const file = path.join(dir, 'tmp.ts')
  await keepBefore(project, 'c1', 'r1', 'tmp.ts', file)
  await writeFile(file, 'a\n')
  await keepAfter(project, 'c1', 'r1', 'tmp.ts', file)
  assert.deepEqual(await readDiff(project, 'c1', 'r1', 'tmp.ts'), {
    hunks: lineDiff(null, 'a\n'),
  })
  await rm(file)
  await keepAfter(project, 'c1', 'r1', 'tmp.ts', file)
  assert.deepEqual(await readDiff(project, 'c1', 'r1', 'tmp.ts'), { hunks: [] })
})

test("a later hunk's header counts the lines added above it", () => {
  const before = lines(30)
  const after = ['new 1', 'new 2', ...before]
  after[2 + 24] = 'changed'
  const [first, second] = lineDiff(text(before), text(after))
  assert.deepEqual(
    [first, second].map((hunk) => [
      hunk?.oldStart,
      hunk?.oldLines,
      hunk?.newStart,
      hunk?.newLines,
    ]),
    [
      [1, 3, 1, 5],
      [22, 7, 24, 7],
    ],
  )
  // Seven lines of context between two changes: two hunks.
  const apart = [...before]
  apart[2] = 'a'
  apart[10] = 'b'
  assert.equal(lineDiff(text(before), text(apart)).length, 2)
})

test('a file not in UTF-8 is not shown, and a corrupt snapshot is an error', async (t) => {
  const dir = await tempDir(t)
  const project = { commentsFile: path.join(dir, 'comments.json') }
  const latin = path.join(dir, 'latin.txt')
  // "é" in Latin-1: read as UTF-8, any other byte would read the same.
  await writeFile(latin, Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))
  await keepBefore(project, 'c1', 'r1', 'latin.txt', latin)
  assert.deepEqual(await readDiff(project, 'c1', 'r1', 'latin.txt'), {
    skipped: 'binary',
  })
  await writeFile(
    snapshotPath(project, 'c1', 'r1', 'bad.ts'),
    JSON.stringify({ file: 'bad.ts', before: 42, after: 'a' }),
  )
  await assert.rejects(readDiff(project, 'c1', 'r1', 'bad.ts'), /not a snapshot/)
})
