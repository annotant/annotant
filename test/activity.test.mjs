import assert from 'node:assert/strict'
import { test } from 'node:test'
// Node strips the types of this .ts file; it only imports types itself.
import {
  activityOf,
  isOngoing,
  modelName,
  stepKey,
} from '../skills/code-buddy/widget/src/activity.ts'

const step = (fields) => ({ at: 1, kind: 'read', label: 'src/a.ts', ...fields })

test('says what a running tool is doing', () => {
  assert.equal(activityOf(step({ state: 'running' })), 'Reading src/a.ts')
  assert.equal(
    activityOf(step({ kind: 'bash', label: 'Run the tests', state: 'running' })),
    'Running Run the tests',
  )
  assert.equal(
    activityOf(step({ kind: 'mystery', label: 'Tool', state: 'running' })),
    'Using Tool',
  )
})

test('words the claim itself as starting, not as a tool', () => {
  assert.equal(
    activityOf(step({ kind: 'start', label: 'Started', state: 'running' })),
    'Starting',
  )
  assert.equal(
    activityOf(step({ kind: 'start', label: 'Started', state: 'failed' })),
    'Started',
  )
})

test('names the model the agent started on, by its family', () => {
  const start = { kind: 'start', label: 'Started', model: 'claude-haiku-5-5' }
  assert.equal(activityOf(step({ ...start, state: 'running' })), 'Starting on haiku')
  assert.equal(activityOf(step({ ...start, state: 'done' })), 'Started on haiku')
  assert.equal(modelName('claude-opus-5-5[1m]'), 'opus')
  assert.equal(modelName('my-proxy-model'), 'my-proxy-model')
})

test('marks a failed step as failed and over', () => {
  const failed = step({ state: 'failed', error: 'ENOENT' })
  assert.equal(activityOf(failed), 'src/a.ts failed')
  assert.equal(isOngoing(failed), false)
  assert.equal(isOngoing(step({ state: 'running' })), true)
})

test('shows redacted thinking as Thinking, and a summary as itself', () => {
  assert.equal(activityOf(step({ kind: 'thinking', label: '' })), 'Thinking')
  assert.equal(
    activityOf(step({ kind: 'thinking', label: 'Check the header…' })),
    'Check the header',
  )
})

test('falls back to a generic line before the first step', () => {
  assert.equal(activityOf(undefined), 'Claude is working on it')
})

test('keys a tool by its call, so finishing it does not replace it', () => {
  assert.equal(
    stepKey(step({ id: 't1', state: 'running' })),
    stepKey(step({ id: 't1', state: 'done', at: 2 })),
  )
  assert.equal(stepKey(undefined), 'none')
})
