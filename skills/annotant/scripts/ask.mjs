#!/usr/bin/env node
// ask.mjs <id> --project <dir> "<question>" [--option "<label>: <description>"]... [--multiple]
// (or the question on stdin)
// Puts Claude's question in the thread and leaves the comment waiting on the
// reader, whose answer comes back to the agent as a FOLLOWUP. With options,
// the reader picks one (several with --multiple) or answers in their own words.
import { reply } from './lib/reply.mjs'

await reply('ask.mjs', { question: true })
