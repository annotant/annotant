import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
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

/** The `--cb-*` colours a block of declarations sets, by name. */
const tokens = (declarations) =>
  Object.fromEntries(
    [...declarations.matchAll(/--cb-([\w-]+):\s*(#[0-9a-f]{6});/gi)].map(([, n, v]) => [
      n,
      v,
    ]),
  )

/** WCAG's relative luminance of a `#rrggbb` colour. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a, b) => {
  const [light, dark] = [luminance(a), luminance(b)].toSorted((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** Each text colour of the widget and the backgrounds it is read on. */
const TEXT_ON = {
  text: ['surface', 'surface-2', 'bubble', 'accent-weak'],
  muted: ['surface', 'surface-2', 'accent-weak'],
  accent: ['surface', 'surface-2', 'accent-weak'],
  'accent-strong': ['accent-weak', 'accent-tint'],
  'on-accent': ['accent', 'accent-strong'],
  surface: ['text', 'red'],
  red: ['surface', 'red-bg'],
  green: ['green-bg', 'surface'],
  'orange-ink': ['surface'],
  'amber-fg': ['amber-bg'],
  'amber-ink': ['amber-bg', 'surface'],
  violet: ['violet-bg', 'surface'],
}

test('keeps every text of both palettes at AA contrast', async () => {
  const css = await source('styles.ts')
  const light = tokens(rule(css, ':host'))
  const dark = tokens(rule(css, ".an[data-theme='dark']"))
  // The dark rule found: else it would check the light palette twice.
  assert.ok(Object.keys(dark).length > Object.keys(light).length / 2)
  const palettes = { light, dark: { ...light, ...dark } }
  for (const [name, palette] of Object.entries(palettes)) {
    for (const [text, backgrounds] of Object.entries(TEXT_ON)) {
      for (const background of backgrounds) {
        const ratio = contrast(palette[text], palette[background])
        assert.ok(
          ratio >= 4.5,
          `${name}: --cb-${text} on --cb-${background} is ${ratio.toFixed(2)}:1`,
        )
      }
    }
  }
})

test('gives each state its own chip colour', async () => {
  const css = await source('components/Chip.tsx')
  const tones = ['open', 'claimed', 'asking', 'answered', 'resolved', 'stopped'].map(
    (tone) => {
      const declarations = rule(css, `.an-chip--${tone}`)
      assert.ok(declarations, `.an-chip--${tone} has a rule of its own`)
      const background = /background: var\(--cb-([\w-]+)\)/.exec(declarations)?.[1]
      assert.ok(background, `.an-chip--${tone} takes its background from a token`)
      return background
    },
  )
  assert.equal(new Set(tones).size, tones.length, `chip backgrounds: ${tones.join(', ')}`)
})

test("puts every component's styles in the stylesheet the widget injects", async () => {
  // Each component keeps its CSS beside it (components/<Name>.tsx); the index
  // joins them, and WIDGET_CSS takes the whole, which main.tsx injects.
  const folder = new URL('../skills/annotant/widget/src/components/', import.meta.url)
  const files = (await readdir(folder)).filter((file) => file.endsWith('.tsx'))
  const index = await source('components/index.ts')
  const joined = new Set(
    (/export const COMPONENTS_CSS = \[([^\]]*)\]/.exec(index)?.[1] ?? '')
      .replace(/\/\/.*$|\/\*[^]*?\*\//gm, '')
      .match(/\w+_CSS/g),
  )
  const exported = (
    await Promise.all(files.map((file) => source(`components/${file}`)))
  ).flatMap((text) => [...text.matchAll(/export const (\w+_CSS) = `/g)].map(([, n]) => n))
  assert.ok(exported.length, 'the components export their styles')
  for (const name of exported) {
    assert.ok(joined.has(name), `${name} is in COMPONENTS_CSS`)
  }
  assert.match(
    await source('styles.ts'),
    /export const WIDGET_CSS = `[^`]*\$\{COMPONENTS_CSS\}/,
  )
})
