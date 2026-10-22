# Contributing to Annotant

Thanks for helping! This guide covers everything a pull request needs to be
merged. By taking part, you agree to follow the [code of conduct](CODE_OF_CONDUCT.md).

**Found a vulnerability?** Do not open an issue: follow the
[security policy](SECURITY.md).

## Before you start

- **Bugs**: open an issue with the bug report form first, unless the fix is
  obvious and small.
- **Features and larger changes**: open an issue with the feature request form
  and wait for a maintainer's go-ahead before writing code. Annotant stays
  small on purpose, and a change that has not been discussed may be declined
  however well it is written.
- One pull request does one thing. Refactors, formatting and dependency bumps
  go in their own pull requests.

## Set up

You need [Node.js](https://nodejs.org) 22.12 or later, except 25, which
Vitest does not support and `npm ci` refuses (CI uses the version in
[`.nvmrc`](.nvmrc)); npm; and [Claude Code](https://claude.com/claude-code).

```sh
git clone https://github.com/<you>/annotant
cd annotant
npm ci
```

`npm ci` never runs install scripts: [`.npmrc`](.npmrc) sets
`ignore-scripts=true`. Keep it that way.

## Trying your changes

`playground/` is a small fake app (a coffee roaster's shop: routes, a table, a
form, a dialog, text split across elements) with Annotant installed in it as
`init` would install it. Start Claude Code in your clone and launch it:

```sh
claude
```

```
/playground
```

In this repository, Claude Code loads Annotant from your clone, with no
flag: `.claude/skills/annotant` is a link to the repository root, which
Claude Code loads as a plugin (`annotant@skills-dir` in `claude plugin
list`), and `.claude/settings.json` disables the copy installed from the
marketplace, in this project only. It loads once you trust the folder, on the
first start. Do not add `--plugin-dir .`: the plugin would load twice. On
Windows, git creates the link only with `core.symlinks` enabled (Developer
Mode, then `git config core.symlinks true` before cloning).

Edits are read from your clone: after a change to `skills/annotant/SKILL.md`,
`agents/` or `hooks/`, run `/reload-plugins` before the next `/playground`.

It builds the widget (a dev build, see below) when `widget/dist/` is missing,
a release build or older than `widget/src/`, copies `playground/` to
`.playground/` (git-ignored), starts the app there on <http://localhost:5190>,
starts `npm run watch`, runs `/annotant:annotant .playground` and opens
the app in your browser. `npm run watch` rebuilds the dev widget on every
change to `widget/src/`, and the server tells the page to reload; a build that
fails keeps the last good bundle and prints the error, and `tsc --watch` next
to it prints the type errors without holding the reload back. Comment on it:
the agents edit `.playground/`, so `git status` stays clean. `/playground` starts again from
a fresh copy, comments included; `/playground keep` keeps the copy and the
changes made to it. To change the playground itself (a page for a new
feature), edit `playground/` and commit it like the rest. `npm run playground`
serves the committed app alone, without Annotant.

The dev build (`npm run build:dev`) adds a **debug panel** to the widget: the
wrench in the panel's header, or Alt+Shift+D, shows every comment as the widget
holds it, its fields, its conversation in order (messages, every move of the
comment, and every tool call of every run with its id; a run's id shows that
run alone) and its raw JSON, live. With that build, a run's steps are not dropped when it ends: they go to
`<id>.history.jsonl`, next to the run's progress file, until the comment is
deleted, and the server serves them with `history=1`; a link in the panel opens them as they are on disk. `comments.json` never
holds them. A click on a tool call's id unfolds what the agent sent and got
back: the server reads it in Claude Code's transcripts of the last 7 days
(`~/.claude/projects/`), with a dev widget only. The timeline also shows the
lines the server printed for the hooks, and on each agent's first run a
Context link that opens, in a dialog, what it was given: its instructions
(`agents/worker.md`, as on disk now: Claude Code does not keep them) and its
first message exactly as it was sent, read in its transcript. `npm run build` leaves the panel out: the released `widget.js`
has none of its code (`test/bundle.test.mjs` checks it).

To try a change in an app of your own instead, start Claude Code in it with
`claude --plugin-dir ~/dev/annotant`, after `claude plugin disable
annotant@annotant` if the plugin is also installed, and run the skill as
usual.

What to do after a change, in a running session, is in the README's
[Development](README.md#development) section.

## Layout

| Path                                  | What                                                                |
| ------------------------------------- | ------------------------------------------------------------------- |
| `.claude-plugin/`                     | Plugin and marketplace manifests                                    |
| `hooks/register.ts`                   | The plugin's hooks, a Claude Code mod: `/annotant` and the dispatch; each comment's agent gets `scripts/hook.mjs` (file locks, progress) as its own hooks |
| `types/index.d.ts`                    | The values the hooks keep for the session (`$.state`)               |
| `agents/worker.md`                    | The agent that handles one comment (`annotant:worker`): its steps and rules |
| `skills/annotant/SKILL.md`          | The skill Claude reads: its modes; the watch is the hooks'          |
| `skills/annotant/scripts/`          | Node.js scripts (ES modules, JSDoc types), run by the skill         |
| `skills/annotant/scripts/lib/format.mjs` | The comments file's format: its version, states, moves and types; the reference for every part that reads it |
| `docs/comments-file.md` | The comments file and the step files: where they live, their schemas, the states diagram |
| `site/`                               | The website's landing page and layouts; `.github/scripts/site.mjs` adds the docs pages from the Markdown files its `PAGES` lists (`README.md`, `docs/`); the Pages workflow builds it on pull requests and publishes it from `main` |
| `skills/annotant/widget/src/`       | The browser widget (React, TypeScript)                              |
| `skills/annotant/widget/dist/`      | The built widget: `npm run build`; never committed on `main`        |
| `playground/`                         | A fake app to try Annotant on, launched by `/playground`          |
| `.claude/skills/playground/`          | The `/playground` skill of this repository                          |
| `.claude/skills/annotant`           | A link to the root: Claude Code loads the plugin from the clone     |

## Checks

Run them all before you push; CI runs the same ones and a pull request cannot
be merged while one fails.

```sh
npm run check
```

It runs, in order:

| Script                 | Tool                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| `npm run format:check` | [Prettier](https://prettier.io); `npm run format` fixes it           |
| `npm run lint`         | [Oxlint](https://oxc.rs/docs/guide/usage/linter), type-aware         |
| `npm run lint:unused`  | [knip](https://knip.dev): unused files, exports, types and dependencies, across the scripts, the hooks, the tests, the widget and the playground |
| `npm run typecheck`    | [TypeScript](https://www.typescriptlang.org) 7, strict, on the widget and the scripts |
| `npm run build`        | Type-checks and bundles the widget into `widget/dist/widget.js`, with the licenses of the packages it bundles in `THIRD_PARTY_LICENSES.txt` |
| `npm run build:dev`    | The same, with the debug panel: the build `/playground` uses          |
| `npm test`             | [`node:test`](https://nodejs.org/api/test.html) suites in `test/`: file locks, store, server, widget wording, playground; then the widget's component tests in `widget/test/`: [Vitest](https://vitest.dev) with [happy-dom](https://github.com/capricorn86/happy-dom) and [Testing Library](https://testing-library.com/docs/react-testing-library/intro) |

`npm run test:hooks` checks the hooks module with Claude Code itself
(`claude plugin validate`, then `claude plugin test`, which runs every
`*.test.ts` and `*.test.tsx` in the plugin: `test/hooks.test.ts` only, since the
widget's Vitest suites are named `*.spec.tsx`).
It needs Claude Code 2.1.287 or later, which CI does not install: run it
whenever you change `hooks/` or `types/`. In a real session, `/annotant-debug on`
logs every decision the hooks make (README, Troubleshooting); log a new
decision with `debug(...)` when you add one. To type-check the module, load the
plugin once (`claude --plugin-dir .`): Claude Code writes its API types to
`.claude-plugin/types/` and a `tsconfig.json` that reads them (both
git-ignored), and `npx tsc -p .` then checks `hooks/` and `types/`.

Rules that go with them:

- **The built widget is not committed.** `widget/dist/` is git-ignored on
  `main`: build it locally to try your changes, and let the Release workflow
  publish it on the `stable` branch.
- **Behavior changes come with tests.** A bug fix starts with a test that
  fails without it. The `node:test` suites run the scripts as Claude Code
  does (a real server on a free port) in throwaway folders; they need no
  network and no Claude Code. The widget's component tests render it against
  a stubbed `fetch` and drive it as a reader would. The hooks' tests run
  inside Claude Code, with the disk and the tools beneath them in memory.
- **Scripts are plain JavaScript with JSDoc types**, type-checked by TypeScript.
  Add types where the checker needs them rather than silencing it.
- **Lint exceptions are rare and explained.** Disable a rule for one line only,
  with the reason:
  `// oxlint-disable-next-line <rule> -- <why this line is right>`. Unused
  directives fail the lint.
- **Nothing unused stays.** knip fails on a file nothing reaches, an export
  nothing imports, or a dependency nothing uses: delete it, or drop the
  `export` when only its own file uses it. A new entry point (a script the
  skill runs, a file a tool loads) goes in `knip.json`'s `entry`. An
  intentional exception goes in `knip.json` too (`ignoreDependencies`,
  `ignoreBinaries`…), with a comment saying why.
- **`SKILL.md` is a prompt.** Every sentence costs tokens in every user's
  session and changes how Claude behaves: keep it short and precise, and test
  the modes you touch in a real session.

## Dependencies

Annotant has no runtime dependencies: the scripts use Node.js only, and the
widget bundles React. Adding one is a design decision; ask in an issue first.

- Versions are pinned exactly (`save-exact=true`); the lockfile is committed.
- Dependabot proposes updates weekly, a week after their release, grouped.
  Minor and patch updates merge on their own once every required check passes;
  majors wait for a maintainer, who reads their changelogs first.
- CI rejects dependencies with known vulnerabilities or non-permissive licenses.

## Pull requests

- Branch from `main` and name the branch after its intent: `feature/…`,
  `fix/…`, `docs/…`, `chore/…`, `refactor/…`, `test/…`, `ci/…`.
- **The pull request title is the commit message**: pull requests are squashed
  on merge. It must follow
  `<type>: <summary>`, with `type` one of `feature`, `fix`, `docs`, `chore`,
  `refactor`, `perf`, `test`, `ci`, and a lowercase summary in the imperative
  (`fix: keep the panel above modal dialogs`). CI checks it.
- Fill in the pull request template: what changes, why, and how you tested it.
- Keep your branch up to date with `main`. The maintainer reviews every pull
  request and is the one who merges it.
- Signed commits are welcome but not required: the squashed commit that lands
  on `main` is signed by GitHub.

## Releases

Maintainers release; contributors only add their change under `## Unreleased`
in [`CHANGELOG.md`](CHANGELOG.md).

Users install from the `stable` branch, which only the Release workflow
updates: merging to `main` ships nothing. To release:

1. Open a `chore: release x.y.z` pull request that sets `version`
   ([semver](https://semver.org): patch for fixes, minor for features, major
   for breaking changes to commands or `.annotant.json`) and moves the
   `Unreleased` entries under a `## x.y.z - YYYY-MM-DD` heading.
2. Once it is merged, run **Actions → Release → Run workflow** on `main`, with
   the version. Nothing is tagged or published otherwise: merging to `main`
   never releases.
3. The **Verify** job re-runs every CI check on that commit and builds the
   widget, then checks what a
   release needs: the version matches `plugin.json` and is greater than the
   last release, its tag is new, its changelog section is dated and filled
   with `Unreleased` empty, no dependency has a known vulnerability, and no
   CodeQL or zizmor alert is open (Scorecard's alerts rate the project's
   practices and do not block).
4. The **Publish to stable** job waits for a maintainer's approval in the
   `release` environment. It then commits the verified tree with its built
   widget on `stable` (its parents: the previous release and the verified
   commit on `main`), tags that commit `vx.y.z`, and publishes the GitHub
   release: the changelog section as notes, and the plugin archive with a
   signed provenance attestation. Releases are immutable: once
   published, neither the tag nor the files can change.

## Using Claude Code on this repository

Contributions made with Claude Code are welcome. [`CLAUDE.md`](CLAUDE.md) gives
it the project's rules. You remain responsible for every line you submit:
review it as if you had written it.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE), like the rest of the project.
