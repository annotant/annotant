// The project's settings the widget's dialog shows: today `instructions`, what
// the reader wants every comment's agent to know about the project. Saving
// writes them to `.annotant.json` at once; each agent reads that file when it
// starts, so the agents already working, and a follow-up that resumes one,
// keep the instructions they had.
import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CONFIG_FILE } from './project.mjs'
import { errorCode } from './errors.mjs'

/** The most characters `instructions` may hold: every agent reads them. */
const MAX_INSTRUCTIONS = 4000
/**
 * Control, zero-width and bidi characters, refused in the text the widget
 * saves: they could make what an agent reads differ from what the reader
 * sees. Tabs and line breaks stay.
 */
const HIDDEN =
  // oxlint-disable-next-line no-control-regex -- matching control characters is the point
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/

/** A change the server does not take, its text for the reader. */
export class SettingsRefusal extends Error {}

/**
 * @typedef {{ instructions: string, max: number }} Settings
 */

/** @param {{ root: string }} project */
const configFile = (project) => path.join(project.root, CONFIG_FILE)

/**
 * `.annotant.json` as it is now, read again: it may have changed since the
 * server started. One the reader can fix (unreadable, not JSON, not an
 * object) is a refusal that says so: the dialog shows it.
 * @param {{ root: string }} project
 * @returns {Promise<Record<string, unknown>>}
 */
async function readConfig(project) {
  let text
  try {
    text = await readFile(configFile(project), 'utf8')
  } catch (error) {
    throw new SettingsRefusal(
      `${CONFIG_FILE} cannot be read: ${String(errorCode(error) ?? error)}`,
    )
  }
  /** @type {unknown} */
  let config
  try {
    config = JSON.parse(text)
  } catch (error) {
    throw new SettingsRefusal(
      `${CONFIG_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  // An array or a value would lose `instructions` on the way back to text.
  if (!isObject(config))
    throw new SettingsRefusal(`${CONFIG_FILE} must hold a JSON object.`)
  return config
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The settings `.annotant.json` holds: `instructions` '' when absent or not text.
 * @param {{ root: string }} project
 * @returns {Promise<Settings>}
 */
export async function readSettings(project) {
  const { instructions } = await readConfig(project)
  return {
    instructions: typeof instructions === 'string' ? instructions : '',
    max: MAX_INSTRUCTIONS,
  }
}

/**
 * Writes the instructions the reader saved to `.annotant.json`, its other keys
 * kept; none removes the key.
 * @param {{ root: string }} project
 * @param {unknown} input The request's body.
 * @returns {Promise<{ settings: Settings, changed: boolean }>}
 */
export async function saveSettings(project, input) {
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
  const config = await readConfig(project)
  const before = typeof config.instructions === 'string' ? config.instructions : ''
  const settings = { instructions, max: MAX_INSTRUCTIONS }
  if (instructions === before.trim())
    return { settings: { ...settings, instructions: before }, changed: false }
  if (instructions) config.instructions = instructions
  else delete config.instructions
  const file = configFile(project)
  // One per request: two saves at once must not share it.
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`)
    await rename(temp, file)
  } catch (error) {
    // Not left in the reader's project, where it could be committed.
    await rm(temp, { force: true })
    throw new SettingsRefusal(
      `${CONFIG_FILE} cannot be written: ${String(errorCode(error) ?? error)}`,
    )
  }
  return { settings, changed: true }
}
