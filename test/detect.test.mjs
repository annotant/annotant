// detect.mjs finds how an app switches between light and dark, for `theme`
// in .annotant.json.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { SCRIPTS, run, tempDir } from './helpers.mjs'

/**
 * What detect.mjs reports as the theme of a project made of `files`.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} files
 * @param {Record<string, string>} [dependencies]
 */
async function themeOf(t, files, dependencies = {}) {
  const root = await tempDir(t, 'annotant-detect-')
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'app', dependencies: { react: '19.0.0', ...dependencies } }),
  )
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), text)
  }
  const { code, stdout, stderr } = await run('node', [
    path.join(SCRIPTS, 'detect.mjs'),
    '--project',
    root,
  ])
  assert.equal(code, 0, stderr)
  return JSON.parse(stdout).theme
}

const DARK_CLASS = { on: 'html', attribute: 'class', dark: 'dark' }

test("finds Tailwind 3's class dark mode in its config", async (t) => {
  assert.deepEqual(
    await themeOf(t, { 'tailwind.config.js': "module.exports = { darkMode: 'class' }" }),
    { setting: DARK_CLASS, from: 'tailwind.config.js' },
  )
})

test("finds Tailwind 3's selector dark mode on an attribute", async (t) => {
  const config = `export default { darkMode: ['selector', '[data-mode="dark"]'] }`
  assert.deepEqual((await themeOf(t, { 'tailwind.config.ts': config })).setting, {
    on: 'html',
    attribute: 'data-mode',
    dark: 'dark',
  })
})

test("finds Tailwind 4's dark variant in the CSS", async (t) => {
  const css = '@import "tailwindcss";\n@custom-variant dark (&:where(.dark, .dark *));\n'
  assert.deepEqual(await themeOf(t, { 'src/index.css': css }), {
    setting: DARK_CLASS,
    from: 'src/index.css',
  })
})

test("reads next-themes' attribute, data-theme by default", async (t) => {
  const deps = { 'next-themes': '0.4.0' }
  const provider = '<ThemeProvider attribute="class" defaultTheme="system">'
  assert.deepEqual(
    (await themeOf(t, { 'app/providers.tsx': provider }, deps)).setting,
    DARK_CLASS,
  )
  assert.deepEqual((await themeOf(t, { 'app/page.tsx': '' }, deps)).setting, {
    on: 'html',
    attribute: 'data-theme',
    dark: 'dark',
  })
})

test("finds Chakra's class, on body", async (t) => {
  assert.deepEqual((await themeOf(t, {}, { '@chakra-ui/react': '2.8.0' })).setting, {
    on: 'body',
    attribute: 'class',
    dark: 'chakra-ui-dark',
  })
})

test('follows the OS while an app of light, dark and system has neither', async (t) => {
  const css = `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { --bg: #000; } }
:root[data-theme='dark'] { --bg: #000; }`
  assert.deepEqual((await themeOf(t, { 'src/styles.css': css })).setting, {
    on: 'html',
    attribute: 'data-theme',
    dark: 'dark',
    light: 'light',
  })
})

test('finds a dark class of the app in its styles', async (t) => {
  const css = 'body { color: #000; }\nhtml.dark { color: #fff; }\n'
  assert.deepEqual((await themeOf(t, { 'src/app.css': css })).setting, DARK_CLASS)
})

test('falls back on the OS setting when the styles only ask for it', async (t) => {
  const css = '@media (prefers-color-scheme: dark) { body { background: #000; } }'
  assert.deepEqual(await themeOf(t, { 'src/app.css': css }), {
    setting: 'media',
    from: 'src/app.css',
  })
})

test('reports no theme for an app of one theme only', async (t) => {
  assert.equal(await themeOf(t, { 'src/app.css': 'body { color: #222; }' }), undefined)
})
