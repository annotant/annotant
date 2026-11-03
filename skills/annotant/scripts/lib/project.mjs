import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const CONFIG_FILE = '.annotant.json'
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
    return readFileSync(file, 'utf8').startsWith('/* annotant widget (dev build')
  } catch {
    return false
  }
}

// Not os.tmpdir(): hooks, sandboxed shells and the server may each see a different TMPDIR.
// hooks/register.ts finds the same folder, and the progress files in it, the same way.
export const STATE_ROOT =
  process.env.ANNOTANT_STATE_DIR ??
  path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'annotant')

/**
 * The project a script acts on: `--project <dir>`, else ANNOTANT_PROJECT, else the
 * nearest ancestor of the working directory holding `.annotant.json`.
 */
export function findProject(argv = process.argv.slice(2)) {
  const flag = argv.indexOf('--project')
  const start =
    flag === -1 ? (process.env.ANNOTANT_PROJECT ?? process.cwd()) : argv[flag + 1]
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
      process.env.ANNOTANT_COMMENTS_FILE ??
        config.commentsFile ??
        '.annotant/comments.json',
    ),
    progressDir: path.join(state, 'progress'),
  }
}

/**
 * The project root served on `port` by an annotant server. Rejects when nothing
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

/** Removes `--project <dir>` so the remaining arguments are positional. */
export function positional(argv = process.argv.slice(2)) {
  const flag = argv.indexOf('--project')
  return flag === -1 ? argv : argv.filter((_, i) => i !== flag && i !== flag + 1)
}
