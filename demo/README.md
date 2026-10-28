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

The scene, about 30 s once cut, looped on the site:

| Beat | On screen |
|---|---|
| Comment | Select “healty” in the headline → **Comment** → “typo” → send |
| Draw | **New comment** → **Draw an area** around **Start growing** → “make it stand out” → send |
| Work | The second thread, its steps appearing live, while the first agent fixes the typo behind it |
| Answer | Its answer and the new button; **Back to the list**: both comments resolved |
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
   `.demo/.annotant/comments.json` before the last beats. Before each take,
   put `.demo/` back: copy `demo/src/` over `.demo/src/` and delete
   `.demo/.annotant/comments.json` (`/playground demo` again would bring the
   dev widget back). Take again when an agent wanders.
3. Cut and encode it with ffmpeg. Only the waits are cut: the head, before
   the first selection, and the agents' work past a few seconds. Never their
   output.

   ```sh
   # Keep the segments to show, here from 17.3 s to 36.5 s, 55.5 s to 60.5 s and
   # 68.5 s to the end: the sends, the changes landing and the answers.
   ffmpeg -i take.webm -filter_complex "[0:v]fps=25,split=3[a][b][c];\
   [a]trim=17.3:36.5,setpts=PTS-STARTPTS[v1];[b]trim=55.5:60.5,setpts=PTS-STARTPTS[v2];\
   [c]trim=start=68.5,setpts=PTS-STARTPTS[v3];[v1][v2][v3]concat=n=3:v=1[v]" \
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
