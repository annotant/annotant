// A comment's agent's AskUserQuestion, asked in the thread: what ask.mjs
// writes for its arguments, and the reader's answer in the tool's own shape,
// as if they had answered the dialog in the terminal.
import { MAX_OPTIONS } from './store.mjs'

const MAX_LABEL = 80
const MAX_DESCRIPTION = 300

/**
 * One of AskUserQuestion's questions, as the model writes it; `kind` `text`
 * and `number` ask for words or a value, with no options.
 * @typedef {object} AskedQuestion
 * @property {string} question
 * @property {string} [header]
 * @property {'choice' | 'text' | 'number'} [kind]
 * @property {string} [description]
 * @property {{ label: string, description?: string }[]} [options]
 * @property {boolean} [multiSelect]
 * @property {number} [min]
 * @property {number} [max]
 * @property {string} [unit]
 */

/**
 * The question's options as ask.mjs files them, a description only when
 * there is one, each cut to its limit.
 * @param {{ label: string, description?: string }[]} options
 */
export const optionsOf = (options) =>
  options.map(({ label, description = '' }) =>
    description.trim()
      ? {
          label: label.trim().slice(0, MAX_LABEL),
          description: description.trim().slice(0, MAX_DESCRIPTION),
        }
      : { label: label.trim().slice(0, MAX_LABEL) },
  )

/**
 * What is wrong with a question's options for the thread, or undefined.
 * @param {{ label: string }[]} options
 * @param {boolean} multiple
 */
export function optionsProblem(options, multiple) {
  const labels = new Set(options.map((option) => option.label))
  if (multiple && !options.length) return '--multiple needs options'
  if (options.length === 1 || options.length > MAX_OPTIONS) {
    return `a question offers 2 to ${MAX_OPTIONS} options`
  }
  if (labels.size !== options.length || labels.has('')) {
    return 'each option needs its own label'
  }
  return undefined
}

/** @param {unknown} value */
const isQuestion = (value) =>
  typeof value === 'object' &&
  value !== null &&
  'question' in value &&
  typeof value.question === 'string' &&
  value.question.trim() !== ''

/**
 * The tool's questions, those it may hold, or undefined when there are none.
 * @param {unknown} questions
 * @returns {AskedQuestion[] | undefined}
 */
export function questionsOf(questions) {
  if (!Array.isArray(questions)) return undefined
  /** @type {AskedQuestion[]} */
  const asked = questions.filter(isQuestion)
  return asked.length ? asked : undefined
}

/** A choice question's options, with a label each. @param {AskedQuestion} asked */
function offered(asked) {
  if ((asked.kind ?? 'choice') !== 'choice' || !Array.isArray(asked.options)) return []
  return asked.options.filter(
    (option) => typeof option?.label === 'string' && option.label.trim(),
  )
}

/** A question's options as lines of its text. @param {AskedQuestion} asked */
const listed = (asked) =>
  offered(asked).map(
    ({ label, description }) =>
      `- ${label.trim()}${description?.trim() ? `: ${description.trim()}` : ''}`,
  )

/** The question's own words: its helper line, and the range a number takes. */
function wordsOf(/** @type {AskedQuestion} */ asked) {
  const range =
    asked.kind === 'number' &&
    typeof asked.min === 'number' &&
    typeof asked.max === 'number'
      ? `(${asked.min} to ${asked.max}${asked.unit ? ` ${asked.unit}` : ''})`
      : ''
  return [asked.question.trim(), asked.description?.trim() ?? '', range]
    .filter(Boolean)
    .join('\n')
}

/**
 * What ask.mjs files for the questions: one asks with its options, which the
 * widget shows as buttons; several, each with its options in the text, are
 * answered in the reader's own words.
 * @param {AskedQuestion[]} questions
 * @returns {{ body: string, options: { label: string, description?: string }[], multiple: boolean }}
 */
export function threadQuestion(questions) {
  const [first] = questions
  if (questions.length === 1 && first) {
    const options = optionsOf(offered(first))
    const multiple = options.length > 0 && first.multiSelect === true
    // Options the thread cannot show: in the text, the reader answers in words.
    return optionsProblem(options, multiple)
      ? {
          body: [wordsOf(first), ...listed(first)].join('\n'),
          options: [],
          multiple: false,
        }
      : { body: wordsOf(first), options, multiple }
  }
  const body = questions
    .map((asked, at) => [`${at + 1}. ${wordsOf(asked)}`, ...listed(asked)].join('\n'))
    .join('\n\n')
  return { body, options: [], multiple: false }
}

/**
 * The reader's answer, as the server hands it over.
 * @typedef {object} ReaderAnswer
 * @property {string} body
 * @property {string[]} [choices]
 * @property {string[]} [images] The files, as paths the agent opens with Read.
 * @property {import('./format.mjs').PickedElement[]} [elements]
 */

/**
 * The reader's own words in their answer: its body, the options they chose
 * left out (store.mjs's readerReply puts them first).
 * @param {ReaderAnswer} answer
 */
function wordsIn({ body, choices = [] }) {
  const chosen = choices.join(', ')
  return chosen && body.startsWith(chosen)
    ? body.slice(chosen.length).trim()
    : body.trim()
}

/** What went with the words: the images, and the elements picked in the page. */
function attachedTo(/** @type {ReaderAnswer} */ { images = [], elements = [] }) {
  return [
    ...(images.length
      ? [`The reader attached images; open each with Read: ${images.join(', ')}`]
      : []),
    ...elements.map(
      (element) =>
        `The reader picked <${element.tag}> "${element.text.slice(0, 80)}" (${element.selector}) on ${element.route}.`,
    ),
  ]
}

/**
 * The tool's input once answered, which Claude Code takes for the dialog's:
 * the options chosen as `answers`, keyed by the question, the reader's words
 * as `response`, or as the question's notes beside their choices.
 * @param {Record<string, unknown>} input The tool's input.
 * @param {AskedQuestion[]} questions
 * @param {ReaderAnswer} answer
 * @param {(text: string) => string} fence The reader's text, fenced as data.
 */
export function toolAnswer(input, questions, answer, fence) {
  const [first] = questions
  const said = [wordsIn(answer), ...attachedTo(answer)].filter(Boolean).join('\n\n')
  const chosen = questions.length === 1 && answer.choices?.length ? answer.choices : []
  if (first && chosen.length) {
    return {
      ...input,
      answers: { [first.question]: chosen.join(', ') },
      ...(said && { annotations: { [first.question]: { notes: fence(said) } } }),
    }
  }
  return { ...input, answers: {}, response: fence(said) }
}
