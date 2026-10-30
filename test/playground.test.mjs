// The playground and the demo are installed as init would install them:
// detect.mjs finds them, and their production builds pass verify-prod.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { SCRIPTS, run, tempDir } from './helpers.mjs'

const APPS = [
  { name: 'playground', devUrl: 'http://localhost:5190', port: 4590 },
  { name: 'demo', devUrl: 'http://localhost:5191', port: 4591 },
]

for (const { name, devUrl, port } of APPS) {
  const project = new URL(`../${name}/`, import.meta.url).pathname

  test(`detect.mjs sees the ${name}, a React frontend with Annotant installed`, async () => {
    const { code, stdout } = await run('node', [
      path.join(SCRIPTS, 'detect.mjs'),
      '--project',
      project,
    ])
    assert.equal(code, 0)
    const report = JSON.parse(stdout)
    assert.equal(report.webFrontend, true)
    assert.equal(report.react, true)
    assert.equal(report.devUrl, devUrl)
    // Ports of their own: /playground and /playground demo run side by side.
    const config = JSON.parse(readFileSync(path.join(project, '.annotant.json'), 'utf8'))
    assert.equal(config.port, port)
    // The playground switches light, dark and system; the demo is light only.
    assert.deepEqual(report.theme?.setting, config.theme)
    assert.equal(report.installed?.version, report.installed?.current)
  })

  test(`the ${name}'s production build carries no widget loader`, async (t) => {
    const dist = await tempDir(t, `annotant-${name}-`)
    const build = await run('node', [path.join(project, 'build.mjs'), '--outdir', dist])
    assert.equal(build.code, 0, build.stderr)
    const verify = await run('node', [
      path.join(SCRIPTS, 'verify-prod.mjs'),
      '--project',
      project,
      '--dir',
      dist,
    ])
    assert.equal(verify.code, 0, verify.stderr)
    assert.match(verify.stdout, /^OK: no widget loader/)
  })
}
