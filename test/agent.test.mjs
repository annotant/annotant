// The comment agent ships as a plugin agent: the skill starts it by name, and
// it reads the project's values and runs the scripts itself.
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { SCRIPTS } from './helpers.mjs'

const ROOT = new URL('../', import.meta.url).pathname
const agent = await readFile(path.join(ROOT, 'agents/worker.md'), 'utf8')
const skill = await readFile(path.join(ROOT, 'skills/code-buddy/SKILL.md'), 'utf8')

test('the skill starts the agent the plugin ships', () => {
  const name = agent.match(/^---\n[\s\S]*?^name: (\S+)$[\s\S]*?^---$/m)?.[1]
  assert.equal(name, 'worker')
  assert.match(skill, /subagent_type: "code-buddy:worker"/)
})

test('the agent runs scripts the skill has', async () => {
  const names = [...agent.matchAll(/SKILL\/scripts\/(\w+\.mjs)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(names)].toSorted(), [
    'ask.mjs',
    'claim.mjs',
    'resolve.mjs',
  ])
  for (const name of names) await access(path.join(SCRIPTS, name))
})

test('the agent reads values init writes to .code-buddy.json', () => {
  const config = skill.match(/```json\n\s*(\{[\s\S]*?\})\n\s*```/)?.[1]
  assert.ok(config, 'the skill shows .code-buddy.json')
  for (const key of ['commentsFile', 'devUrl', 'editable', 'checks', 'build']) {
    assert.match(agent, new RegExp(`\`${key}\``), key)
    assert.match(config, new RegExp(`"${key}":`), key)
  }
})
