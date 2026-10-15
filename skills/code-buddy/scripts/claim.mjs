#!/usr/bin/env node
// claim.mjs <id> --project <dir>
// Shows the reader a "working on it" spinner and the agent's progress under the
// comment, and starts a run (r1, r2…) its steps and answer belong to. To stop
// working without resolving, an agent asks the reader a question with ask.mjs.
// Then prints the comment as JSON, the only one the agent reads: never the
// comments file, which holds every other thread.
import { findProject, positional } from './lib/project.mjs'
import { StoreRefusal, createStore, readRoute } from './lib/store.mjs'

/** The messages a thread shows: the reader's comment, then the latest. */
const MAX_MESSAGES = 20

/**
 * The comment as its agent reads it: where it is, its thread, capped to its
 * first message and the latest ones, and the run an earlier agent left.
 * @param {import('./lib/format.mjs').CommentV2} comment
 */
function thread(comment) {
  const { route, url, anchor, messages, state, cancellation } = comment
  const elided = Math.max(0, messages.length - MAX_MESSAGES)
  return {
    route,
    ...(url && { url }),
    anchor,
    state,
    ...(elided && { elided: `[${elided} earlier messages elided]` }),
    messages: elided ? [messages[0], ...messages.slice(elided + 1)] : messages,
    ...(cancellation && { cancellation }),
  }
}

const [id] = positional()
const project = findProject()
if (!id || !project) {
  console.error('usage: claim.mjs <id> --project <dir>')
  process.exit(2)
}

try {
  // Written by the hooks module as it started the agent: the agent, the model
  // it runs on and how its classifier sorted the comment. The environment
  // overrides them.
  const route = await readRoute(project, id)
  const { comment, run } = await createStore(project).claim(id, {
    agent: process.env.CODE_BUDDY_AGENT || route.agent || undefined,
    model: process.env.CODE_BUDDY_MODEL || route.model || undefined,
    complexity: process.env.CODE_BUDDY_COMPLEXITY || route.complexity || undefined,
  })
  // The project found and the run started, for the agent and the logs.
  console.log(`claimed ${id} (${comment.route}) project=${project.root} run=${run}`)
  console.log(JSON.stringify(thread(comment), null, 2))
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  console.error(`${error.message}; stop working on it`)
  process.exit(1)
}
