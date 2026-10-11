---
name: playground
description:
  Launches the repository's playground app with Code Buddy from this clone, to
  try a change to the widget, the server, the skill or the hooks. "/playground"
  starts from a fresh copy of playground/; "/playground keep" keeps the copy
  and the changes agents made to it. Use when the user says "/playground" or
  wants to try Code Buddy on the playground.
---

# Playground

`playground/` is a small fake app, committed. It runs from `.playground/`, a
git-ignored copy: the agents working on comments edit the copy, never
`playground/`. To change the playground itself, edit `playground/` directly.

LAUNCH is `node .claude/skills/playground/scripts/launch.mjs`, run from the
repository root.

1. Code Buddy must be this clone's. `.claude/skills/code-buddy`, a link to
   the repository root, loads it as a plugin in every session started here,
   and `.claude/settings.json` disables the installed one. If the skill
   `code-buddy:code-buddy` is missing, or listed twice, or its base directory
   is not under this repository, stop and tell the user to start `claude` in
   the repository, trust the folder, and leave out `--plugin-dir`.
2. Run `LAUNCH prepare`, or `LAUNCH prepare keep` when the arguments say
   `keep`. It builds the widget when needed and refreshes `.playground/`. On
   `PORT_BUSY`, stop the background tasks of an earlier `/playground` in this
   session (TaskStop) and run it again. If none is yours, ask with one
   `AskUserQuestion`, naming the busy URLs and the `HOLDER <pid> <command>`
   lines it printed: **Kill them and retry (Recommended)** / **Stop here**.
   Kill → `kill <pid>…` (only those PIDs), then run it again; still busy →
   report and stop. Stop → report what holds the ports and stop.
3. Start the app with the Bash tool, `run_in_background: true`:
   `npm --prefix .playground run dev`.
4. Start `LAUNCH open` the same way: it opens the browser once the app and
   the Code Buddy server answer.
5. Invoke the skill `code-buddy:code-buddy` with the argument `.playground`
   and follow it: it starts the server and watches for comments.

Tell the user, in one line, that the changes stay in `.playground/` and that
`/playground keep` resumes them; `/playground` alone starts over. After a
change to `skills/code-buddy/SKILL.md`, `agents/` or `hooks/`, they need `/reload-plugins`
before the next `/playground`.
