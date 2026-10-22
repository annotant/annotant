# Chrome extension spike (#101): not to merge

A Manifest V3 extension that mounts the widget, bundled in the extension, in a
content script's isolated world, on the `localhost` pages a running Code Buddy
server watches. Nothing enters the project: no loader snippet, no CSP change.

- `background.js`: asks `127.0.0.1:4590–4649/api/health` which server
  watches the page's origin (the server now lists its `origins`).
- `content.js`: sets `codeBuddyServer` and imports `dist/widget.js`; the widget
  takes its server from it (`widget/src/server.ts`) instead of `import.meta.url`.

Try it: `npm run build --workspace skills/code-buddy/widget -- --outdir ../../../spike/chrome-extension/dist`,
then `chrome://extensions` → Developer mode → Load unpacked → this folder, and
run `/playground` with the playground's loader snippet removed.

See the study in issue #101 for what it showed.
