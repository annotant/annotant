import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const CONFIG_FILE = '.code-buddy.json'
export const SKILL_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)
export const WIDGET_VERSION = 1

/**
 * Whether the widget at `file` is a dev build (`npm run build:dev`, which
 * /playground uses in a clone): the one with the debug panel. Releases ship
 * the other, so what the panel needs is never kept for a user.
 * @param {string} [file]
 */
export function isDevWidget(file = path.join(SKILL_DIR, 'widget', 'dist', 'widget.js')) {
  try {
    // build.mjs writes this banner on a dev build only.
    return readFileSync(file, 'utf8').startsWith('/* code-buddy widget (dev build')
  } catch {
    return false
  }
}

// Not os.tmpdir(): hooks, sandboxed shells and the server may each see a different TMPDIR.
// hooks/register.ts finds the same folder, and the progress files in it, the same way.
export const STATE_ROOT =
  process.env.CODE_BUDDY_STATE_DIR ??
  path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'code-buddy')

/**
 * The project a script acts on: `--project <dir>`, else CODE_BUDDY_PROJECT, else the
 * nearest ancestor of the working directory holding `.code-buddy.json`.
 */
export function findProject(argv = process.argv.slice(2)) {
  const flag = argv.indexOf('--project')
  const start =
    flag === -1 ? (process.env.CODE_BUDDY_PROJECT ?? process.cwd()) : argv[flag + 1]
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, CONFIG_FILE))) return project(dir)
    if (path.dirname(dir) === dir) return undefined
  }
}

export function project(root) {
  const config = JSON.parse(readFileSync(path.join(root, CONFIG_FILE), 'utf8'))
  const state = path.join(
    STATE_ROOT,
    createHash('sha1').update(root).digest('hex').slice(0, 12),
  )
  return {
    root,
    config,
    commentsFile: path.resolve(
      root,
      process.env.CODE_BUDDY_COMMENTS_FILE ??
        config.commentsFile ??
        '.code-buddy/comments.json',
    ),
    progressDir: path.join(state, 'progress'),
  }
}

/**
 * The project root served on `port` by a code-buddy server. Rejects when nothing
 * answers there; resolves to undefined when something else does.
 * @param {number | string} port
 * @returns {Promise<string | undefined>}
 */
export async function servedProject(port) {
  const value = Number(port)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new RangeError(`invalid port: ${String(port)}`)
  }
  const url = new URL('/api/health', 'http://127.0.0.1')
  url.port = String(value)
  const health = await (await fetch(url)).json()
  return typeof health === 'object' &&
    health !== null &&
    'project' in health &&
    typeof health.project === 'string'
    ? health.project
    : undefined
}

/**
 * The origins of the project's dev app, which the browser extension mounts
 * the widget on: `devUrl`'s, then `devOrigins`. A `devUrl` that is no URL
 * with an origin (`localhost:3000`) adds none.
 * @param {{ devUrl?: unknown, devOrigins?: unknown }} config
 * @returns {string[]}
 */
export function appOrigins(config) {
  const origins = Array.isArray(config.devOrigins)
    ? config.devOrigins.filter((origin) => typeof origin === 'string')
    : []
  const { devUrl } = config
  const origin =
    typeof devUrl === 'string' && URL.canParse(devUrl) ? new URL(devUrl).origin : 'null'
  return origin === 'null' ? origins : [origin, ...origins]
}

/** Removes `--project <dir>` so the remaining arguments are positional. */
export function positional(argv = process.argv.slice(2)) {
  const flag = argv.indexOf('--project')
  return flag === -1 ? argv : argv.filter((_, i) => i !== flag && i !== flag + 1)
}
