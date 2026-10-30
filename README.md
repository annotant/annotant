<p align="center">
  <img src=".github/assets/annotant.png" alt="Annotant's mascot, a small blue ant" height="180">
</p>

<h1 align="center">Annotant</h1>

<p align="center">
  <strong>Comment on your running app. Claude makes the change.</strong><br>
  A <a href="https://claude.com/claude-code">Claude Code</a> plugin that turns feedback on a
  running frontend app into code changes.
</p>

<p align="center">
  <a href="https://github.com/annotant/annotant/actions/workflows/ci.yml"><img src="https://github.com/annotant/annotant/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/annotant/annotant/actions/workflows/codeql.yml"><img src="https://github.com/annotant/annotant/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/annotant/annotant"><img src="https://api.scorecard.dev/projects/github.com/annotant/annotant/badge" alt="OpenSSF Scorecard"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
</p>

<p align="center">
  <a href="https://annotant.keveun.net/">Website</a> ·
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#in-the-widget">The widget</a> ·
  <a href="#troubleshooting">Troubleshooting</a> ·
  <a href="#known-issues">Known issues</a> ·
  <a href="#security">Security</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

You comment directly on your dev app in the browser: select text, point at an
element, draw an area, or write about the page or the whole app. For each
comment, Claude starts a background agent that makes the change, shows you its
progress live under your comment, and answers in the same thread. Reply to
follow up; cancel to stop it.

## How it works

- **The widget** is served by a small local server that the plugin starts
  when you run `/annotant`, for the session's life. No server, no widget:
  nothing runs when Claude is not watching.
- **Your project** only gets a few lines: a dev-only loader snippet, a
  `.annotant.json` config, and a `.annotant/` folder for the comments
  (git-ignored by default; `comments.json`, its format versioned, each thread
  whole with its state and history: see
  [the comments file](docs/comments-file.md)). The widget's code never enters your project or
  your production builds; `init` proves it by scanning a production build.
- **The widget is framework-agnostic.** It ships its own React inside a shadow
  root, so it works on Next.js, Vite, CRA or anything served by a dev server,
  without touching your styles or dependencies.
- **No session waits on another.** The plugin's hooks read the server and
  start each comment's agent at once, in the background, with no model turn:
  keep working with Claude in the same session, comments are not held up by
  it. Three agents run at a time; a fourth comment starts when one ends.
