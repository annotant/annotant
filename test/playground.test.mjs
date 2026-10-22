// The playground is installed as init would install it: detect.mjs finds it,
// and its production build passes verify-prod.mjs.
import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { SCRIPTS, run, tempDir } from './helpers.mjs'

const PLAYGROUND = new URL('../playground/', import.meta.url).pathname

test('detect.mjs sees a React frontend with Annotant installed', async () => {
  const { code, stdout } = await run('node', [
    path.join(SCRIPTS, 'detect.mjs'),
    '--project',
    PLAYGROUND,
  ])
  assert.equal(code, 0)
  const report = JSON.parse(stdout)
  assert.equal(report.webFrontend, true)
  assert.equal(report.react, true)
  assert.equal(report.devUrl, 'http://localhost:5190')
  assert.equal(report.installed?.version, report.installed?.current)
})

test('the production build carries no widget loader', async (t) => {
  const dist = await tempDir(t, 'annotant-playground-')
  const build = await run('node', [path.join(PLAYGROUND, 'build.mjs'), '--outdir', dist])
  assert.equal(build.code, 0, build.stderr)
  const verify = await run('node', [
    path.join(SCRIPTS, 'verify-prod.mjs'),
    '--project',
    PLAYGROUND,
    '--dir',
    dist,
  ])
  assert.equal(verify.code, 0, verify.stderr)
  assert.match(verify.stdout, /^OK: no widget loader/)
})
