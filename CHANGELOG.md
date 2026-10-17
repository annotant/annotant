# Changelog

Notable changes to Code Buddy. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org). Users receive a change when it is
released to the `stable` branch.

## Unreleased

### Changed

- **Breaking: comments no longer wait on a managing session.** `/code-buddy`
  is now a command of the plugin's hooks: it starts the server for the
  session's life, and every comment starts its agent at once, in the
  background, with no model turn, even while Claude answers something else in
  the same session. No session needs keeping for Code Buddy any more.
  Follow-ups and edits go to the comment's agent, a stopped comment stops it,
  three run at a time; an agent's one-line answer shows in the transcript, its
  question as a notification too. `/code-buddy stop` ends the watch;
  `/code-buddy:code-buddy` without a mode starts it through the skill, whose
  dispatch instructions are gone. A busy comment now reads "waiting for a
  free agent". (#103)
- **A comment's agent reads only its comment.** `claim.mjs` prints the
  comment's thread as JSON, capped to the reader's comment and the 19 latest
  messages, and the agent is told never to open the comments file, with every
  other thread in it: fewer tokens, and no feedback that is not its own. (#123)
- **The reader's words and the page's text reach agents fenced as data.**
  The thread `claim.mjs` prints and the server line in an agent's prompt, its
  follow-ups and edits sit behind a header naming a marker made for them, on
  each line: text the app renders, or a comment, cannot pass for instructions
  to the agent, nor widen its task beyond `editable`. (#124)
- **Changes show in the widget at once.** The server watches the comments
  file's and the step files' folders, and pushes each change to the widget on
  `GET /api/events` (server-sent events): a new step, state or answer shows in
  well under a second, and the widget sends no request while nothing changes,
  instead of asking every 3 seconds. A slow re-read stays behind both, for a
  dropped stream or a mount whose writes the watches miss.
- **A new comment's agent starts sooner.** Its steps and rules now ship as a
  plugin agent, `code-buddy:worker` (`agents/worker.md`), which reads
  `.code-buddy.json` itself: the managing session passes it the comment id,
  the server line and two paths instead of writing a ~2,500-character prompt
  for every new agent.
- **A new comments file format (version 2).** `.code-buddy/comments.json` is
  now `{ "version": 2, "comments": [...] }`: each comment has an explicit
  `state` (`open`, `working`, `asking`, `answered`, `stopped`, `resolved`) and an `events`
  log of every move, never overwritten; `messages` holds the whole thread, the
  reader's comment first, each message with an `id`, and each of Claude's with
  the `run` (`r1`, `r2`…) that wrote it, as the agent's steps are; the anchor
  is grouped under `anchor`. A move outside the state graph is refused, and the
  widget shows why. Nothing is converted: **delete an existing
  `.code-buddy/comments.json`** before updating; the server refuses the old
  format (`COMMENTS_REFUSED`) and says so.
- The debug panel's timeline shows every move of a comment (a thread that
  asked twice shows two `asking`), and a run's id shows that run alone.
- **Only the reader closes a thread they followed up on.** Claude's first
  answer resolves a comment; once resolved, its answers to later follow-ups
  leave it `answered` (the server prints `ANSWERED`), and the reader follows
  up again or resolves it.
- **The page stops marking a comment once it is first resolved**: a
  follow-up, often about something else, no longer brings back its outline
  or its rainbow.

- **The page shows where each comment stands.** Blue while the reader picks
  an element or text, and while the comment on it is written (the picked
  element stays outlined); a rainbow while its thread is open, turning around
  an element, flowing behind a text; nothing once it is resolved. The red
  outline and orange highlight of the active comment are gone. The number on
  an element is now a bubble, as on a text, and opens its thread; a text's
  bubble sits closer to it.
- **Code Buddy now needs Claude Code 2.1.287 or later.** Its hooks are a
  Claude Code mod, loaded once per session: they start no process per tool
  call, where the shell hooks started Node twice for each tool call of an
  agent working on a comment. On an older Claude Code, `/code-buddy:code-buddy`
  says so and does not start (the server prints `HOOKS_MISSING`).
- The file locks live in the session, as the agents do: `lock.mjs` is gone.
  An agent waits up to 6 seconds for a file another comment's agent holds,
  then releases its locks and retries, as before.

### Added

- **What the agent understood, first.** With `"understood": true` in
  `.code-buddy.json` (off by default), a comment's agent says in one line what
  it will change and where before it edits anything, and the widget shows it
  above its steps as "Understood: …": edit the comment to correct a misread
  one at once. (#128)
- **Images in a comment.** Paste an image (Cmd/Ctrl+V) or drop one in the
  message box, of a new comment or a reply: it shows as a thumbnail, goes
  with the message and shows in its bubble; an image alone is a message too.
  Up to 4 per message, PNG, JPEG, GIF or WebP, 5 MB each: a request may now
  hold them on top of its 100,000 characters of text. The server keeps them
  beside the comments file (`.code-buddy/images/<id>/`), deleted with the
  comment, and the comment's agent opens them with Read.
- **Each comment gets a model that fits it.** Before a comment's agent
  starts, the hooks ask Claude Code's small fast model to sort the comment:
  `trivial` (copy, spacing, colour, one element), `standard` (a component's
  behaviour, a new element, a small feature) or `hard` (several components or
  pages, data or API changes, a product decision). `models` in
  `.code-buddy.json` maps each label to a model, by default
  `{ "trivial": "haiku", "standard": "inherit", "hard": "opus" }`; `inherit`
  keeps the managing session's model, and `{ "trivial": "inherit" }` turns
  routing off. A failed classifier never holds a comment back: its agent
  starts on the session's model. A comment of images alone, which the
  classifier cannot read, starts on the session's model at a medium effort,
  unlabelled, routing on or off. A follow-up keeps the thread's model.
- **The widget names the model.** A thread and its line in the list show the
  model its agent works on and the classifier's label ("haiku · trivial"),
  and its Started step says "Started on haiku". The comments file records
  them on the run's `working` event (`model`, `complexity`).
- **The widget says when Claude is busy.** A comment the managing session has
  had for 15 seconds without an agent claiming it now reads "Claude has your
  comment but is busy…" instead of "Waiting for Claude…": that session only
  hears of a comment between two of its turns. `/code-buddy:code-buddy` now
  tells you to keep its session for Code Buddy and work in another one.
- **The widget says where a new comment stands.** "Waiting for Claude…" is
  gone: a comment reads "Sent…" until the server hands it over to the managing
  session, "Claude has your comment, an agent is starting…" once it has, and
  "No agent has started. Is the /code-buddy session busy?" when no agent has
  claimed it a minute later. The reader's reply in the thread (an answer or
  a follow-up) says "Claude has your reply, an agent is picking it up…"
  instead: the manager hands it to the thread's agent when it still has one.
  The debug panel marks each hand-over and how long the claim took after it.
- **Draw an area on the page** (_Draw area_, or _Draw an area_ in a page-level
  comment) when the feedback is about a part of the page no single element
  holds. The page dims around the rectangle, the elements it covers are
  outlined as it grows, and scrolling the page stretches it. It stays outlined
  while the comment is written, turns into a rainbow frame with a bubble until
  Claude resolves the thread, and its chip in the thread shows it again (hover)
  or scrolls to it (click). Claude gets its box, the window size and scroll,
  the element it lies in, the elements it covers and those it cuts through,
  down to the innermost (the two buttons around a gap); the area is kept relative to that
  element, so it is found again on another window size.
- **The hook log**, to check what the plugin's hooks do in a real session:
  `/code-buddy-debug on` turns it on in every session, `tail -f
  ~/.cache/code-buddy/hook.log` follows it, `/code-buddy-debug` shows its last
  lines. See [Troubleshooting](README.md#troubleshooting).
- **A debug panel in the widget**, for contributors: in the dev build that
  `/playground` uses (`npm run build:dev`), the wrench in the panel's header or
  Alt+Shift+D shows each comment as the widget holds it, its conversation in
  order, every tool call of every run, and its raw JSON, live. The released
  widget does not contain it, and keeps no steps once a run ends.
- The debug panel shows what each agent was told: the lines the server
  printed for the managing session, and on each agent's first run its
  instructions and its first message, exactly as it was sent.

- Claude can ask the reader a question in the thread (`ask.mjs`) instead of
  guessing; the comment waits on the reader's answer.
- A question can offer choices (`ask.mjs --option "<label>: <description>"`,
  `--multiple` to allow several): the thread shows one button per option, the
  reader can still answer in their own words, and the thread keeps what they
  chose. An agent working on a comment that calls `AskUserQuestion`, which
  only reaches the manager's terminal, is told to ask in the thread instead.

- A bubble above the start of each open comment's text, where its *Comment*
  button was: clicking it opens the comment's thread. While a comment on a
  text is being written, the text stays highlighted on the page.

- The widget shows what the agent is doing now ("Reading `App.tsx`…",
  "Thinking…") and a fuller trail: tools as they start, end or fail, the
  agent's messages, and its thinking (a summary when Claude Code provides one).

### Fixed

- A comment kept the page's secrets: its url held the query and the hash,
  where a sign-in leaves its token (`#access_token=…`, `?token=…`), and its
  element's html a hidden field's value (a CSRF token). The url now has no
  hash or credentials and its secret-looking parameters are redacted, in its
  query or its path; the
  html loses its `value`, `content` and secret-looking attributes, and its
  links (`srcset` and `data-*` ones too) their secret-looking parameters. (#76)
- An item of an open dropdown could not be picked: pressing "Point at
  element" reached the page, and a menu closing on a press outside it (Radix,
  MUI) closed first. Presses on the widget now stay in it, and its buttons
  leave the focus where it is. (#97)
- A comment on an element with a generated id (React's `useId`, MUI, Ember,
  Headless UI, Vue, Angular Material…), or inside one, lost its element after
  a reload: its selector named the id, which the next load changes. Such ids
  are now skipped, and the selector climbs to a written id or the element's
  position.
- Opening, closing or resizing the panel wiped the host page's own inline
  styles: the `body` padding a MUI or Bootstrap modal sets for its hidden
  scrollbar, which left the page shifted after the modal closed, and the
  page's cursor and `user-select`. The docked panel now squeezes the page
  through `html`'s padding, and the widget puts back every inline value it
  changes. (#65)
- The hook log lost lines when several processes wrote it at once (other
  sessions, the agents' own hooks): each line rewrote the whole log, dropping
  what was appended in between. Each line is now appended.
- An open conversation did not scroll when a message arrived: Claude's
  answer, its steps or the reader's own message landed below the fold. Read
  to its end, the conversation now follows what arrives; scrolled up, it keeps
  its place and its button to the latest message; a message the reader sends
  always brings it to the end.
- A comment started on one page and saved after following an in-app link was
  filed on the new page, with a quote or an element from the first: the agent
  went to the wrong page and its mark showed nowhere. A comment is now filed
  on the page it was started on, and its quote and element are marked only
  there.
- A commented text or element scrolled out of a scrolling box (an
  `overflow: auto` sidebar, a list) kept its rainbow or frame and its bubble,
  drawn outside the box over the rest of the page. A mark now shows only where
  its text or element does, cut at the box's edges; its bubble sits on the
  part that shows.
- While pointing at an element, a press on it also reached the page: a menu
  that opens on `pointerdown` opened, a popover's click-outside handler closed
  it, a drag handle started dragging, an input took the focus. The page now
  gets no `pointerdown`, `mousedown`, `pointerup`, `mouseup` or `click` on the
  element being picked; the click only picks.
- Pointing at one of several elements that share a `data-testid` or an `id`
  (the items of a list) anchored the comment to the first of them: its
  outline, *center on element* and the agent's selector. The selector now
  stops at a test id or id only when it names the element alone, and climbs
  on by position otherwise; a test id holding a quote is escaped. A comment
  saved before this fix finds the element with its saved text, or none rather
  than a wrong one.
- A comment whose `url` was not a full URL (a hand-edited comments file, or
  another client) made the widget vanish as soon as the panel drew it, and it
  stayed gone in that tab until the comment was deleted. The widget now shows
  that comment's route; a comment it cannot draw says so, with its delete
  button, next to the others; and the server keeps only `http` and `https`
  URLs.
- A text selection across several elements (two paragraphs, list items, table
  cells) could not be commented on, and neither could text styled by CSS
  (`text-transform`) or around hidden text, a `<select>` or a `<textarea>`:
  no *Comment* button showed. The widget now quotes the page's own text. The
  *Comment* button sits above the start of the selection, not at the left of
  its whole box.
- A reader's message with a line break split the server's event line, and
  the manager read a truncated follow-up. The texts on an event line are now
  JSON strings, their line breaks escaped.
- After refusing a request body too large, the server kept the connection
  open with the rest of the body unread: the next request on it hung. It now
  closes it.
- A long current step under a comment was cut off mid-word instead of ending
  with an ellipsis, and its working dots were hidden; it now ends with one
  ellipsis, and the dots show whenever the step fits.
- An agent that claimed its comment with a relative `--project` (`--project .`
  after a `cd`) worked with no locks and no progress: the hooks now bind it to
  the project `claim.mjs` found, which it prints.
- Files outside the project (an `editable` folder such as `../api`) were
  never locked: the locks now cover the whole git repository the project is
  in, and the widget shows those files as `../api/…`.
- An agent could write files from Bash (`sed -i`, an inline Python or Node
  script, `cat >`, `tee`), where no lock covers them: agents edited the same
  file at once. The hooks now refuse those commands to an agent working on a
  comment and ask for Edit or Write, and the agent's prompt says so. A
  command whose files are all visibly outside the repository (a scratch file
  in `/tmp`) still runs.
- The file locks and the progress never worked in the agents: the hooks were
  declared in the skill, and a skill's hooks do not fire in subagents. The
  plugin now declares them, and they skip Node unless an agent works on a
  comment.
- A build that failed kept its build lock until the agent stopped.
- An agent still working after the reader stopped it recorded steps that then
  showed under the next run.
- Tools called in parallel recorded the agent's thinking and messages twice.
- A claim or an answer chained with a command that failed was ignored: the
  agent worked without file locks, or kept its locks after answering.
- A binding left by a killed agent made every Claude Code session start Node
  for each tool call; bindings silent for two hours are now ignored and pruned.
- Two processes could break the same abandoned lock on the comments file and
  both write it, losing one change.
- Claude's answers no longer carry the run's steps in `comments.json`.

### Security

- **The server refuses changes from other origins.** A request that would
  change comments (`POST`, `PATCH`, `DELETE`) from a page whose origin the
  server does not let in gets 403: a page of another site could otherwise
  write comments and images, and start agents, without reading the answer.
  Requests with no origin (scripts, curl) still pass.

## 0.1.0 - 2026-09-29

First release.

### Added

- Install as a Claude Code plugin, straight from GitHub:
  `claude plugin marketplace add neolitec/code-buddy#stable`. The `stable`
  branch holds the released versions, with the built widget; `main` is where
  development happens.
- `/code-buddy:code-buddy [dir]` and `init [dir]` target a folder of the
  repository, such as `web`.
- A mascot drifts at the bottom of the panel, in its own strip so it never
  covers the comments. It keeps still under `prefers-reduced-motion`, and is
  hidden when the window is under 560 px tall.
- The panel's bottom-right corner shows the plugin's version and links to the
  project on GitHub.
- MIT license, contribution guide, code of conduct and security policy.

### Changed

- The widget's blues come from the mascot's body, keeping readable contrast.

### Fixed

- Hooks failed with `MODULE_NOT_FOUND` when Code Buddy ran as a plugin.
- The floating panel squeezed the page; it now floats over it, and only the
  docked panel makes room.
- Leaving a new comment or a thread on a page without comments showed an
  empty panel; it now returns to the open comments.
- The server sent the text of its exceptions to the browser; it now answers
  with fixed messages (400 invalid JSON, 413 body too large, 500 internal
  error) and logs the details.
- The widget's API client dropped request headers passed as a `Headers` object
  or an array.
- The widget bundled React without its license notice: the notices now stay in
  `widget.js`, and `dist/THIRD_PARTY_LICENSES.txt` carries the full license of
  every bundled package.