- **Agents work in parallel safely.** One background agent per comment; its
  own hooks take a per-file lock before every write, so two agents never
  edit the same file at once, and refuse it a Bash command that writes
  files, which no lock could cover. What each agent does (files read and
  edited, commands, MCP calls, its messages and thinking) shows up live under
  the comment. The plugin's hooks are a Claude Code
  [mod](https://claude.dev/blog/getting-started-with-claude-code-mods/), loaded
  once per session, for the watch; each comment's agent runs a short script
  around each of its tools, and no other agent does.
- **Each comment gets a model that fits it.** Before its agent starts, a
  classifier sorts the comment as `trivial`, `standard` or `hard`, and
  `models` in `.annotant.json` picks the model for it (by default Haiku,
  the session's own model, and Opus). The widget names it on the thread
  ("haiku · trivial"). A comment of images alone is not classified: it
  starts on the session's model at a medium effort. See
  [Models](docs/comments-file.md#models).
- **The widget follows your app's theme.** `init` finds how your app switches
  between light and dark (Tailwind's `darkMode`, `next-themes`, a `.dark`
  class or a `data-theme` attribute, the OS setting) and writes it as `theme`
  in `.annotant.json`: the widget turns dark with your app's toggle, at once.
  Without it, the widget picks dark on a dark page.

## Install

From nothing to a first comment on your app, in four steps.

### 1. Check the requirements

- **Claude Code 2.1.287 or later**, for its mods: `claude --version`, and
  `claude update` when it is older. On an older Claude Code,
  `/annotant:annotant` says so and does not start, and `/annotant` does
  not exist.
- **Node.js 22 or later**: `node --version`.
- **A JavaScript web frontend served by a dev server**: a `package.json`
  and Next.js, Vite, CRA, Astro, SvelteKit, Angular or another framework (or
  an `index.html` at its root).

### 2. Install the plugin

Straight from GitHub, no clone needed:

```sh
claude plugin marketplace add annotant/annotant#stable
claude plugin install annotant@annotant
```

Or, inside a session: `/plugin marketplace add annotant/annotant#stable`,
then `/plugin install annotant@annotant`.

### 3. Set it up in your project

Start Claude Code in your frontend project, and run:

```
/annotant:annotant init
```

That is the skill's full name; see [Commands](#commands).

`init` detects the framework, the dev URL, the check commands (type-check,
lint) and the folders agents may edit. It asks, in one round, only what it
could not detect, and whether to git-ignore the comments (recommended: they
hold excerpts of your pages' HTML). Then it writes:

- `.annotant.json`, the project's config;
- a dev-only loader snippet in the app's client entry
  (`instrumentation-client.ts`, `pages/_app`, `index.html`, `src/index`…);
- `.annotant/`, the comments' folder, in `.gitignore` if you agreed;
- a dev-only change to the Content Security Policy, proposed only when it
  finds one in the Next config, the HTML entry or the middleware or proxy
  files.

Last, it builds the app for production and checks the widget is not in it
(or says so when the build fails for another reason), then lists the files it
changed.

When the frontend lives in a folder of the repository, name it after the
command: `/annotant:annotant init web` installs Annotant in `web/`. The
folder is resolved from the current directory, else from the repository root.
On a monorepo root that is not itself an app, `init` asks which of its apps
to use.

### 4. Start commenting

```
/annotant
```

(`/annotant web` for a folder.) Then open your dev app in the browser, its
dev server running as usual: a small strip of icons shows in the bottom right
corner of the page. Click **Comments**, the blue icon at its end, then
**New comment** (hover an icon for its name), write what to change and send it: an agent starts, its progress shows live
under your comment, and it answers in the same thread. [In the widget](#in-the-widget) tells the rest.

No icons? See [the widget does not show](#the-widget-does-not-show).

### Commands

| Command                             | What it does                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `/annotant:annotant init [dir]` | Install in this project, or its folder `dir` (asks only what it cannot detect) |
| `/annotant [dir]`                 | Watch the app: open your dev app and comment                                   |
| `/annotant stop`                  | Stop watching                                                                  |
| `/annotant status`                | The server, the agents at work and the comments waiting                        |
| `/annotant:annotant update`     | Migrate an older install                                                       |
| `/annotant:annotant uninstall`  | Remove Annotant from the project                                             |

Plugin skills are prefixed with the plugin name, hence `/annotant:annotant`;
`/annotant` is a command of the plugin's hooks, and runs at once, even while
Claude is answering. `/annotant:annotant` with no mode watches too, through
the skill.

### While it watches

Work on in the same session: the comments go straight to their agents, never
through your conversation. When an agent ends, its one-line answer shows in
the session's transcript (Claude does not read it), and a question it asks in
the thread shows as a notification too. Closing the session stops the server;
`/annotant` starts it again, and nothing is lost.

In a git worktree, both commands find the project in the main checkout when
the worktree lacks `.annotant.json`.

### Updating

The `stable` branch holds the released versions; `main` is where development
happens and does not work without a build. Get new versions with `claude
plugin marketplace update annotant`, or turn on auto-update for the
marketplace in `/plugin`; the [changelog](CHANGELOG.md) lists what each brings.
After an update, `/annotant:annotant update` migrates a project installed
by an older version.

Each [release](https://github.com/annotant/annotant/releases) carries the
plugin archive and its signed provenance (`annotant-x.y.z.intoto.jsonl`): the
Release workflow built it from a verified commit of `main` and its built
widget. Check it with
`gh attestation verify annotant-x.y.z.tar.gz -R annotant/annotant --signer-workflow annotant/annotant/.github/workflows/release.yml`,
adding `--bundle annotant-x.y.z.intoto.jsonl` to use the attached file
(releases up to 0.3.0 have none).

**Coming from Code Buddy**, Annotant's former name: remove the old plugin and
its marketplace (`claude plugin uninstall code-buddy@code-buddy`, then
`claude plugin marketplace remove code-buddy`), install Annotant as in
[step 2](#2-install-the-plugin), and run `/annotant:annotant update` in each
project: it moves `.code-buddy.json` and `.code-buddy/` to `.annotant.json`
and `.annotant/`, and updates the loader and `.gitignore`.

### Uninstalling

`/annotant:annotant uninstall` removes the loader snippet (and a file
`init` created only for it), `.annotant.json` and the `.gitignore` entry. It
asks before deleting `.annotant/`, which holds your comments. A dev-only
change `init` made to the Content Security Policy stays: revert it by hand.
Remove the plugin itself with `claude plugin uninstall annotant@annotant`,
or from `/plugin`.

## In the widget

While the panel is closed, the tools sit in a small strip of icons in the
bottom right corner, their names and shortcuts in the tooltips; a tool in
progress shows its _Cancel_ after its icon. Drag the strip by its grip, or move it with
the arrow keys once the grip has the focus, wherever it covers nothing; a
double-click on the grip puts it back. Where it is, and whether the panel
floats or is docked, hold for every tab of the app and the next sessions.

- **Comments**, at the strip's end, opens the panel. Its **New comment**
  (`+`) starts a comment for the page, or the whole app; so does the comment
  shortcut.
- **Select text**, then _Comment_, to anchor a comment to that text. A bubble
  then marks the text on the page; clicking it opens the comment's thread.
- **Point at element** starts a comment with that element in its message
  box, as an image would be: the comment is about the page, and the element
  goes with its message. It stays outlined while you write, then a bubble
  marks it until the thread is first resolved. A reply that picks an element
  afterwards moves the mark to it. Hovering an element chip outlines it on the
  page, clicking it scrolls to it (navigating first if it lives on another
  page).
- **Draw area** to frame a part of the page no single element holds: the gap
  between two blocks, a misaligned group, empty space. Drag a rectangle
  (scroll the page while dragging to stretch it past the window); the elements
  it covers are outlined as it grows. A page-level comment can get one too, with _Draw an
  area_. Claude receives its box, the window it was drawn in, the element it
  lies in and the elements it covers or cuts through. The area is found again
  in that element, on another window size or after the layout changes.
- **Draw** freehand over the page when the feedback is easier to draw than to
  write: an arrow from a block to where it should go, a circle around a
  detail, a line along an alignment that is off. Draw with the mouse, a pen or
  a finger; _Undo_ takes the last line back, _Clear_ all of them, _Done_ (or
  Enter) ends the drawing. A page-level comment can get one too, with _Draw on
  the page_. The drawing stays on the page while you write, and is placed
  from what it was drawn over: the largest element wholly in its lines' box,
  else the one they point at, following that element's width. Over a list of
  a fixed width it moves with the list and keeps its size when the page
  narrows; over text that wraps it narrows with the text. With none, it is
  placed as an area is: in the element its lines lie in.
  Claude receives the lines, the elements around them (a margin past their
  box, so what an arrow points at is in) and the one the longest line points
  at (under its end, or the next one along it when it ends in a gap), and a
  picture of the lines over the page, close to what you saw: its colours,
  text and same-origin images where they are, stacked and cut as on screen,
  within the window.
- On the page, blue is what you are pointing at or commenting on; a rainbow,
  around an element or an area, on a drawing's lines or behind a text, marks
  a comment Claude has yet to resolve; once its thread is first resolved, the mark goes away.
- **Paste, drop or choose images** (a screenshot, a mockup) in the message
  box of a comment or a reply, with its image button: they go with the
  message, or alone, and Claude opens them. As many as you like, PNG, JPEG,
  GIF or WebP, 5 MB each and 32 MB together.
- **One target per message**: above the text, _Point at: Element · Area ·
  Drawing_ picks what in the page a new comment or a reply is about, with the
  panel still open ("this one too"). Its card offers _Repick_, _Reframe_ or
  _Redraw_, which replaces it, and ✕; picking another replaces it too. Each
  message in the thread shows its own target, which hovering outlines on the
  page and clicking scrolls to. With no target, _Only on_ says whether a new
  comment is about this page or the whole app.
- **All comments** lists every discussion, filtered by status: the threads
  that need you first, then the others, each newest first, as on the page.
  _Needs you_ keeps the threads where Claude waits on you. While one does, on
  any page, a yellow count on the corner of **Comments** says how many, and
  Comments opens that list (or the thread, when only one waits); the thread's
  bubble on the page shows a **?**.
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
- **Links in the thread**: the URLs a message cites, and its issues (`#12`,
  `owner/repo#12`, `GH-12`, GitLab's `!12`) when your project's `origin`
  remote is on GitHub or GitLab, open in a new tab.
- **Keyboard shortcuts**, ⌘⇧ on macOS and Ctrl+Shift elsewhere, wherever the
  focus is but in a field of your app: `,` comments on the selected text (or
  on the page), `.` points at an element (while you write a comment or a
  reply, picks one for it), `Enter` opens or closes the panel, `↓` and `↑` go
  to the next and previous comment on the page (not from a message box, where
  they select text). While pointing, out of a text box, the arrow keys move
  the outline to the parent, the first child or a sibling, and `Enter` picks
  it. `?` in the panel lists them, named as your keyboard types them in
  Chromium (`;` for `,` on AZERTY).

## Troubleshooting

### The widget does not show

When the dev app shows no strip of icons in its bottom right corner:

- Run `/annotant status`: the server must be running, at the address in
  the loader snippet (`http://127.0.0.1:<port>`); the snippet keeps the port
  `init` wrote, so a new `port` in `.annotant.json` (or
  `ANNOTANT_PORT`) needs it changed too.
- No `/annotant` command at all: the plugin's hooks did not load. Claude
  Code is older than 2.1.287 (`claude update`, then a new session), or mods
  are turned off for this session.
- Reload the page once the watch has started: the loader asks for the widget
  on page load. While the server is not running, the browser's console shows
  one failed request to `widget.js` per page load.
- Open the dev build: the loader is removed from production builds, by
  design.
- A Content Security Policy must allow, in development, `script-src` and
  `connect-src` `http://127.0.0.1:<port>` (and `font-src data:` for the
  widget's fonts). `init` proposes a dev-only change for a policy in the Next
  config, the HTML entry or the middleware; one set elsewhere (a server, a
  proxy) needs it by hand.
- An app opened on a host that is not local (`localhost`, `127.0.0.1`,
  `[::1]`, `*.localhost`) needs its origin in `devOrigins` in
  `.annotant.json`.

### A comment waits, or an agent seems stuck

When a comment seems to wait for nothing, run `/annotant status`. For each
project it watches, it tells the server's state and address (or why it
stopped), the agents at work (their comment, agent, model and for how long),
the comments waiting for a free agent in order, and the server's last error
line. The status line counts the comments waiting too.

When an agent shows no progress under its comment, edits a file another agent
is changing, or seems stuck, turn on the **hook log**. It writes one line for
each decision the plugin's hooks make about the agents working on comments.

In any Claude Code session:

```
/annotant-debug on
```

It is on in every session within 5 seconds, with no restart. Then follow it
from a terminal:

```sh
tail -f ~/.cache/annotant/hook.log
```

or run `/annotant-debug` (no word) to see its last 20 lines. Turn it off
with `/annotant-debug off`; the log stays where it is. Without the command,
`touch ~/.cache/annotant/debug` turns it on and removing that file turns it
off. The log keeps its last 128 to 256 KB.

Each line reads `<time> <agent> <comment> <what happened>`; the agent is
`main` for your own session, and the comment `-` when there is none:

```
… main - hooks loaded in a new session (Claude Code 2.1.287)
… a53927e6… e329bcbb… started on claude-haiku-5-5, the comment classified trivial
… a53927e6… e329bcbb… started for NEW
… a53927e6… e329bcbb… locked api/presets.py
… a53927e6… e329bcbb… recorded edit done "../api/presets.py"
… a53927e6… e329bcbb… run ended (answered or asked): released 1 lock(s)
```

| Line                                                        | What it means                                                                                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks loaded in a new session`                             | The hooks run in that session. **No line at all** after starting a session: they did not load (Annotant needs Claude Code 2.1.287 or later). |
| `locked <file>`                                             | The agent holds that file, named from the repository root, until its run ends.                                                                 |
| `waiting for <file>, held by comment <id>`                  | Another comment's agent is changing it; the agent waits up to 6 seconds.                                                                       |
| `refused <file>: still held by comment <id>`                | The wait ran out: the agent releases its locks, re-reads and retries.                                                                          |
| `no lock for <file>: outside <repository>`                  | Files outside the git repository take no lock.                                                                                                 |
| `refused a Bash write: <command>`                           | The agent tried to write files from Bash, where they cannot be locked; it is told to use Edit or Write.                                        |
| `recorded <step>`                                           | A step shown under the comment, once the agent claimed it, until its run ends or stops.                                                          |
| `run ended …`, `agent stopped …`                            | The agent answered, asked, or stopped: its locks are released.                                                                                 |
| `turn ended: <its last line>`                               | The agent ended its turn: the next comment in line may start.                                                                                  |
| `hook.mjs failed: <error>`                                  | The agent's hook could not run: its tool ran without a lock or a step.                                                                         |
| `started on <model>, …`                                     | The model the comment's agent runs on, its effort when routing set one (`at medium effort`), and how the classifier sorted the comment.        |
| `started for NEW`, `sent the follow-up`                     | `/annotant` started the comment's agent, or passed the reader's reply or edit to the one already started.                                    |
| `the comment still waits: sent the reply again`            | The reader answered as the agent ended its turn, unread: it goes to the agent again. |
| `turn ended with the comment working: …` | The agent ended its turn neither answering nor asking: the comment stops, and the reader sends it again from its thread. |
| `could not start an agent: <why>`                           | Claude Code refused the agent (background tasks turned off, say); a notification says so too.                                                  |
| `runs as a teammate: Claude Code dropped its hooks …`       | Agent teams are on: the agent has no file locks and records no steps. See [Known issues](#known-issues).                                        |
| `stopped: the reader ended the comment`                     | The reader stopped, resolved or deleted the comment while its agent worked.                                                                    |

## Known issues

### Agent teams drop the agents' hooks

With Claude Code's [agent teams](https://code.claude.com/docs/en/agent-teams)
on (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` at `1` in your settings' `env`),
each comment's agent starts as a teammate, and Claude Code keeps only a few
fields of its agent type: not its hooks. The agent still makes the change,
but with no file locks, so two agents may edit the same file at once, and
no tool steps under the comment. A notification says so, once a session.
Until Claude Code applies a teammate's hooks, turn agent teams off where you
turned them on, `~/.claude/settings.json` say; the setting is read again for
each agent, with no restart:

```json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "0" } }
```

## Security

- The server listens on `127.0.0.1` only and accepts cross-origin requests
  from `localhost` origins only (and `devOrigins`); it refuses any change
  from another origin (403).
- The loader is guarded by the bundler's compile-time dev flag
  (`process.env.NODE_ENV` or `import.meta.env.DEV`), so it is removed from
  production builds; `scripts/verify-prod.mjs` checks the build output.
- Comments hold page text and HTML excerpts; they stay in your project folder,
  with the images attached to them (`.annotant/images/`), which the server
  checks are images by their bytes.

To report a vulnerability, see the [security policy](SECURITY.md).

## Development

The repository holds a playground, a small fake app to try Annotant on.
Claude Code started in your clone loads the plugin from it, instead of the
installed copy; launch the playground there:

```sh
npm ci
claude
```

```
/playground        a fresh copy of the playground, with Annotant, in your browser
/playground keep   the same, keeping the changes agents made last time
```

See [Trying your changes](CONTRIBUTING.md#trying-your-changes) in
CONTRIBUTING.md, which also covers trying them in an app of your own.

What to do after a change:

| You changed                           | To see it                                              |
| ------------------------------------- | ------------------------------------------------------ |
| `SKILL.md`, `agents/*`, `hooks/*`     | `/reload-plugins` in the session, or a new session     |
| `scripts/*.mjs` except the server     | Nothing: each call runs the script again               |
| `scripts/server.mjs`, `scripts/lib/*` | Restart the server: `/annotant stop`, then `/annotant` |
| `widget/src/*`                        | Rebuild, reload the page: `npm run watch` does both     |

The server reads `dist/widget.js` on every page load, so a rebuild and a page
reload are enough for the widget. From the repository root:

```sh
npm ci          # once; install scripts are disabled
npm run build   # type-checks, then rebuilds dist/widget.js
npm run watch   # a dev build on every change; the page reloads
npm run check   # everything CI checks: format, lint, types, build, tests
```

`dist/` (`widget.js` and `THIRD_PARTY_LICENSES.txt`, the licenses of the
packages it bundles) is never committed on `main`: the Release workflow builds
it and publishes it on the `stable` branch. See [CONTRIBUTING.md](CONTRIBUTING.md)
for the rest of the rules.

Paths below are relative to `skills/annotant/`.

| Path                                                   | What                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `SKILL.md`                                             | The skill: watch, init, update, uninstall                  |
| `scripts/server.mjs`                                   | Local server: widget, API, a line per comment event for the hooks |
| `scripts/claim.mjs`, `resolve.mjs`, `ask.mjs`          | Used by the agents                                         |
| `scripts/detect.mjs`, `verify-prod.mjs`, `migrate.mjs` | Used by `init` / `update`                                  |
| `widget/src`                                           | The widget (React, TypeScript)                             |

At the repository root, `agents/worker.md` is the agent that handles a
comment (`annotant:worker`): its steps and rules. `hooks/register.ts` is
the plugin's hooks module (a Claude Code mod, declared in `hooks/hooks.json`):
the watch (`/annotant`, the server, one agent per comment, each registered
with `scripts/hook.mjs` around its tools for file locks and live progress).
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

Annotant is an independent open source project. It is not affiliated with,
endorsed by or supported by Anthropic. Claude and Claude Code are trademarks
of Anthropic, PBC.
