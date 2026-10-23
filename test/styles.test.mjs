import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

// Read as text: styles.ts imports fonts, which only the bundler loads.
const source = (file) =>
  readFile(new URL(`../skills/annotant/widget/src/${file}`, import.meta.url), 'utf8')

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

test("ends the current step's text with one ellipsis rather than cutting it", async () => {
  // The line holds the icon first, then the text, with the working dots inside
  // it: when the text is cut, they are too, and one ellipsis stands for both.
  assert.match(
    await source('App.tsx'),
    /<span className="an-current-text">\s*\{activityOf\(step\)\}\s*\{!failed && \(\s*<span className="an-dots"/,
  )
  const text = rule(await source('styles.ts'), '.an-current-text')
  for (const declaration of [
    'min-width: 0',
    'overflow: hidden',
    'text-overflow: ellipsis',
  ]) {
    assert.ok(text.includes(declaration), `.an-current-text needs ${declaration}`)
  }
})
