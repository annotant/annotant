// A lock across processes: the server, the hooks and the agents' scripts all
// run apart. mkdir is atomic, so the process that creates `<file>.lock` holds
// it. The holder writes its pid and a token inside, so a waiter can tell a lock
// left by a dead process from a live one.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './errors.mjs'

const POLL_MS = 15

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return errorCode(error) === 'EPERM'
  }
}

/**
 * The token of a lock whose holder is gone, or undefined when it is held.
 * A lock without an owner file is stale once older than `staleMs`: its holder
 * died between creating it and writing the file.
 * @param {string} lock
 * @param {number} staleMs
 * @returns {Promise<string | undefined>}
 */
async function staleToken(lock, staleMs) {
  try {
    const owner = JSON.parse(await readFile(path.join(lock, 'owner'), 'utf8'))
    if (!alive(owner.pid)) return String(owner.token)
  } catch {
    try {
      const { mtimeMs } = await stat(lock)
      if (Date.now() - mtimeMs > staleMs) return ''
    } catch {}
  }
  return undefined
}

/** @param {string} lock */
async function tokenOf(lock) {
  try {
    return String(JSON.parse(await readFile(path.join(lock, 'owner'), 'utf8')).token)
  } catch {
    return ''
  }
}

/**
 * Removes a stale lock, once. Two waiters can see the same stale lock: each
 * must take `<lock>.break` first and re-check the token inside it, so the
 * second one never removes the fresh lock the first one's winner created.
 * @param {string} lock
 * @param {string} token
 * @param {number} staleMs
 */
async function breakStale(lock, token, staleMs) {
  const breaker = `${lock}.break`
  try {
    await mkdir(breaker)
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error
    // A breaker that died mid-way; removing it can only let another waiter
    // re-check the token, never remove a live lock.
    try {
      if (Date.now() - (await stat(breaker)).mtimeMs > staleMs) {
        await rmdir(breaker).catch(() => undefined)
      }
    } catch {}
    return
  }
  try {
    if ((await tokenOf(lock)) === token) await rm(lock, { recursive: true, force: true })
  } finally {
    await rmdir(breaker).catch(() => undefined)
  }
}

/**
 * Runs `task` holding `<file>.lock`.
 * @template T
 * @param {string} file
 * @param {() => Promise<T>} task
 * @param {{ staleMs?: number, timeoutMs?: number }} [options]
 * @returns {Promise<T>}
 */
export async function withFileLock(
  file,
  task,
  { staleMs = 10_000, timeoutMs = 30_000 } = {},
) {
  const lock = `${file}.lock`
  await mkdir(path.dirname(file), { recursive: true })
  const deadline = Date.now() + timeoutMs
  const token = randomUUID()
  for (;;) {
    try {
      await mkdir(lock)
      await writeFile(
        path.join(lock, 'owner'),
        JSON.stringify({ pid: process.pid, token }),
      )
      break
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
    }
    const stale = await staleToken(lock, staleMs)
    if (stale !== undefined) {
      await breakStale(lock, stale, staleMs)
      continue
    }
    if (Date.now() > deadline) throw new Error(`${lock} is still held; try again`)
    await sleep(POLL_MS)
  }
  try {
    return await task()
  } finally {
    // Ours only: a lock broken while we held it (we were hung) is someone else's now.
    if ((await tokenOf(lock)) === token) await rm(lock, { recursive: true, force: true })
  }
}
