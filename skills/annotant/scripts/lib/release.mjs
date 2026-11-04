// The newest release of Annotant, for the widget to say when one is out. The
// server's only request to the internet: GitHub's API, asked at most once a
// day across sessions and projects (an hour after a failure), the answer kept
// in STATE_ROOT. ANNOTANT_UPDATE_CHECK=0 turns it off.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { STATE_ROOT } from './project.mjs'

export const RELEASES_URL =
  'https://api.github.com/repos/annotant/annotant/releases/latest'
// Where a release's notes are: a link elsewhere is not taken.
const RELEASE_PAGE = 'https://github.com/annotant/annotant/releases/'
const VERSION = /^v?(\d+\.\d+\.\d+)$/
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const TIMEOUT_MS = 5_000

/** @typedef {{ version: string, url: string }} Release */
/** @typedef {{ nextAt: number, release?: Release | undefined }} Cache */

/**
 * A release as GitHub's API answers it, or undefined when it is not one.
 * @param {unknown} body
 * @returns {Release | undefined}
 */
export function parseRelease(body) {
  if (!body || typeof body !== 'object') return undefined
  const tag = 'tag_name' in body ? body.tag_name : undefined
  const url = 'html_url' in body ? body.html_url : undefined
  const version = typeof tag === 'string' ? VERSION.exec(tag)?.[1] : undefined
  if (!version || typeof url !== 'string' || !url.startsWith(RELEASE_PAGE))
    return undefined
  return { version, url }
}

/**
 * @param {string} file
 * @returns {Promise<Cache | undefined>}
 */
async function readCache(file) {
  try {
    /** @type {unknown} */
    const cache = JSON.parse(await readFile(file, 'utf8'))
    if (!cache || typeof cache !== 'object' || !('nextAt' in cache)) return undefined
    const { nextAt } = cache
    if (typeof nextAt !== 'number') return undefined
    const release = 'release' in cache ? parseCached(cache.release) : undefined
    return { nextAt, release }
  } catch {
    return undefined
  }
}

/** @param {unknown} release */
const parseCached = (release) =>
  release && typeof release === 'object' && 'version' in release && 'url' in release
    ? parseRelease({ tag_name: release.version, html_url: release.url })
    : undefined

/**
 * The newest release, from the cache while it is fresh, else from GitHub.
 * Undefined when turned off, or when GitHub never answered: nothing to say.
 * @param {{
 *   now?: number
 *   cacheFile?: string
 *   fetch?: typeof globalThis.fetch
 *   env?: Record<string, string | undefined>
 * }} [options]
 * @returns {Promise<Release | undefined>}
 */
export async function latestRelease({
  now = Date.now(),
  cacheFile = path.join(STATE_ROOT, 'release.json'),
  fetch = globalThis.fetch,
  env = process.env,
} = {}) {
  if (env.ANNOTANT_UPDATE_CHECK === '0') return undefined
  const cached = await readCache(cacheFile)
  if (cached && now < cached.nextAt) return cached.release
  /** @type {Cache} */
  let next
  try {
    const response = await fetch(RELEASES_URL, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'annotant' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const release = response.ok ? parseRelease(await response.json()) : undefined
    // Rate limited, offline or an answer it cannot read: the last one known, asked again soon.
    next = release
      ? { nextAt: now + DAY_MS, release }
      : { nextAt: now + HOUR_MS, release: cached?.release }
  } catch {
    next = { nextAt: now + HOUR_MS, release: cached?.release }
  }
  try {
    await mkdir(path.dirname(cacheFile), { recursive: true })
    await writeFile(cacheFile, `${JSON.stringify(next)}\n`)
  } catch {
    // Not kept: asked again on the next start, nothing else lost.
  }
  return next.release
}
