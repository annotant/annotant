// npm run site: the Jekyll image it builds with, what it watches, its builds
// and its server.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { test } from 'node:test'

import {
  SOURCES,
  createPreview,
  jekyllImage,
  rebuilder,
  stage,
  withReload,
} from '../.github/scripts/site-preview.mjs'
import { tempDir } from './helpers.mjs'

const workflow = () =>
  readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8')

test('builds with the Jekyll image the Pages workflow pins', async () => {
  assert.match(
    jekyllImage(await workflow()),
    /^ghcr\.io\/actions\/jekyll-build-pages:v\d+\.\d+\.\d+$/,
  )
  assert.throws(() => jekyllImage('steps: []'), /jekyll-build-pages/)
})

test('watches every path the Pages workflow builds on', async () => {
  const paths = new Set(
    [...(await workflow()).matchAll(/^ {6}- (\S+)$/gm)].map(([, file]) => file),
  )
  assert.ok(paths.size > 0, 'the workflow lists its paths')
  paths.delete('.github/workflows/pages.yml')
  for (const file of paths) {
    const recursive = file.endsWith('/**')
    const dir = recursive ? file.slice(0, -3) : path.posix.dirname(file)
    const watched = SOURCES.some(
      ([folder, deep, counts]) =>
        folder === dir && (recursive ? deep : counts(path.posix.basename(file))),
    )
    assert.ok(watched, `${file} is watched`)
  }
})

test('builds once more after the calls made during a build, and reloads on success', async () => {
  /** @type {((ok: boolean) => void) | undefined} */
  let finish
  let builds = 0
  let reloads = 0
  const rebuild = rebuilder(
    () =>
      new Promise((resolve) => {
        builds++
        finish = resolve
      }),
    () => reloads++,
  )
  const done = rebuild()
  void rebuild()
  void rebuild()
  finish?.(false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(builds, 2)
  assert.equal(reloads, 0, 'a failed build reloads nothing')
  finish?.(true)
  await done
  assert.equal(reloads, 1)

  // A build that throws does not hold the next ones back.
  const throwing = rebuilder(
    () => Promise.reject(new Error('EACCES')),
    () => {},
  )
  await throwing()
  let ran = false
  await rebuilder(
    async () => (ran = true),
    () => {},
  )()
  assert.ok(ran)
})

test('marks its builds as previews, which PostHog tells apart', async (t) => {
  const site = new URL('../site/', import.meta.url)
  const config = await readFile(new URL('_config.yml', site), 'utf8')
  // The site's own config never says it, or the published site's visits would be previews.
  assert.doesNotMatch(config, /^preview:/m)
  const dir = path.join(await tempDir(t), 'staged')
  assert.equal(await stage(dir), true)
  assert.equal(
    await readFile(path.join(dir, '_config.yml'), 'utf8'),
    `${config}\npreview: true\n`,
  )
  const layout = await readFile(new URL('_layouts/default.html', site), 'utf8')
  assert.match(
    layout,
    /\{% if site\.preview %\}\{% assign environment = "preview" %\}[\s\S]*?const environment = \{\{ environment \| jsonify \}\}[\s\S]*?Object\.assign\(event\.properties, \{ environment, internal \}\)/,
  )
})

test('adds the reload script before the end of the body', () => {
  assert.match(
    withReload('<body><p>Hi</p></body></html>'),
    /<p>Hi<\/p><script>.+<\/script><\/body>/,
  )
  assert.match(withReload('<p>Hi</p>'), /^<p>Hi<\/p><script>/)
  // With Annotant's port, its loader too.
  assert.match(
    withReload('<p>Hi</p>', 4599),
    /^<p>Hi<\/p><script type="module" src="http:\/\/127\.0\.0\.1:4599\/widget\.js" data-annotant-loader><\/script><script>/,
  )
})

/**
 * A preview of a small built site, listening on a free port.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} [more] other files of the site
 */
async function preview(t, more = {}) {
  const dir = await tempDir(t)
  const root = path.join(dir, '_site')
  const files = {
    'index.html': '<body>home</body>',
    'docs/index.html': '<body>docs</body>',
    'docs/page.html': '<body>page</body>',
    'assets/site.css': 'body {}',
    ...more,
  }
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), content)
  }
  await writeFile(path.join(dir, 'secret.txt'), 'secret')
  // Next to the site, its name starting like it.
  await mkdir(path.join(dir, '_site-src'))
  await writeFile(path.join(dir, '_site-src', 'staged.txt'), 'staged')
  const { server, reload } = createPreview(root)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { base: `http://127.0.0.1:${address.port}`, port: address.port, reload }
}

