// With a dev widget, the server tells the pages when npm run watch rebuilt it.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { SCRIPTS, freePort, tempDir, tempProject } from './helpers.mjs'

const DEV_BANNER = '/* code-buddy widget (dev build, with the debug panel) */\n'

/**
 * A server run from a copy of the skill, its widget `widget`: the bundle is
 * the copy's, to rewrite.
 * @param {import('node:test').TestContext} t
 * @param {string} widget
 */
async function serve(t, widget) {
  const skill = path.join(await tempDir(t, 'code-buddy-skill-'), 'skills', 'code-buddy')
  await cp(SCRIPTS, path.join(skill, 'scripts'), { recursive: true })
  const bundle = path.join(skill, 'widget', 'dist', 'widget.js')
  await mkdir(path.dirname(bundle), { recursive: true })
  await writeFile(bundle, widget)
  const port = await freePort()
  const child = spawn(
    process.execPath,
    [path.join(skill, 'scripts', 'server.mjs'), '--project', await tempProject(t)],
    {
      env: {
        ...process.env,
        CODE_BUDDY_PORT: String(port),
        CODE_BUDDY_STATE_DIR: await tempDir(t),
        CODE_BUDDY_HOOKS: '1',
        CODE_BUDDY_POLL_MS: '600000',
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  t.after(() => child.kill())
  await new Promise((resolve, reject) => {
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
      if (output.includes('READY')) resolve(undefined)
    })
    child.on('exit', (code) => reject(new Error(`server exited with ${code}`)))
  })
  return { bundle, base: `http://127.0.0.1:${port}` }
}

/**
 * The events the server sends on /api/events within `ms`, by type.
 * @param {import('node:test').TestContext} t
 * @param {string} base
 */
async function events(t, base) {
  const controller = new AbortController()
  t.after(() => controller.abort())
  const response = await fetch(`${base}/api/events`, { signal: controller.signal })
  if (!response.body) throw new Error('no event stream')
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let received = ''
  // The stream is open once its first comment is in.
  while (!received.includes(': listening')) received += (await reader.read()).value ?? ''
  /** @param {number} ms */
  return async (ms) => {
    const deadline = setTimeout(() => controller.abort(), ms)
    try {
      for (;;) received += (await reader.read()).value ?? ''
    } catch {
      return [...received.matchAll(/^event: (\w+)$/gm)].map((match) => match[1])
    } finally {
      clearTimeout(deadline)
    }
  }
}

test('tells the pages once when the dev widget is rebuilt', async (t) => {
  const { bundle, base } = await serve(t, `${DEV_BANNER}one`)
  const received = await events(t, base)
  // As esbuild writes it: truncated, then written, in two calls.
  await writeFile(bundle, '')
  await writeFile(bundle, `${DEV_BANNER}two`)
  assert.deepEqual(await received(1000), ['widget'])
})

test('tells the pages nothing about a released widget', async (t) => {
  const { bundle, base } = await serve(t, '/* code-buddy widget */\none')
  const received = await events(t, base)
  await writeFile(bundle, '/* code-buddy widget */\ntwo')
  assert.deepEqual(await received(500), [])
})
