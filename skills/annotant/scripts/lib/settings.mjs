// The project's settings the widget's dialog shows: `instructions`, what the
// reader wants every comment's agent to know about the project, and `models`,
// the model and effort each comment's agent starts on. Saving writes them to
// `.annotant.json` at once: each comment's agent reads the instructions as it
// starts, and the hooks read `models` again for each agent they start, so the
// agents already working, and a follow-up that resumes one, keep the
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

/** The models a classifier's label can map to. */
const AUTO_MODELS = /** @type {const} */ (['haiku', 'sonnet', 'opus'])
/** One model for every comment may also be the session's, `inherit`. */
const FIXED_MODELS = /** @type {const} */ ([...AUTO_MODELS, 'inherit'])
/** The efforts Claude Code takes for an agent; none is the model's own. */
const EFFORTS = /** @type {const} */ (['low', 'medium', 'high', 'xhigh', 'max'])
const LABELS = /** @type {const} */ (['trivial', 'standard', 'hard'])
/** @typedef {(typeof AUTO_MODELS)[number]} AutoModel */
/** @typedef {(typeof FIXED_MODELS)[number]} FixedModel */
/** @typedef {(typeof EFFORTS)[number]} Effort */
/**
 * How each comment's model is picked, as the dialog shows it. `auto`: the
 * classifier's label, then a model and an effort per label; `fixed`: one
 * model and effort, no classifier; `custom`: a `models` written by hand the
 * dialog cannot show (a model id, a label left out, `inherit` for a label),
 * its JSON, read-only. No `effort`: the model's own.
 * @typedef {{ model: AutoModel, effort?: Effort }} AutoChoice
 * @typedef {{ strategy: 'auto', trivial: AutoChoice, standard: AutoChoice, hard: AutoChoice }
 *   | { strategy: 'fixed', model: FixedModel, effort?: Effort }
 *   | { strategy: 'custom', text: string }} ModelsSetting
 */
/**
 * @typedef {{ instructions: string, max: number, models: ModelsSetting }} Settings
 */

/** Without `models` in `.annotant.json`: the hooks' default too (hooks/register.ts). */
const DEFAULT_MODELS = /** @type {const} */ ({
  strategy: 'auto',
  trivial: { model: 'haiku' },
  standard: { model: 'sonnet' },
  hard: { model: 'opus' },
})

/**
 * @template {string} T
 * @param {readonly T[]} known
 * @returns {(value: unknown) => value is T}
 */
const oneOf =
  (known) =>
  /** @returns {value is T} */
  (value) =>
    known.some((one) => one === value)
const isAutoModel = oneOf(AUTO_MODELS)
const isFixedModel = oneOf(FIXED_MODELS)
const isEffort = oneOf(EFFORTS)

/**
 * A model and its effort, as `.annotant.json` or the dialog writes them: the
 * model alone (`"opus"`), or `{ "model": "opus", "effort": "high" }`. Anything
 * else, none.
 * @template {string} M
 * @param {unknown} value
 * @param {(value: unknown) => value is M} isModel
 * @returns {{ model: M, effort?: Effort } | undefined}
 */
function choiceOf(value, isModel) {
  if (isModel(value)) return { model: value }
  if (!isObject(value)) return undefined
  const { model, effort, ...rest } = value
  if (Object.keys(rest).length || !isModel(model)) return undefined
  if (effort === undefined) return { model }
  return isEffort(effort) ? { model, effort } : undefined
}

/**
 * `.annotant.json`'s `models` as the dialog shows it: one model it offers,
 * with its effort or not, is fixed; an object of the three labels, each a
 * model a label can map to, is auto; none or null is the default; anything else is
 * the reader's own, shown as written.
 * @param {unknown} value
 * @returns {ModelsSetting}
 */
function modelsSetting(value) {
  // null too, as the hooks read it.
  if (value === undefined || value === null) return { ...DEFAULT_MODELS }
  const fixed = choiceOf(value, isFixedModel)
  if (fixed) return { strategy: 'fixed', ...fixed }
  if (isObject(value) && Object.keys(value).length === LABELS.length) {
    const trivial = choiceOf(value.trivial, isAutoModel)
    const standard = choiceOf(value.standard, isAutoModel)
    const hard = choiceOf(value.hard, isAutoModel)
    if (trivial && standard && hard) return { strategy: 'auto', trivial, standard, hard }
  }
  return { strategy: 'custom', text: JSON.stringify(value) }
}

/**
 * A choice as the file keeps it: the model alone when it has no effort.
 * @template {string} M
 * @param {{ model: M, effort?: Effort }} choice
 */
const written = ({ model, effort }) => (effort ? { model, effort } : model)

/**
 * The `models` to write for what the dialog sent: a choice for fixed, one per
 * label for auto. Anything else is refused.
 * @param {unknown} sent
 */
function modelsToWrite(sent) {
  if (isObject(sent) && sent.strategy === 'fixed') {
    const { strategy: _, ...rest } = sent
    const fixed = choiceOf(rest, isFixedModel)
    if (fixed) return written(fixed)
  }
  if (isObject(sent) && sent.strategy === 'auto') {
    const trivial = choiceOf(sent.trivial, isAutoModel)
    const standard = choiceOf(sent.standard, isAutoModel)
    const hard = choiceOf(sent.hard, isAutoModel)
    if (trivial && standard && hard)
      return {
        trivial: written(trivial),
        standard: written(standard),
        hard: written(hard),
      }
  }
  throw new SettingsRefusal(
    `models must be one of ${FIXED_MODELS.join(', ')}, or one of ${AUTO_MODELS.join(', ')} for each of ${LABELS.join(', ')}; an effort, one of ${EFFORTS.join(', ')}.`,
  )
}

/** @param {{ model: string, effort?: string }} choice */
const choiceKey = (choice) => `${choice.model}/${choice.effort ?? ''}`

/**
 * One string per setting, to compare them.
 * @param {ModelsSetting} models
 */
const modelsKey = (models) =>
  models.strategy === 'auto'
    ? `auto ${LABELS.map((label) => choiceKey(models[label])).join(' ')}`
    : models.strategy === 'fixed'
      ? `fixed ${choiceKey(models)}`
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
    throw new SettingsRefusal('Send instructions, models, or both.')
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