/**
 * A request sent as it is, its path and Host not normalized the way fetch
 * would: its status and body.
 * @param {number} port
 * @param {string} target
 * @param {{ method?: string, host?: string }} [options]
 * @returns {Promise<{ status: number | undefined, body: string }>}
 */
const raw = (port, target, { method = 'GET', host = `127.0.0.1:${port}` } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: target, method, headers: { host } },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode, body }))
        // A stream never ends: its headers are enough.
        if (res.headers['content-type'] === 'text/event-stream') {
          res.destroy()
          resolve({ status: res.statusCode, body })
        }
      },
    )
    req.on('error', reject)
    req.end()
  })

test('serves the site the way GitHub Pages does, with the reload script', async (t) => {
  const { base } = await preview(t)
  const home = await fetch(`${base}/`)
  assert.equal(home.status, 200)
  assert.match(home.headers.get('content-type') ?? '', /^text\/html/)
  assert.match(await home.text(), /^<body>home<script>new EventSource/)
  // A folder without its slash: its relative links need it.
  const docs = await fetch(`${base}/docs?a=1`, { redirect: 'manual' })
  assert.equal(docs.status, 301)
  assert.equal(docs.headers.get('location'), '/docs/?a=1')
  assert.match(await (await fetch(`${base}/docs/`)).text(), /docs/)
  assert.match(await (await fetch(`${base}/docs/page`)).text(), /page/)
  const css = await fetch(`${base}/assets/site.css`)
  assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8')
  assert.equal(await css.text(), 'body {}')
})

test('answers a missing page with the reload script, before the first build too', async (t) => {
  const bare = await fetch(`${(await preview(t)).base}/nothing`)
  assert.equal(bare.status, 404)
  assert.match(await bare.text(), /Not found.+new EventSource/)
  const { base } = await preview(t, { '404.html': '<body>lost</body>' })
  const page = await fetch(`${base}/nothing`)
  assert.equal(page.status, 404)
  assert.match(await page.text(), /^<body>lost<script>new EventSource/)
})

test('serves nothing outside the built site', async (t) => {
  const { port } = await preview(t)
  for (const target of [
    '/../secret.txt',
    '/..%2fsecret.txt',
    '/%2e%2e/_site-src/staged.txt',
    '/%E0%A4%A',
  ]) {
    const { status, body } = await raw(port, target)
    assert.equal(status, 404, target)
    assert.doesNotMatch(body, /secret|staged/, target)
  }
})

test("refuses another site's page, its name rebound to this machine", async (t) => {
  const { port } = await preview(t)
  assert.equal((await raw(port, '/', { host: 'evil.example' })).status, 403)
  assert.equal((await raw(port, '/', { host: `localhost:${port}` })).status, 200)
})

test('tells the open pages to reload', async (t) => {
  const { base, port, reload } = await preview(t)
  assert.equal((await raw(port, '/__reload', { method: 'HEAD' })).status, 404)
  const controller = new AbortController()
  t.after(() => controller.abort())
  const response = await fetch(`${base}/__reload`, { signal: controller.signal })
  assert.equal(response.headers.get('content-type'), 'text/event-stream')
  if (!response.body) throw new Error('no event stream')
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let received = ''
  while (!received.includes('event: reload')) {
    if (received.includes('listening')) reload()
    const { value, done } = await reader.read()
    if (done) break
    received += value
  }
  assert.match(received, /event: reload\n/)
})
