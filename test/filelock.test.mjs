import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { withFileLock } from '../skills/annotant/scripts/lib/filelock.mjs'
import { SCRIPTS, tempDir } from './helpers.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A pid no process has: the highest ones are never handed out on the CI's systems. */
const DEAD_PID = 2 ** 22 - 1

test('runs overlapping tasks one at a time', async (t) => {
  const file = path.join(await tempDir(t), 'data.json')
  let inside = 0
  let most = 0
  await Promise.all(
    Array.from({ length: 8 }, () =>
      withFileLock(file, async () => {
        inside++
        most = Math.max(most, inside)
        await sleep(5)
        inside--
      }),
    ),
  )
  assert.equal(most, 1)
})

test('takes over a lock whose holder died', async (t) => {
  const file = path.join(await tempDir(t), 'data.json')
  await mkdir(`${file}.lock`)
  await writeFile(
    path.join(`${file}.lock`, 'owner'),
    JSON.stringify({ pid: DEAD_PID, token: 'dead' }),
  )
  const started = Date.now()
  assert.equal(await withFileLock(file, async () => 'ran', { timeoutMs: 2_000 }), 'ran')
  assert.ok(Date.now() - started < 1_000)
})

test('waits for a live holder rather than breaking its lock', async (t) => {
  const file = path.join(await tempDir(t), 'data.json')
  await mkdir(`${file}.lock`)
  await writeFile(
    path.join(`${file}.lock`, 'owner'),
    JSON.stringify({ pid: process.pid, token: 'alive' }),
  )
  await assert.rejects(
    withFileLock(file, async () => 'ran', { timeoutMs: 200 }),
    /still held/,
  )
})

test('lets one process only in when several find the same stale lock', async (t) => {
  const dir = await tempDir(t)
  const file = path.join(dir, 'data.json')
  const log = path.join(dir, 'log')
  await writeFile(log, '')
  await mkdir(`${file}.lock`)
  await writeFile(
    path.join(`${file}.lock`, 'owner'),
    JSON.stringify({ pid: DEAD_PID, token: 'dead' }),
  )
  // Each process appends "in" then "out": interleaved pairs mean two held the lock.
  const worker = `
    import { appendFile } from 'node:fs/promises'
    import { withFileLock } from ${JSON.stringify(path.join(SCRIPTS, 'lib/filelock.mjs'))}
    await withFileLock(${JSON.stringify(file)}, async () => {
      await appendFile(${JSON.stringify(log)}, 'in\\n')
      await new Promise((r) => setTimeout(r, 20))
      await appendFile(${JSON.stringify(log)}, 'out\\n')
    })
  `
  await Promise.all(
    Array.from(
      { length: 6 },
      () =>
        new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ['--input-type=module', '-e', worker])
          child.on('error', reject)
          child.on('close', (code) =>
            code === 0 ? resolve(undefined) : reject(new Error(`exit ${code}`)),
          )
        }),
    ),
  )
  const lines = (await readFile(log, 'utf8')).trim().split('\n')
  assert.equal(lines.length, 12)
  for (let i = 0; i < lines.length; i += 2) {
    assert.deepEqual(lines.slice(i, i + 2), ['in', 'out'])
  }
})
