# The demo app

Mossbloom, a made-up plant care app: one landing page, built only to be filmed
for the video on the website's landing page (`site/assets/demo.webm`). No real
brand, person or data.

It has rough edges planted for agents to fix on camera:

- a typo in the headline: “healty”;
- the hero's **Start growing** button, faint and small: it gets lost;
- the third feature card, out of line with the other two;
- the **New** badge, a pink off the palette.

The video uses the first two; the others are there for another take.

## Run it

In Claude Code, from the repository root:

```text
/playground demo
```

It copies `demo/` to `.demo/` (git-ignored), runs it on
<http://localhost:5191> and starts Annotant's watch on it (server on port
4591), like `/playground` does for the playground: the agents edit `.demo/`,
never `demo/`. `npm run demo` runs the app alone, without the widget.

## Shoot the video again

The scene, about 50 s once cut, looped on the site:

| Beat | On screen |
|---|---|
| Comment | Select “healty” in the headline → **Comment** → “typo” → send |
| Draw | **New comment** → **Area** around **Start growing** → “make it stand out, it gets lost” → send |
| Work | The second thread, its steps appearing live; the headline turns to “healthy” behind it |
| Detail | “use the forest green” in the box while it works: faded, then read by the agent |
| Answer | The button turns forest green; the answer lists `src/styles.css` and the branch |
| Diff | **Back to the list** → the typo's thread → `src/Hero.tsx`: its diff, highlighted |
| End | The panel closed, the fixed page held for a beat |

1. `/playground demo`, then stop its `npm run watch` task and run
   `npm run build`: the release widget, without the debug panel's button of
   the dev build `/playground` makes (the watch would rebuild that one).
   Reload the page.
2. Record it with real agents with `/screencast`, at 1280 × 800, local target
   <http://localhost:5191>, without the opening frame (`SCREENCAST_FAST=1`,
   on purpose, though `/screencast` keeps it for choreography passes): the
   agents' changes reload the page, and the opening still would cover it.
   Wait for the comments to leave `open` and `working` in
   `.demo/.annotant/comments.json` before the last beats. Send the detail once
   `.demo/src/Hero.tsx` reads “healthy” and the page has reloaded (a reload
   while typing drops the text), but before the button's agent edits
   `styles.css`; scroll back to the top after each reload. For the branch in
   the panel's foot, make `.demo/` a repository of its own on a feature branch
   (`git init -b main`, a first commit, `git switch -c feature/spring-launch`),
   and `git checkout -- src` there between takes. Before each take,
   put `.demo/` back: copy `demo/src/` over `.demo/src/` and delete
   `.demo/.annotant/comments.json` (`/playground demo` again would bring the
   dev widget back). Take again when an agent wanders.
3. Cut and encode it with ffmpeg. Only the waits are cut: the head, before
   the first selection, and the agents' work past a few seconds. Never their
   output.

   ```sh
   # Keep the segments to show, here 16.2-34 s, 54.5-66 s, 75-78 s, 87-93.5 s
   # and 94 s to the end: the sends, the typo landing and the detail, the
   # button changing, the answer, and the diff.
   ffmpeg -i take.webm -filter_complex "[0:v]fps=25,split=5[a][b][c][d][e];\
   [a]trim=16.2:34,setpts=PTS-STARTPTS[v1];[b]trim=54.5:66,setpts=PTS-STARTPTS[v2];\
   [c]trim=75:78,setpts=PTS-STARTPTS[v3];[d]trim=87:93.5,setpts=PTS-STARTPTS[v4];\
   [e]trim=start=94,setpts=PTS-STARTPTS[v5];[v1][v2][v3][v4][v5]concat=n=5:v=1[v]" \
     -map "[v]" -an -c:v libvpx-vp9 -crf 18 -b:v 0 cut.webm
   ffmpeg -i cut.webm -c:v libvpx-vp9 -crf 42 -b:v 0 -row-mt 1 -an site/assets/demo.webm
   ffmpeg -i cut.webm -c:v libx264 -crf 30 -preset slow -pix_fmt yuv420p -movflags +faststart -an site/assets/demo.mp4
   ffmpeg -sseof -0.5 -i cut.webm -frames:v 1 -q:v 4 site/assets/demo-poster.jpg
   ```

   The poster is the last frame: the fixed page, shown to readers who asked
   for reduced motion.
4. Update the video's `aria-label` in `site/index.html`, which tells the
   scene to readers who do not see it, when the scene or what the agents made
   of it changes (the button's new colour, for one).
