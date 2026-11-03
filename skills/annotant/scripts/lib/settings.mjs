// The project's settings the widget's dialog shows: today `instructions`, what
// the reader wants every comment's agent to know about the project. Saving
// writes them to `.annotant.json` at once; each agent reads that file when it
// starts, so the agents already working keep the instructions they had.
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CONFIG_FILE } from './project.mjs'

/** The most characters `instructions` may hold: every agent reads them. */
const MAX_INSTRUCTIONS = 4000
/**
 * Control, zero-width and bidi characters: they could make the text an agent
 * reads differ from the text the reader sees in `.annotant.json`. Tabs and
 * line breaks stay.
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
 * server started.
 * @param {{ root: string }} project
 * @returns {Promise<Record<string, unknown>>}
 */
async function readConfig(project) {
  return JSON.parse(await readFile(configFile(project), 'utf8'))
}

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
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`)
  await rename(temp, file)
  return { settings, changed: true }
}
