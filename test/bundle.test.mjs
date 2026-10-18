// The debug panel is in the dev build /playground uses, never in the released widget.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { run, tempDir } from './helpers.mjs'

const WIDGET = new URL('../skills/code-buddy/widget/', import.meta.url).pathname

/** The widget built into a folder of its own, `--dev` or not. */
async function bundle(t, dev) {
  const dist = await tempDir(t, 'code-buddy-widget-')
  const build = await run(
    'node',
    ['build.mjs', '--outdir', dist, ...(dev ? ['--dev'] : [])],
    { cwd: WIDGET },
  )
  assert.equal(build.code, 0, build.stderr)
  return readFile(path.join(dist, 'widget.js'), 'utf8')
}

test('the release build has no trace of the debug panel', async (t) => {
  const code = await bundle(t, false)
  assert.doesNotMatch(
    code,
    /cb-debug|Debug panel|Alt\+Shift\+D|dev build|history=1|debug\/tool|"widget"/,
  )
})

test('the dev build has the debug panel', async (t) => {
  const code = await bundle(t, true)
  assert.match(code, /cb-debug/)
  assert.match(code, /^\/\* code-buddy widget \(dev build/)
})
