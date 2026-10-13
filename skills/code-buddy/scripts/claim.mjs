#!/usr/bin/env node
// claim.mjs <id> --project <dir>
// Shows the reader a "working on it" spinner and the agent's progress under the
// comment, and starts a run (r1, r2…) its steps and answer belong to. To stop
// working without resolving, an agent asks the reader a question with ask.mjs.
import { findProject, positional } from './lib/project.mjs'
import { StoreRefusal, createStore } from './lib/store.mjs'

const [id] = positional()
const project = findProject()
if (!id || !project) {
  console.error('usage: claim.mjs <id> --project <dir>')
  process.exit(2)
}

try {
  // Set by the hooks: the agent that runs this claim, the model it runs on and
  // how their classifier sorted the comment.
  const { comment, run } = await createStore(project).claim(id, {
    agent: process.env.CODE_BUDDY_AGENT || undefined,
    model: process.env.CODE_BUDDY_MODEL || undefined,
    complexity: process.env.CODE_BUDDY_COMPLEXITY || undefined,
  })
  // The hooks bind the agent to this project, and tag its steps with the run:
  // they cannot see the shell's directory a relative --project was resolved from.
  console.log(`claimed ${id} (${comment.route}) project=${project.root} run=${run}`)
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  console.error(`${error.message}; stop working on it`)
  process.exit(1)
}
