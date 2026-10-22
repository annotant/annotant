#!/usr/bin/env node
// resolve.mjs <id> --project <dir> "<answer>"   (or the answer on stdin)
// Adds the answer to the comment's thread and resolves it; once the reader
// had it resolved, the answer waits on them (answered), and they resolve it.
import { reply } from './lib/reply.mjs'

await reply('resolve.mjs', { question: false })
