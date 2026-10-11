<p align="center">
  <img src=".github/assets/buddy.png" alt="Code Buddy's mascot, a small blue caterpillar" height="180">
</p>

<h1 align="center">Code Buddy</h1>

<p align="center">
  <strong>Comment on your running app. Claude makes the change.</strong><br>
  A <a href="https://claude.com/claude-code">Claude Code</a> plugin that turns feedback on a
  running frontend app into code changes.
</p>

<p align="center">
  <a href="https://github.com/neolitec/code-buddy/actions/workflows/ci.yml"><img src="https://github.com/neolitec/code-buddy/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/neolitec/code-buddy/actions/workflows/codeql.yml"><img src="https://github.com/neolitec/code-buddy/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/neolitec/code-buddy"><img src="https://api.scorecard.dev/projects/github.com/neolitec/code-buddy/badge" alt="OpenSSF Scorecard"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#in-the-widget">The widget</a> ·
  <a href="#troubleshooting">Troubleshooting</a> ·
  <a href="#security">Security</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

You comment directly on your dev app in the browser: select text, point at an
element, or write about the page or the whole app. For each comment, Claude
starts a background agent that makes the change, shows you its progress live
under your comment, and answers in the same thread. Reply to follow up; cancel
to stop it.

## How it works

- **The widget** is served by a small local server that the skill starts while
  you run `/code-buddy:code-buddy`. No server, no widget: nothing runs when Claude is not
  watching.
- **Your project** only gets a few lines: a dev-only loader snippet, a
  `.code-buddy.json` config, and a `.code-buddy/` folder for the comments
  (git-ignored by default; `comments.json`, its format versioned, each thread
  whole with its state and history: see
  [the comments file](docs/comments-file.md)). The widget's code never enters your project or
  your production builds; `init` proves it by scanning a production build.
- **The widget is framework-agnostic.** It ships its own React inside a shadow
  root, so it works on Next.js, Vite, CRA or anything served by a dev server,
  without touching your styles or dependencies.
