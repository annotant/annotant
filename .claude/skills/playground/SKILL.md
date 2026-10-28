---
name: playground
description:
  Launches the repository's playground app with Annotant from this clone, to
  try a change to the widget, the server, the skill or the hooks. "/playground"
  starts from a fresh copy of playground/; "/playground keep" keeps the copy
  and the changes agents made to it; "/playground demo" runs demo/, the app the
  website's video is shot on. Use when the user says "/playground" or wants to
  try Annotant on the playground or the demo.
---

# Playground

`playground/` is a small fake app, committed. It runs from `.playground/`, a
git-ignored copy: the agents working on comments edit the copy, never
`playground/`. To change the playground itself, edit `playground/` directly.
With `demo` in the arguments, the app is `demo/` instead, run from `.demo/`:
APP below is `playground` or `demo`.

LAUNCH is `node .claude/skills/playground/scripts/launch.mjs`, run from the
repository root, with `demo` appended to every LAUNCH for the demo.

1. Annotant must be this clone's. `.claude/skills/annotant`, a link to
   the repository root, loads it as a plugin in every session started here,
   and `.claude/settings.json` disables the installed one. If the skill
   `annotant:annotant` is missing, or listed twice, or its base directory
   is not under this repository, stop and tell the user to start `claude` in
   the repository, trust the folder, and leave out `--plugin-dir`.
2. Run `LAUNCH prepare`, or `LAUNCH prepare keep` when the arguments say
   `keep`. It builds the widget when needed and refreshes `.APP/`. On
   `PORT_BUSY`, stop the background tasks of an earlier `/playground` in this
   session (TaskStop); when Annotant's port is the busy one and this session
   watches, ask the user to type `/annotant stop`. Then run it again. If none is yours, ask with one
   `AskUserQuestion`, naming the busy URLs and the `HOLDER <pid> <command>`
   lines it printed: **Kill them and retry (Recommended)** / **Stop here**.
   Kill → `kill <pid>…` (only those PIDs), then run it again; still busy →
   report and stop. Stop → report what holds the ports and stop.
3. Start the app with the Bash tool, `run_in_background: true`:
   `npm --prefix .APP run dev`. Start `npm run watch` the same way: it
   rebuilds the widget on every change to `widget/src/`, and the page reloads
   (type errors print in its output, never holding a rebuild back).
4. Start `LAUNCH open` the same way: it opens the browser once the app and
   the Annotant server answer.
5. Invoke the skill `annotant:annotant` with the argument `.APP`
   and follow it: the plugin's hooks start the server and watch for comments.

Tell the user, in one line, that the changes stay in `.APP/` and that
`/playground keep` (`/playground demo keep` for the demo) resumes them;
without `keep`, it starts over. A change to
`widget/src/` shows by itself; one to `scripts/server.mjs` needs
`/annotant stop`, then `/annotant .APP`. After a change to
`skills/annotant/SKILL.md`, `agents/` or `hooks/`, they need
`/reload-plugins` before the next `/playground`.
