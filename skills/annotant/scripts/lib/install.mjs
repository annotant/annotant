// What in a project's install no longer matches this plugin, from its files
// alone: `.annotant.json` and the files its `loader` lists. detect.mjs reports
// it for `update`. It only reads files.
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { errorCode } from './errors.mjs'
import { WIDGET_VERSION } from './project.mjs'

/**
 * One way the install drifted: `kind` for code, `file` the `loader` entry it
 * is about, `detail` for the person.
 * @typedef {{
 *   kind:
 *     | 'version-old'
 *     | 'version-new'
 *     | 'loader-unlisted'
 *     | 'file-missing'
 *     | 'loader-absent'
 *     | 'loader-port'
 *     | 'loader-marker'
 *   file?: string
 *   detail: string
 * }} Drift
 */

// The server's widget, as the loader's script names it: init writes
// 127.0.0.1, a hand-written one may say localhost.
const WIDGET_URL = /\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})\/widget\.js/g
// The marker, set from a script (`dataset`) or written in a tag (an attribute).
// Alone, without a URL, it is a loader whose port is a variable.
const MARKERS = ['annotantLoader', 'data-annotant-loader']
// Over this size a file is not a client entry (detect.mjs's MAX_SOURCE_BYTES).
const MAX_BYTES = 1_000_000

/**
 * The text of the loader's file `file`, or why it cannot be read: outside
 * the project, not a regular file (a folder, a FIFO that would block) or too big.
 * @param {string} root
 * @param {string} file
 * @returns {{ source: string } | { problem: string }}
 */
function loaderSource(root, file) {
  const at = path.resolve(root, file)
  const relative = path.relative(root, at)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    return { problem: 'is outside the project' }
  // One descriptor for the check and the read: the file cannot change in
  // between. O_NONBLOCK: opening a FIFO with no writer would block.
  let fd
  try {
    fd = openSync(at, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch (error) {
    const code = String(errorCode(error))
    return { problem: code === 'ENOENT' ? 'is gone' : `cannot be read (${code})` }
  }
  try {
    const stats = fstatSync(fd)
    if (!stats.isFile()) return { problem: 'is not a file' }
    if (stats.size > MAX_BYTES) return { problem: 'is too big to be a client entry' }
    return { source: readFileSync(fd, 'utf8') }
  } catch (error) {
    return { problem: `cannot be read (${String(errorCode(error))})` }
  } finally {
    closeSync(fd)
  }
}

/**
 * What drifted in the install at `root`, whose `.annotant.json` is `config`.
 * Empty when it matches what init writes today. File names are quoted: they
 * come from the config, and the model reads the details.
 * @param {string} root
 * @param {{ version?: unknown, port?: unknown, loader?: unknown }} config
 * @returns {Drift[]}
 */
export function installDrift(root, config) {
  /** @type {Drift[]} */
  const drift = []
  const { version } = config
  if (typeof version !== 'number' || version < WIDGET_VERSION) {
    drift.push({
      kind: 'version-old',
      detail: `.annotant.json is version ${JSON.stringify(version ?? null)}, this plugin writes ${WIDGET_VERSION}`,
    })
  } else if (version > WIDGET_VERSION) {
    drift.push({
      kind: 'version-new',
      detail: `.annotant.json is version ${version}, newer than this plugin's ${WIDGET_VERSION}: update the plugin`,
    })
  }

  /** @type {unknown[]} */
  const entries = Array.isArray(config.loader) ? config.loader : []
  if (config.loader !== undefined && !Array.isArray(config.loader)) {
    drift.push({
      kind: 'loader-unlisted',
      detail: '`loader` in .annotant.json is not a list of files',
    })
  }
  entries.forEach((entry, index) => {
    if (typeof entry !== 'string')
      drift.push({
        kind: 'loader-unlisted',
        detail: `\`loader\` entry ${index} in .annotant.json is not a file name`,
      })
  })
  const files = entries.filter((entry) => typeof entry === 'string')
  if (!files.length) {
    if (!drift.some((one) => one.kind === 'loader-unlisted'))
      drift.push({
        kind: 'loader-unlisted',
        detail: '.annotant.json lists no file in `loader`',
      })
    return drift
  }

  // The server's own default (server.mjs). A port that is no integer is the
  // server's failure to report, not the loader's: no comparison then.
  const port = Number(config.port ?? 4599)
  for (const file of files) {
    const name = JSON.stringify(file)
    const read = loaderSource(root, file)
    if ('problem' in read) {
      drift.push({ kind: 'file-missing', file, detail: `${name} ${read.problem}` })
      continue
    }
    const ports = [...read.source.matchAll(WIDGET_URL)].map((match) => Number(match[1]))
    const marked = MARKERS.some((marker) => read.source.includes(marker))
    if (!ports.length && !marked) {
      drift.push({ kind: 'loader-absent', file, detail: `${name} holds no loader` })
      continue
    }
    const other = Number.isInteger(port) ? ports.find((one) => one !== port) : undefined
    if (other !== undefined) {
      drift.push({
        kind: 'loader-port',
        file,
        detail: `the loader in ${name} asks port ${other}, the server listens on ${port}`,
      })
    }
    // The URL is enough to find the loader, but init writes the marker and
    // verify-prod.mjs looks for it.
    if (!marked) {
      drift.push({
        kind: 'loader-marker',
        file,
        detail: `the loader in ${name} has no \`data-annotant-loader\``,
      })
    }
  }
  return drift
}
