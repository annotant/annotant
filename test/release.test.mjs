// lib/release.mjs asks GitHub for the newest release at most once a day, and
// keeps the answer for the widget to say when one is out.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import {
  RELEASES_URL,
  latestRelease,
  parseRelease,
} from '../skills/annotant/scripts/lib/release.mjs'
import { tempDir } from './helpers.mjs'

const URL_060 = 'https://github.com/annotant/annotant/releases/tag/v0.6.0'
const GITHUB_060 = { tag_name: 'v0.6.0', html_url: URL_060, body: 'notes' }
const RELEASE_060 = { version: '0.6.0', url: URL_060 }
const HOUR = 60 * 60 * 1000

/**
 * A fetch answering `answers` in turn (a body, a status, or an Error thrown),
 * and the URLs it was asked.
 * @param {(object | number | Error)[]} answers
 */
function fakeFetch(answers) {
  /** @type {string[]} */
  const asked = []
  /** @type {typeof globalThis.fetch} */
  const fetch = async (input) => {
    asked.push(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    const answer = answers.shift()
    if (answer instanceof Error) throw answer
    if (typeof answer === 'number') return new Response(null, { status: answer })
    return Response.json(answer)
  }
  return { fetch, asked }
}

/** @param {import('node:test').TestContext} t */
const cacheIn = async (t) =>
  path.join(await tempDir(t, 'annotant-release-'), 'release.json')

test('reads a release from what GitHub answers, and refuses anything else', () => {
  assert.deepEqual(parseRelease(GITHUB_060), RELEASE_060)
  assert.equal(parseRelease({ ...GITHUB_060, tag_name: 'nightly' }), undefined)
  assert.equal(parseRelease({ ...GITHUB_060, tag_name: 'v0.6.0-rc.1' }), undefined)
  // Its notes are the project's release page, whatever link the answer holds.
  assert.deepEqual(
    parseRelease({ ...GITHUB_060, html_url: 'https://evil.example/v0.6.0' }),
    RELEASE_060,
  )
  assert.equal(parseRelease(null), undefined)
})

test('asks GitHub once a day, the answer kept between', async (t) => {
  const cacheFile = await cacheIn(t)
  const { fetch, asked } = fakeFetch([GITHUB_060, { ...GITHUB_060, tag_name: 'v0.7.0' }])
  const now = Date.now()
  assert.deepEqual(await latestRelease({ now, cacheFile, fetch, env: {} }), RELEASE_060)
  assert.deepEqual(
    await latestRelease({ now: now + 23 * HOUR, cacheFile, fetch, env: {} }),
    RELEASE_060,
  )
  assert.deepEqual(asked, [RELEASES_URL])
  assert.equal(
    (await latestRelease({ now: now + 25 * HOUR, cacheFile, fetch, env: {} }))?.version,
    '0.7.0',
  )
  assert.equal(asked.length, 2)
})

test('after a failure, keeps the last release known and asks again an hour later', async (t) => {
  const cacheFile = await cacheIn(t)
  const { fetch, asked } = fakeFetch([GITHUB_060, new Error('offline'), 403, GITHUB_060])
  const now = Date.now()
  await latestRelease({ now, cacheFile, fetch, env: {} })
  const day = now + 25 * HOUR
  assert.deepEqual(
    await latestRelease({ now: day, cacheFile, fetch, env: {} }),
    RELEASE_060,
  )
  // Within the hour: not asked again.
  await latestRelease({ now: day + HOUR / 2, cacheFile, fetch, env: {} })
  assert.equal(asked.length, 2)
  // Rate limited (403), then answered.
  assert.deepEqual(
    await latestRelease({ now: day + 2 * HOUR, cacheFile, fetch, env: {} }),
    RELEASE_060,
  )
  assert.deepEqual(
    await latestRelease({ now: day + 4 * HOUR, cacheFile, fetch, env: {} }),
    RELEASE_060,
  )
  assert.equal(asked.length, 4)
})

test('nothing known when GitHub never answered', async (t) => {
  const { fetch } = fakeFetch([new Error('offline')])
  assert.equal(
    await latestRelease({ cacheFile: await cacheIn(t), fetch, env: {} }),
    undefined,
  )
})

test('ANNOTANT_UPDATE_CHECK=0 asks nothing', async (t) => {
  const cacheFile = await cacheIn(t)
  const { fetch, asked } = fakeFetch([GITHUB_060])
  const env = { ANNOTANT_UPDATE_CHECK: '0' }
  assert.equal(await latestRelease({ cacheFile, fetch, env }), undefined)
  assert.deepEqual(asked, [])
})

test('a cache it cannot read is asked again', async (t) => {
  const cacheFile = await cacheIn(t)
  await writeFile(cacheFile, '{"nextAt":"soon","version":[9,9,9]}')
  const { fetch, asked } = fakeFetch([GITHUB_060])
  assert.deepEqual(await latestRelease({ cacheFile, fetch, env: {} }), RELEASE_060)
  assert.equal(asked.length, 1)
  // Only the version's numbers are kept.
  assert.deepEqual(JSON.parse(await readFile(cacheFile, 'utf8')).version, [0, 6, 0])
})
