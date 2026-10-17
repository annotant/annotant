// The comment agent ships as a plugin agent: the plugin's hooks start it by
// name, and it reads the project's values and runs the scripts itself.
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { SCRIPTS } from './helpers.mjs'

const ROOT = new URL('../', import.meta.url).pathname
const agent = await readFile(path.join(ROOT, 'agents/worker.md'), 'utf8')
const skill = await readFile(path.join(ROOT, 'skills/code-buddy/SKILL.md'), 'utf8')
const hooks = await readFile(path.join(ROOT, 'hooks/register.ts'), 'utf8')

test("each comment's agent gets the instructions of the agent the plugin ships", () => {
  const name = agent.match(/^---\n[\s\S]*?^name: (\S+)$[\s\S]*?^---$/m)?.[1]
  assert.equal(name, 'worker')
  assert.match(hooks, /^const WORKER = 'code-buddy:worker'$/m)
  assert.match(hooks, /\$\.fs\s*\.read\(`\$\{\$\.plugin\.root\}\/agents\/worker\.md`\)/)
})

test('the hooks pass the agent its paths, not its steps', () => {
  assert.match(
    hooks,
    /`SKILL=\$\{skillDir\(\$\)\}`, `PROJECT=\$\{watched\.root\}`, fenced\(line\)\]/,
  )
  assert.doesNotMatch(skill, /claim\.mjs/)
})

/** The fence's header a source writes. */
const header = (/** @type {string} */ source) =>
  source.match(/`(Each line below starting with \$\{marker\} [^`]+)`/)?.[1]

test("the hooks and claim.mjs fence the reader's text behind the same header", async () => {
  const claim = await readFile(path.join(SCRIPTS, 'claim.mjs'), 'utf8')
  assert.ok(header(hooks))
  assert.equal(header(claim), header(hooks))
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