- **Agents work in parallel safely.** One background agent per comment; the
  plugin's hooks take a per-file lock before every write, so two agents never
  edit the same file at once, and refuse an agent a Bash command that writes
  files, which no lock could cover. What each agent does (files read and
  edited, commands, MCP calls, its messages and thinking) shows up live under
  the comment. The hooks are a Claude Code
  [mod](https://claude.dev/blog/getting-started-with-claude-code-mods/), loaded
  once per session: they start no process per tool call, and act only for an
  agent working on a comment.

## Install

Install it as a Claude Code plugin, straight from GitHub (no clone needed):

```sh
claude plugin marketplace add neolitec/code-buddy#stable
claude plugin install code-buddy@code-buddy
```

Or, inside a session: `/plugin marketplace add neolitec/code-buddy#stable`,
then `/plugin install code-buddy@code-buddy`. The `stable` branch holds the
released versions; `main` is where development happens and does not work
without a build. Get new versions with `claude plugin marketplace update
code-buddy`, or turn on auto-update for the marketplace in `/plugin`; the
[changelog](CHANGELOG.md) lists what each brings.

Requires Claude Code 2.1.287 or later (`claude update`), for its mods, and
Node.js 22 or later. On an older Claude Code, `/code-buddy:code-buddy` says so
and does not start.

Then, in your frontend project:

```
/code-buddy:code-buddy init    install in this project (asks only what it cannot detect)
/code-buddy:code-buddy         start a session; open your dev app and comment
/code-buddy:code-buddy update  migrate an older install
/code-buddy:code-buddy uninstall
```

Plugin skills are prefixed with the plugin name, hence `/code-buddy:code-buddy`.

When the frontend lives in a folder of the repository, name it after the
command: `/code-buddy:code-buddy init web` installs Code Buddy in `web/`, and
`/code-buddy:code-buddy web` starts a session there. The folder is resolved
from the current directory, else from the repository root.

## In the widget

- **Comment** opens a new comment for the page, or the whole app.
- **Select text**, then _Comment_, to anchor a comment to that text. A bubble
  then marks the text on the page; clicking it opens the comment's thread.
- **Point at element** to anchor it to an element. A bubble then marks the
  element too; hovering the element chip later outlines it on the page,
  clicking it scrolls to it (navigating first if it lives on another page).
- On the page, blue is what you are pointing at or commenting on; a rainbow,
  around an element or behind a text, marks a comment Claude has yet to
  resolve; once its thread is resolved, the mark goes away.
- **All comments** lists every discussion, newest first, filtered by status.
- While Claude works: what the agent is doing now ("Reading `App.tsx`…",
  "Thinking…"), its latest steps (files read and edited, commands, searches,
  MCP calls, failed tools in red, its messages and its thinking), and
  **Cancel**. Claude Code often hides the thinking itself; its summary shows
  when available, for instance with `"showThinkingSummaries": true` in your
  Claude Code settings.
  Cancelling stops the agent and lists the files it had already changed; edit
  the comment and send it again to hand it to a new agent.
- Once answered: reply in the thread to follow up, reusing the same agent and
  its context when it is still around.

## Troubleshooting

When an agent shows no progress under its comment, edits a file another agent
is changing, or seems stuck, turn on the **hook log**. It writes one line for
each decision the plugin's hooks make about the agents working on comments.

In any Claude Code session:

```
/code-buddy-debug on
```

It is on in every session within 5 seconds, with no restart. Then follow it
from a terminal:

```sh
tail -f ~/.cache/code-buddy/hook.log
```

or run `/code-buddy-debug` (no word) to see its last 20 lines. Turn it off
with `/code-buddy-debug off`; the log stays where it is. Without the command,
`touch ~/.cache/code-buddy/debug` turns it on and removing that file turns it
off. The log keeps its last 128 to 256 KB.

Each line reads `<time> <agent> <comment> <what happened>`; the agent is
`main` for your own session, and the comment `-` until the agent claims one:

```
… main - hooks loaded in a new session (Claude Code 2.1.287)
… a53927e6… e329bcbb… bound to comment e329bcbb… in /Users/me/shop/web
… a53927e6… e329bcbb… locked api/presets.py
… a53927e6… e329bcbb… recorded edit done "../api/presets.py"
… a53927e6… e329bcbb… run ended (answered or asked): unbound, released 1 lock(s), progress dropped
```

| Line                                                        | What it means                                                                                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks loaded in a new session`                             | The hooks run in that session. **No line at all** after starting a session: they did not load (Code Buddy needs Claude Code 2.1.287 or later). |
| `bound to comment <id> in <project>`                        | The agent claimed its comment: from now on its files are locked and its steps shown.                                                           |
| `claim.mjs printed no project, so the agent is not bound`   | The claim failed (the comment was stopped, resolved or deleted); the reason follows.                                                           |
| `cannot read <project>/.code-buddy.json …: binding dropped` | The agent's project has no readable config: it works on without locks or progress.                                                             |
| `locked <file>`                                             | The agent holds that file, named from the repository root, until its run ends.                                                                 |
| `waiting for <file>, held by comment <id>`                  | Another comment's agent is changing it; the agent waits up to 6 seconds.                                                                       |
| `refused <file>: still held by comment <id>`                | The wait ran out: the agent releases its locks, re-reads and retries.                                                                          |
| `no lock for <file>: outside <repository>`                  | Files outside the git repository take no lock.                                                                                                 |
| `refused a Bash write: <command>`                           | The agent tried to write files from Bash, where they cannot be locked; it is told to use Edit or Write.                                        |
| `recorded <step>`                                           | A step shown under the comment. `recorded nothing: the comment is no longer active` when the reader stopped it.                                |
| `run ended …`, `turn ended …`                               | The agent answered, asked, or stopped: its locks are released.                                                                                 |

## Security

- The server listens on `127.0.0.1` only and accepts cross-origin requests
  from `localhost` origins only.
- The loader is guarded by the bundler's compile-time dev flag
  (`process.env.NODE_ENV` or `import.meta.env.DEV`), so it is removed from
  production builds; `scripts/verify-prod.mjs` checks the build output.
- Comments hold page text and HTML excerpts; they stay in your project folder.

To report a vulnerability, see the [security policy](SECURITY.md).

## Development

The repository holds a playground, a small fake app to try Code Buddy on.
Claude Code started in your clone loads the plugin from it, instead of the
installed copy; launch the playground there:

```sh
npm ci
claude
```

```
/playground        a fresh copy of the playground, with Code Buddy, in your browser
/playground keep   the same, keeping the changes agents made last time
```

See [Trying your changes](CONTRIBUTING.md#trying-your-changes) in
CONTRIBUTING.md, which also covers trying them in an app of your own.

What to do after a change:

| You changed                           | To see it                                              |
| ------------------------------------- | ------------------------------------------------------ |
| `SKILL.md`, `agents/*`, `hooks/*`     | `/reload-plugins` in the session, or a new session     |
| `scripts/*.mjs` except the server     | Nothing: each call runs the script again               |
| `scripts/server.mjs`, `scripts/lib/*` | Restart the server: run `/code-buddy:code-buddy` again |
| `widget/src/*`                        | Rebuild the widget, then reload the app page           |

The server reads `dist/widget.js` on every page load, so a rebuild and a page
reload are enough for the widget. From the repository root:

```sh
npm ci          # once; install scripts are disabled
npm run build   # type-checks, then rebuilds dist/widget.js
npm run check   # everything CI checks: format, lint, types, build, tests
```

`dist/` (`widget.js` and `THIRD_PARTY_LICENSES.txt`, the licenses of the
packages it bundles) is never committed on `main`: the Release workflow builds
it and publishes it on the `stable` branch. See [CONTRIBUTING.md](CONTRIBUTING.md)
for the rest of the rules.

Paths below are relative to `skills/code-buddy/`.

| Path                                                   | What                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `SKILL.md`                                             | The skill: watch, init, update, uninstall                  |
| `scripts/server.mjs`                                   | Local server: widget, API, events for the managing session |
| `scripts/claim.mjs`, `resolve.mjs`, `ask.mjs`          | Used by the agents                                         |
| `scripts/detect.mjs`, `verify-prod.mjs`, `migrate.mjs` | Used by `init` / `update`                                  |
| `widget/src`                                           | The widget (React, TypeScript)                             |

At the repository root, `agents/worker.md` is the agent that handles a
comment (`code-buddy:worker`): its steps and rules. `hooks/register.ts` is
the plugin's hooks module (a Claude Code mod, declared in `hooks/hooks.json`):
file locks and live progress.
The values it keeps for the session are typed in `types/index.d.ts`, and
`test/hooks.test.ts` tests it against Claude Code itself:

```sh
npm run test:hooks   # claude plugin validate, then claude plugin test
```

`.claude-plugin/` holds the plugin and marketplace manifests. Run
`claude plugin validate .` from the repository root after editing them.

## Contributing

Contributions are welcome: read [CONTRIBUTING.md](CONTRIBUTING.md) first, and
follow the [code of conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © Kevin Manson

Code Buddy is an independent open source project. It is not affiliated with,
endorsed by or supported by Anthropic. Claude and Claude Code are trademarks
of Anthropic, PBC.
