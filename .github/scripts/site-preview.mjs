#!/usr/bin/env node
// site-preview.mjs (`npm run site`)
// Previews the website: stages it with site.mjs in _site-src/, builds it in
// _site/ with the Jekyll of GitHub Pages (the Pages workflow's image, through
// Docker, else a local `jekyll`), and serves it on http://localhost:4000.
// A change to what the site is made of rebuilds it and reloads the open
// pages; a build that fails prints why and keeps the last good one, if any.
// With an .annotant.json at the root, the pages it serves load Annotant's
// widget too, so the site can be commented on with /annotant (the build never
// holds it). Run from the repository root.
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, rmSync, statSync, watch } from 'node:fs'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { errorCode } from '../../skills/annotant/scripts/lib/errors.mjs'
import { REPOSITORY } from './site.mjs'

const PORT = 4000
const STAGED = '_site-src'
const BUILT = '_site'

/**
 * What the site is made of, as the Pages workflow's paths list it (but the
 * workflow, whose image is read once at start): each folder watched,
 * recursively or not, and the files in it that count.
 * @type {[dir: string, recursive: boolean, counts: (file: string) => boolean][]}
 */
export const SOURCES = [
  ['.', false, (file) => file === 'README.md'],
  ['docs', true, () => true],
  ['site', true, () => true],
  ['.github/assets', true, () => true],
  ['.github/scripts', false, (file) => file === 'site.mjs'],
]

/** The Host of a request from this machine, by the name the preview prints or its IP. */
const LOCAL = /^(localhost|127\.0\.0\.1)(:\d+)?$/i

/** The path the page listens on for `reload`. */
const EVENTS = '/__reload'

/** @type {Record<string, string>} */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/**
 * The Docker image of the Jekyll build action the Pages workflow pins, at the
 * version its comment names: the preview follows the workflow's bumps, from
 * its next start.
 * @param {string} workflow the Pages workflow's YAML
 */
export function jekyllImage(workflow) {
  const version = /actions\/jekyll-build-pages@[0-9a-f]+ # (v[\w.-]+)/.exec(workflow)?.[1]
  if (!version) throw new Error('the Pages workflow pins no actions/jekyll-build-pages')
  return `ghcr.io/actions/jekyll-build-pages:${version}`
}

/**
 * The page, with the script that reloads it when the site is rebuilt, and
 * Annotant's loader when its server's port is given.
 * @param {string} html
 * @param {number} [annotant]
 */
export function withReload(html, annotant) {
  const loader = annotant
    ? `<script type="module" src="http://127.0.0.1:${annotant}/widget.js" data-annotant-loader></script>`
    : ''
  const script = `${loader}<script>new EventSource('${EVENTS}').addEventListener('reload', () => location.reload())</script>`
  const end = html.lastIndexOf('</body>')
  return end === -1 ? html + script : html.slice(0, end) + script + html.slice(end)
}

/**
 * Whether `name` is a folder, a file, or neither.
 * @param {string} name
 */
function kind(name) {
  try {
    const stats = statSync(name)
    return stats.isDirectory() ? 'dir' : stats.isFile() ? 'file' : undefined
  } catch {
    return undefined
  }
}

/**
 * The file a URL path names in `root`, the way GitHub Pages finds it: a
 * folder's index.html, else the path with `.html`. `redirect` when it names a
 * folder without its trailing slash (its relative links need it). Undefined
 * when there is none, or the path leaves `root`.
 * @param {string} root
 * @param {string} pathname
 * @returns {{ file: string } | { redirect: string } | undefined}
 */
function lookup(root, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  const base = path.resolve(root)
  const file = path.join(base, decoded)
  if (file !== base && !file.startsWith(base + path.sep)) return undefined
  const found = kind(file)
  if (found === 'dir') {
    if (!pathname.endsWith('/')) return { redirect: `${pathname}/` }
    const index = path.join(file, 'index.html')
    return kind(index) === 'file' ? { file: index } : undefined
  }
  if (found === 'file') return { file }
  if (!path.extname(file) && kind(`${file}.html`) === 'file')
    return { file: `${file}.html` }
  return undefined
}

/**
 * A server for the built site in `root`, its pages reloading on `reload()`
 * and loading Annotant's widget from the port `annotant`, when given.
 * @param {string} root
 * @param {number} [annotant]
 */
export function createPreview(root, annotant) {
  /** @type {Set<http.ServerResponse>} */
  const listeners = new Set()
  const server = http.createServer((req, res) => {
    serve(req, res).catch((/** @type {unknown} */ error) => {
      // The URL on one line, and never read as a format string.
      const url = (req.url ?? '').replace(/[\r\n]/g, '')
      console.error('%s: %s', url, error instanceof Error ? error.message : error)
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('Could not read the file.\n')
    })
  })

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  async function serve(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end()
      return
    }
    // Another site's page, its name rebound to this machine, gets nothing.
    if (!LOCAL.test(req.headers.host ?? '')) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden.\n')
      return
    }
    const { pathname, search } = new URL(req.url ?? '/', 'http://localhost')
    if (pathname === EVENTS && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
      })
      // Sent at once: the EventSource opens on the headers.
      res.write(': listening\n\n')
      listeners.add(res)
      req.on('close', () => listeners.delete(res))
      return
    }
    const found = lookup(root, pathname)
    if (found && 'redirect' in found) {
      res.writeHead(301, { location: found.redirect + search }).end()
      return
    }
    const missing = found ? undefined : lookup(root, '/404.html')
    const file = found?.file ?? (missing && 'file' in missing ? missing.file : undefined)
    if (!file) {
      // With the script: a page opened before the first build shows once it ends.
      res
        .writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
        .end(withReload('<p>Not found.</p>', annotant))
      return
    }
    const type = CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream'
    const body = type.startsWith('text/html')
      ? withReload(await readFile(file, 'utf8'), annotant)
      : await readFile(file)
    res.writeHead(found ? 200 : 404, {
      'content-type': type,
      'cache-control': 'no-store',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  const reload = () => {
    for (const listener of listeners) listener.write('event: reload\ndata: \n\n')
  }
  return { server, reload }
}

/**
 * The port of Annotant's server, from the .annotant.json at the root.
 * Undefined without one.
 */
function annotantPort() {
  let config
  try {
    config = JSON.parse(readFileSync('.annotant.json', 'utf8'))
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      console.error('.annotant.json:', error instanceof Error ? error.message : error)
    }
    return undefined
  }
  const port = typeof config?.port === 'number' ? config.port : 4599
  console.log(`The pages load Annotant's widget: comment on them after /annotant.`)
  return port
}

