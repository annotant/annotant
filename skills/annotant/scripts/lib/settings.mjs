// The project's settings the widget's dialog shows: `instructions`, what the
// reader wants every comment's agent to know about the project, and `models`,
// the model each comment's agent starts on. Saving writes them to
// `.annotant.json` at once; the hooks read it again for each agent they start,
// so the agents already working, and a follow-up that resumes one, keep the
// instructions and the model they had.
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

/** The models the dialog offers; `inherit` is the session's. */
const MODELS = /** @type {const} */ (['haiku', 'sonnet', 'opus', 'inherit'])
const LABELS = /** @type {const} */ (['trivial', 'standard', 'hard'])
/** @typedef {(typeof MODELS)[number]} Model */
/**
 * How each comment's model is picked, as the dialog shows it. `auto`: the
 * classifier's label, then a model per label; `fixed`: one model, no
 * classifier; `custom`: a `models` written by hand the dialog cannot show (a
 * model id, a label left out), its JSON, read-only.
 * @typedef {{ strategy: 'auto', trivial: Model, standard: Model, hard: Model }
 *   | { strategy: 'fixed', model: Model }
 *   | { strategy: 'custom', text: string }} ModelsSetting
 */
/**
 * @typedef {{ instructions: string, max: number, models: ModelsSetting }} Settings
 */

/** Without `models` in `.annotant.json`: the hooks' default too (hooks/register.ts). */
const DEFAULT_MODELS = /** @type {const} */ ({
  strategy: 'auto',
  trivial: 'haiku',
  standard: 'inherit',
  hard: 'opus',
})

/**
 * @param {unknown} value
 * @returns {value is Model}
 */
const isModel = (value) => MODELS.some((model) => model === value)

/**
 * `.annotant.json`'s `models` as the dialog shows it: a model it offers
 * (`"opus"`) is fixed; an object of the three labels, each a model it offers,
 * is auto; none is the default; anything else is the reader's own, shown as
 * written.
 * @param {unknown} value
 * @returns {ModelsSetting}
 */
function modelsSetting(value) {
  if (value === undefined) return { ...DEFAULT_MODELS }
  if (isModel(value)) return { strategy: 'fixed', model: value }
  if (isObject(value) && Object.keys(value).length === LABELS.length) {
    const { trivial, standard, hard } = value
    if (isModel(trivial) && isModel(standard) && isModel(hard))
      return { strategy: 'auto', trivial, standard, hard }
  }
  return { strategy: 'custom', text: JSON.stringify(value) }
}

/**
 * The `models` to write for what the dialog sent: a model for fixed, the
 * three labels' for auto. Anything else is refused.
 * @param {unknown} sent
 * @returns {Model | { trivial: Model, standard: Model, hard: Model }}
 */
function modelsToWrite(sent) {
  if (isObject(sent) && sent.strategy === 'fixed' && isModel(sent.model))
    return sent.model
  if (isObject(sent) && sent.strategy === 'auto') {
    const { trivial, standard, hard } = sent
    if (isModel(trivial) && isModel(standard) && isModel(hard))
      return { trivial, standard, hard }
  }
  throw new SettingsRefusal(
    `models must be one of ${MODELS.join(', ')}, or one of them for each of ${LABELS.join(', ')}.`,
  )
}

/** @param {ModelsSetting} models One string per setting, to compare them. */
const modelsKey = (models) =>
  models.strategy === 'auto'
    ? `auto ${models.trivial} ${models.standard} ${models.hard}`
    : models.strategy === 'fixed'
      ? `fixed ${models.model}`
      : `custom ${models.text}`

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
 * What `.annotant.json` holds, as the dialog shows it.
 * @param {Record<string, unknown>} config
 * @returns {Settings}
 */
const settingsOf = (config) => ({
  instructions: typeof config.instructions === 'string' ? config.instructions : '',
  max: MAX_INSTRUCTIONS,
  models: modelsSetting(config.models),
})

/**
 * The settings `.annotant.json` holds: `instructions` '' when absent or not
 * text, `models` the default when absent.
 * @param {{ root: string }} project
 * @returns {Promise<Settings>}
 */
export async function readSettings(project) {
  return settingsOf(await readConfig(project))
}

/**
 * The instructions sent, trimmed, or a refusal that says why not.
 * @param {unknown} sent
 */
function instructionsToWrite(sent) {
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
  return instructions
}

/**
 * Writes what the reader saved to `.annotant.json`, its other keys kept: the
 * `instructions` (none removes the key), the `models`, or both. A `models`
 * written by hand that the dialog cannot show is not replaced.
 * @param {{ root: string }} project
 * @param {unknown} input The request's body.
 * @returns {Promise<{ settings: Settings, changed: { instructions: boolean, models: boolean } }>}
 */
export async function saveSettings(project, input) {
  const body = isObject(input) ? input : {}
  if (!('instructions' in body) && !('models' in body))
    throw new SettingsRefusal('instructions must be text')
  const instructions =
    'instructions' in body ? instructionsToWrite(body.instructions) : undefined
  const models = 'models' in body ? modelsToWrite(body.models) : undefined
  const config = await readConfig(project)
  const before = settingsOf(config)
  const changed = {
    instructions:
      instructions !== undefined && instructions !== before.instructions.trim(),
    models:
      models !== undefined &&
      modelsKey(modelsSetting(models)) !== modelsKey(before.models),
  }
  if (changed.models && before.models.strategy === 'custom')
    throw new SettingsRefusal(
      `models in ${CONFIG_FILE} was written by hand: change it in the file.`,
    )
  if (!changed.instructions && !changed.models) return { settings: before, changed }
  if (changed.instructions) {
    if (instructions) config.instructions = instructions
    else delete config.instructions
  }
  if (changed.models) config.models = models
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
  return { settings: settingsOf(config), changed }
}
