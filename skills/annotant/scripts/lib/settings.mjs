// The project's settings the widget's dialog shows: today `instructions`, what
// the reader wants every comment's agent to know about the project.
//
// The page's own scripts run beside the widget and can call the server, so
// nothing the browser sends reaches `.annotant.json` by itself: the server
// keeps it as a pending change, in the project's state folder, and only the
// reader's `/annotant-settings accept <code>` in Claude Code (hooks/register.ts)
// writes it.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CONFIG_FILE } from './project.mjs'
import { errorCode } from './errors.mjs'

/** The most characters `instructions` may hold: every agent reads them. hooks/register.ts checks it too. */
const MAX_INSTRUCTIONS = 4000
/**
 * Control, zero-width and bidi characters: in Claude Code, they could make the
 * text the reader reads differ from the text they accept. Tabs and line
 * breaks stay. hooks/register.ts checks it too.
 */
const HIDDEN =
  // oxlint-disable-next-line no-control-regex -- matching control characters is the point
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/

/** A change the server does not take, its text for the reader. */
export class SettingsRefusal extends Error {}

/**
 * `instructions` as `.annotant.json` holds them: '' when absent or not text.
 * @param {unknown} config
 */
const instructionsOf = (config) =>
  typeof config === 'object' &&
  config !== null &&
  'instructions' in config &&
  typeof config.instructions === 'string'
    ? config.instructions
    : ''

/**
 * @typedef {{ instructions: string, at: string }} Pending
 * @typedef {{ instructions: string, pending?: Pending, max: number }} Settings
 */

/**
 * The pending change, if any; a file that is not one counts as none.
 * @param {{ settingsFile: string }} project
 * @returns {Promise<Pending | undefined>}
 */
async function readPending(project) {
  const text = await readFile(project.settingsFile, 'utf8').catch((error) => {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  })
  if (text === undefined) return undefined
  try {
    const pending = JSON.parse(text)
    return typeof pending?.instructions === 'string' && typeof pending.at === 'string'
      ? { instructions: pending.instructions, at: pending.at }
      : undefined
  } catch {
    return undefined
  }
}

/**
 * The settings as they are now: `.annotant.json` read again (the reader may
 * have accepted a change since the server started), and the change waiting.
 * @param {{ root: string, settingsFile: string }} project
 * @returns {Promise<Settings>}
 */
export async function readSettings(project) {
  const config = JSON.parse(await readFile(path.join(project.root, CONFIG_FILE), 'utf8'))
  const pending = await readPending(project)
  return {
    instructions: instructionsOf(config),
    ...(pending && { pending }),
    max: MAX_INSTRUCTIONS,
  }
}

/**
 * Keeps the instructions the reader saved as a pending change. The same as
 * `.annotant.json`'s, it withdraws the change instead.
 * @param {{ root: string, settingsFile: string }} project
 * @param {unknown} input The request's body.
 * @returns {Promise<{ settings: Settings, proposed: boolean }>}
 */
export async function proposeSettings(project, input) {
  const sent =
    typeof input === 'object' && input !== null && 'instructions' in input
      ? input.instructions
      : undefined
  if (typeof sent !== 'string') throw new SettingsRefusal('instructions must be text')
  const instructions = sent.replaceAll('\r\n', '\n').trim()
  if (instructions.length > MAX_INSTRUCTIONS)
    throw new SettingsRefusal(
      `The instructions are too long: ${MAX_INSTRUCTIONS} characters at most.`,
    )
  if (HIDDEN.test(instructions))
    throw new SettingsRefusal(
      'The instructions hold control or invisible characters: write them as plain text.',
    )
  const current = await readSettings(project)
  if (instructions === current.instructions.trim()) {
    await rm(project.settingsFile, { force: true })
    const { pending: _, ...settings } = current
    return { settings, proposed: false }
  }
  const pending = { instructions, at: new Date().toISOString() }
  await mkdir(path.dirname(project.settingsFile), { recursive: true })
  // One per request: two saves at once must not share it.
  const temp = `${project.settingsFile}.${randomUUID()}.tmp`
  await writeFile(temp, `${JSON.stringify(pending, null, 2)}\n`)
  await rename(temp, project.settingsFile)
  return { settings: { ...current, pending }, proposed: true }
}