/**
 * Builds the site with `build` on each call, one build at a time: the calls
 * during a build make one more after it. `reload` follows a build that
 * succeeds; one that fails or throws says so, and the last site stays.
 * @param {() => Promise<boolean>} build
 * @param {() => void} reload
 */
export function rebuilder(build, reload) {
  let building = false
  let again = false
  return async () => {
    if (building) {
      again = true
      return
    }
    building = true
    do {
      again = false
      const started = Date.now()
      const ok = await build().catch((/** @type {unknown} */ error) => {
        console.error(error instanceof Error ? error.message : error)
        return false
      })
      if (ok) {
        console.log(`Built in ${((Date.now() - started) / 1000).toFixed(1)} s.`)
        reload()
      } else {
        console.error('The build failed: the preview keeps the last one, if any.')
      }
    } while (again)
    building = false
  }
}

/**
 * Runs a command, its output to the terminal: whether it succeeded.
 * @param {string} command
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<boolean>}
 */
const run = (command, args, env) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    })
    child.on('error', (error) => {
      console.error(`${command}: ${error.message}`)
      resolve(false)
    })
    child.on('exit', (code, signal) => {
      if (signal) console.error(`${command}: killed by ${signal}`)
      resolve(code === 0)
    })
  })

/**
 * Whether a command runs and exits with 0.
 * @param {string} command
 * @param {string[]} args
 */
const works = (command, args) =>
  spawnSync(command, args, { stdio: 'ignore', timeout: 10_000 }).status === 0

/**
 * The Jekyll build: GitHub Pages' own, through Docker, else a local `jekyll`.
 * Undefined when neither runs.
 * @returns {(() => Promise<boolean>) | undefined}
 */
function jekyll() {
  if (works('docker', ['info'])) {
    const image = jekyllImage(readFileSync('.github/workflows/pages.yml', 'utf8'))
    console.log(`Building with ${image}, as GitHub Pages does.`)
    // The action's own entrypoint, with the part of the runner's environment it reads.
    const args = [
      'run',
      '--rm',
      // The image is amd64 only: emulated on other hosts, and said so to skip
      // Docker's warning.
      '--platform=linux/amd64',
      // Files the user owns, not root (Linux).
      ...(process.getuid && process.getgid
        ? [`--user=${process.getuid()}:${process.getgid()}`]
        : []),
      `--volume=${process.cwd()}:/github/workspace`,
      '--env=GITHUB_WORKSPACE=/github/workspace',
      `--env=INPUT_SOURCE=${STAGED}`,
      `--env=INPUT_DESTINATION=${BUILT}`,
      `--env=GITHUB_REPOSITORY=${new URL(REPOSITORY).pathname.slice(1)}`,
      image,
    ]
    return () => run('docker', args)
  }
  if (works('jekyll', ['--version'])) {
    console.log(
      'Docker is not running: building with jekyll, which may differ from GitHub Pages.',
    )
    const args = ['build', `--source=${STAGED}`, `--destination=${BUILT}`]
    return () => run('jekyll', args, { JEKYLL_ENV: 'production' })
  }
  return undefined
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const build = jekyll()
  if (!build) {
    console.error(
      'npm run site needs Docker, running (it builds with GitHub Pages’ image), or jekyll on the PATH.',
    )
    process.exit(1)
  }
  const { server, reload } = createPreview(BUILT, annotantPort())

  const rebuild = rebuilder(async () => {
    // From scratch: a file gone from the sources goes from the site.
    rmSync(STAGED, { recursive: true, force: true })
    return (
      (await run(process.execPath, ['.github/scripts/site.mjs', STAGED])) &&
      (await build())
    )
  }, reload)

  /** @type {NodeJS.Timeout | undefined} */
  let pending
  for (const [dir, recursive, counts] of SOURCES) {
    watch(dir, { recursive }, (_, file) => {
      if (file !== null && !counts(file)) return
      // An editor's save is several events: one build for them all.
      clearTimeout(pending)
      pending = setTimeout(() => void rebuild(), 150)
    }).on('error', (error) => {
      console.error(
        `${dir} is no longer watched (${error.message}): restart npm run site.`,
      )
    })
  }

  server.on('error', (error) => {
    console.error(
      server.listening
        ? `The preview stopped: ${error.message}`
        : `The preview cannot listen on port ${PORT}: ${error.message}`,
    )
    process.exit(1)
  })
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`The site is on http://localhost:${PORT}/ and reloads on every change.`)
    void rebuild()
  })
}
