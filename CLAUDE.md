# Annotant

A Claude Code plugin: the user comments on their running dev app in the
browser, and one background agent per comment makes the change. See the
[README](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Layout

- `.claude-plugin/`: plugin and marketplace manifests.
- `hooks/register.ts`: the plugin's hooks, a Claude Code mod (2.1.287 or
  later) declared in `hooks/hooks.json`, for the watch: `/annotant` (or the
  skill, through `mcp__annotant__watch`) runs the server and starts one
  agent per comment, with no model turn. Claude Code runs none of a mod's
  hooks for an agent the plugin starts: each comment's agent is registered
  as a type of its own (`annotant:an-<id>`) whose settings hooks run
  `skills/annotant/scripts/hook.mjs` (file locks, steps) around its tools.
  Their `$.state` values are typed in `types/index.d.ts`.
- `agents/worker.md`: the instructions of each comment's agent, which the
  hooks start with only the comment, `SKILL` and `PROJECT`; it reads
  `.annotant.json` itself. Hidden from the model.
- `skills/annotant/SKILL.md`: the skill itself, a prompt. Keep it short:
  every line is read in every user's session.
- `skills/annotant/scripts/`: Node.js ES modules with JSDoc types, no
  dependencies.
- `skills/annotant/widget/src/`: the widget (React, TypeScript), bundled into
  `widget/dist/`, which is git-ignored: the Release workflow publishes it on
  the `stable` branch users install from.
- `docs/comments-file.md`: the comments file and the step files, their
  schemas and the comments' states; `scripts/lib/format.mjs` is its code.
- `site/`: the website on GitHub Pages (Jekyll), its landing page and
  layouts; `.github/scripts/site.mjs` builds its docs pages from the Markdown
  files its `PAGES` lists (no copy), and `.github/workflows/pages.yml` publishes it.
  `npm run site` (`.github/scripts/site-preview.mjs`) previews it.
- `playground/`: a fake app with Annotant installed, to try changes on.
  `/playground` (`.claude/skills/playground/`) runs it from `.playground/`, a
  git-ignored copy the agents edit.
- `demo/`: a made-up app, built to film the video on the website
  (`site/assets/demo.*`); `/playground demo` runs it from `.demo/`.
  `demo/README.md` tells how to shoot the video again.

## Commands

- `npm ci`: install (install scripts are disabled).
- `npm run check`: format check, lint, unused code (knip, `knip.json`),
  type-check, build and tests; must pass.
- `npm test`: the `node:test` suites in `test/` (they need the widget built),
  then the widget's Vitest suites in `widget/test/` (`npx vitest` there to
  watch).
- `npm run test:hooks`: validate the plugin and run `test/hooks.test.ts` in
  Claude Code (2.1.287 or later; not in CI, run it when `hooks/` changes).
- `npm run format`: apply Prettier.
- `npm run build`: rebuild `widget/dist/` (the bundle and its third-party
  licenses). `npm run build:dev`: the same with the debug panel (Alt+Shift+D),
  behind `ANNOTANT_DEBUG`, which `/playground` builds. `npm run watch`: the
  dev build on every change, with `tsc --watch`; the server reloads the page
  (`/playground` runs it).
- `npm run site`: preview the website on http://localhost:4000 (Docker, or a
  local `jekyll`), rebuilt and reloaded on every change.
- `/playground`: try Annotant on the playground. A session started here
  loads the plugin from the clone (`.claude/skills/annotant` links to the
  root; `.claude/settings.json` disables the installed one): no `--plugin-dir`.

## Rules

- Never commit `widget/dist/`. Build it (`npm run build`) only to try a widget
  change locally.
- Fix a bug with a test that fails without the fix.
- Type the scripts with JSDoc instead of silencing the checker. Disable a lint
  rule only for one line, with `-- <reason>`.
- No new dependency, runtime or dev, without an issue approving it.
- Pull request titles follow `<type>: <summary>` (`feature`, `fix`, `docs`,
  `chore`, `refactor`, `perf`, `test`, `ci`); they become the squashed commit.
