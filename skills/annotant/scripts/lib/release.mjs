// The newest release of Annotant, for the widget to say when one is out. The
// server's only request to the internet: GitHub's API, asked at most once a
// day across sessions and projects (an hour after a failure), the answer kept
// in STATE_ROOT. ANNOTANT_UPDATE_CHECK=0 turns it off.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { STATE_ROOT } from './project.mjs'

export const RELEASES_URL =
  'https://api.github.com/repos/annotant/annotant/releases/latest'
// A release's notes: built from its version, never a link from the answer.
const RELEASE_PAGE = 'https://github.com/annotant/annotant/releases/tag/v'
const VERSION = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const TIMEOUT_MS = 5_000

/** @typedef {{ version: string, url: string }} Release */
/** `x.y.z` as three integers: all the cache keeps of what GitHub said. */
/** @typedef {[number, number, number]} Parts */
/** @typedef {{ nextAt: number, version?: Parts | undefined }} Cache */

/**
 * @param {Parts} parts
 * @returns {Release}
 */
const releaseOf = (parts) => {
  const version = parts.join('.')
  return { version, url: `${RELEASE_PAGE}${version}` }
}

/**
 * The version of the release GitHub's API answers, or undefined when it is
 * not a plain `vX.Y.Z` (a pre-release, a nightly tag).
 * @param {unknown} body
 * @returns {Parts | undefined}
 */
function partsOf(body) {
  if (!body || typeof body !== 'object' || !('tag_name' in body)) return undefined
  const tag = body.tag_name
  const match = typeof tag === 'string' ? VERSION.exec(tag) : undefined
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * A release as GitHub's API answers it, or undefined when it is not one.
 * @param {unknown} body
 * @returns {Release | undefined}
 */
export function parseRelease(body) {
  const parts = partsOf(body)
  return parts && releaseOf(parts)
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
    const kept = 'version' in cache ? cache.version : undefined
    const version =
      Array.isArray(kept) && kept.length === 3 && kept.every(Number.isSafeInteger)
        ? /** @type {Parts} */ ([kept[0], kept[1], kept[2]])
        : undefined
    return { nextAt, version }
  } catch {
    return undefined
  }
}

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
  if (cached && now < cached.nextAt) return cached.version && releaseOf(cached.version)
  /** @type {Cache} */
  let next
  try {
    const response = await fetch(RELEASES_URL, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'annotant' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const version = response.ok ? partsOf(await response.json()) : undefined
    // Rate limited, offline or an answer it cannot read: the last one known, asked again soon.
    next = version
      ? { nextAt: now + DAY_MS, version }
      : { nextAt: now + HOUR_MS, version: cached?.version }
  } catch {
    next = { nextAt: now + HOUR_MS, version: cached?.version }
  }
  try {
    await mkdir(path.dirname(cacheFile), { recursive: true })
    await writeFile(cacheFile, `${JSON.stringify(next)}\n`)
  } catch {
    // Not kept: asked again on the next start, nothing else lost.
  }
  return next.version && releaseOf(next.version)
}
