// The debug panel's tool calls and agents' prompts, read from Claude Code's transcripts.
import assert from 'node:assert/strict'
import { mkdir, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import {
  findAgentPrompt,
  findToolCall,
} from '../skills/code-buddy/scripts/lib/transcripts.mjs'
import { tempDir } from './helpers.mjs'

const ID = 'toolu_01EYsupHGk3ov4ydNDsUL5XG'
const line = (content) => `${JSON.stringify({ message: { content } })}\n`
const record = (role, content) =>
  `${JSON.stringify({ type: role, message: { role, content } })}\n`

test('finds a call and its result in the agent transcript, not where it is quoted', async (t) => {
  const dir = await tempDir(t)
  const session = path.join(dir, '-repo', 'session')
  await mkdir(path.join(session, 'subagents'), { recursive: true })
  // The main session's transcript only mentions the id.
  await writeFile(`${session}.jsonl`, line([{ type: 'text', text: `see ${ID}` }]))
  const agent = path.join(session, 'subagents', 'agent-a1.jsonl')
  await writeFile(
    agent,
    line([
      { type: 'tool_use', id: ID, name: 'Bash', input: { command: 'node ask.mjs' } },
    ]) +
      line([
        {
          type: 'tool_result',
          tool_use_id: ID,
          content: [{ type: 'text', text: 'asked c1' }],
        },
      ]),
  )

  assert.deepEqual(await findToolCall(ID, { dir }), {
    transcript: agent,
    name: 'Bash',
    input: { command: 'node ask.mjs' },
    result: 'asked c1',
    error: false,
  })
})

test('reads nothing for an id that is not a tool call, or one too old', async (t) => {
  const dir = await tempDir(t)
  await writeFile(
    path.join(dir, 'old.jsonl'),
    line([{ type: 'tool_use', id: ID, name: 'Read', input: {} }]),
  )
  assert.equal(await findToolCall('../../etc/passwd', { dir }), undefined)
  const inAMonth = Date.now() + 30 * 24 * 60 * 60 * 1000
  assert.equal(await findToolCall(ID, { dir, now: inAMonth }), undefined)
  assert.equal((await findToolCall(ID, { dir }))?.name, 'Read')
})

test("reads an agent's first message from its own transcript", async (t) => {
  const dir = await tempDir(t)
  const subagents = path.join(dir, '-repo', 'session', 'subagents')
  await mkdir(subagents, { recursive: true })
  const prompt = 'c1\nNEW c1 route=/ page-level body="Hi"\nSKILL=/s\nPROJECT=/p'
  // The same agent id in an older session's transcript.
  const older = path.join(dir, '-repo', 'old', 'subagents', 'agent-a1aaaaaaaa.jsonl')
  await mkdir(path.dirname(older), { recursive: true })
  await writeFile(older, record('user', 'an older prompt'))
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  await utimes(older, anHourAgo, anHourAgo)
  const agent = path.join(subagents, 'agent-a1aaaaaaaa.jsonl')
  await writeFile(
    agent,
    'not json\n' +
      record('user', [{ type: 'text', text: prompt }]) +
      record('assistant', [{ type: 'text', text: 'Claiming it.' }]) +
      record('user', 'a later message'),
  )

  assert.deepEqual(await findAgentPrompt('a1aaaaaaaa', { dir }), {
    transcript: agent,
    prompt,
  })
  // Its type, from the metadata Claude Code writes next to the transcript.
  await writeFile(
    path.join(subagents, 'agent-a1aaaaaaaa.meta.json'),
    JSON.stringify({ agentType: 'code-buddy:worker', name: 'cb-c1' }),
  )
  assert.equal(
    (await findAgentPrompt('a1aaaaaaaa', { dir }))?.agentType,
    'code-buddy:worker',
  )
  assert.equal(await findAgentPrompt('c3cccccccc', { dir }), undefined)
  assert.equal(await findAgentPrompt('../../etc', { dir }), undefined)
  const inAMonth = Date.now() + 30 * 24 * 60 * 60 * 1000
  assert.equal(await findAgentPrompt('a1aaaaaaaa', { dir, now: inAMonth }), undefined)
})

test('cuts a long first message, as the panel shows its start', async (t) => {
  const dir = await tempDir(t)
  await writeFile(
    path.join(dir, 'agent-a1aaaaaaaa.jsonl'),
    record('user', 'x'.repeat(30_000)),
  )
  const found = await findAgentPrompt('a1aaaaaaaa', { dir })
  assert.equal(found?.prompt, `${'x'.repeat(20_000)}\n…`)
})
