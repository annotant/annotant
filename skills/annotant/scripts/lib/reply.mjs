// What resolve.mjs and ask.mjs share: Claude files a message under a comment.
import { parseArgs } from 'node:util'
import { findProject, positional } from './project.mjs'
import { MAX_OPTIONS, StoreRefusal, createStore } from './store.mjs'

const MAX_LABEL = 80
const MAX_DESCRIPTION = 300

async function readStdin() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
}

/**
 * A question's arguments: its options, `--option "<label>: <description>"`
 * each (the description is optional), and `--multiple`; or what is wrong
 * with them.
 * @returns {{ problem: string } | { project?: string, args: string[], options: { label: string, description?: string }[], multiple: boolean }}
 */
function questionArgs() {
  let parsed
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        project: { type: 'string' },
        option: { type: 'string', multiple: true },
        multiple: { type: 'boolean' },
      },
    })
  } catch (error) {
    // Its message says how to pass a text starting with "-".
    return { problem: error instanceof Error ? error.message : String(error) }
  }
  const { values, positionals } = parsed
  const options = (values.option ?? []).map((option) => {
    const split = option.indexOf(': ')
    const label = (split === -1 ? option : option.slice(0, split)).trim()
    const description = split === -1 ? '' : option.slice(split + 2).trim()
    return description
      ? {
          label: label.slice(0, MAX_LABEL),
          description: description.slice(0, MAX_DESCRIPTION),
        }
      : { label: label.slice(0, MAX_LABEL) }
  })
  const labels = new Set(options.map((option) => option.label))
  if (values.multiple && !options.length) {
    return { problem: '--multiple needs options' }
  }
  if (options.length === 1 || options.length > MAX_OPTIONS) {
    return { problem: `a question offers 2 to ${MAX_OPTIONS} options` }
  }
  if (labels.size !== options.length || labels.has('')) {
    return { problem: 'each option needs its own label' }
  }
  return {
    project: values.project,
    args: positionals,
    options,
    multiple: values.multiple ?? false,
  }
}

/**
 * @param {string} script
 * @param {{ question: boolean }} options
 */
export async function reply(script, { question }) {
  const asked = question ? questionArgs() : undefined
  const problem = asked && 'problem' in asked ? asked.problem : undefined
  const parsed = asked && !('problem' in asked) ? asked : undefined
  const [id, bodyArg] = parsed ? parsed.args : question ? [] : positional()
  // From the parsed arguments: `--project=<dir>` is one of them.
  const project = parsed
    ? findProject(parsed.project === undefined ? [] : ['--project', parsed.project])
    : findProject()
  const body = problem
    ? ''
    : (bodyArg ?? (process.stdin.isTTY ? '' : await readStdin())).trim()
  const what = question ? 'question' : 'answer'
  if (!id || !project || !body) {
    if (problem) console.error(`${script}: ${problem}`)
    console.error(
      question
        ? `usage: ${script} <id> --project <dir> "<question>" (or the question on stdin)\n` +
            `  [--option "<label>: <description>"]... (2 to ${MAX_OPTIONS} distinct labels) [--multiple]`
        : `usage: ${script} <id> --project <dir> "<${what}>" (or the ${what} on stdin)`,
    )
    process.exit(2)
  }
  try {
    const comment = await createStore(project).answer(id, body, {
      question,
      options: parsed?.options,
      multiple: parsed?.multiple,
    })
    console.log(`${question ? 'asked' : comment.state} ${id} (${comment.route})`)
  } catch (error) {
    if (!(error instanceof StoreRefusal)) throw error
    console.error(`${error.message}; not ${question ? 'asking' : 'resolving'}`)
    process.exit(1)
  }
}
