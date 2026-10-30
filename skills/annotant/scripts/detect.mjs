#!/usr/bin/env node
// detect.mjs [--project <dir>]
// Prints what /annotant init needs to know about a project, as JSON.
// It only reads files; every decision is left to the agent and the user.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { CONFIG_FILE, WIDGET_VERSION } from './lib/project.mjs'

const argv = process.argv.slice(2)
const flag = argv.indexOf('--project')
const root = path.resolve(flag === -1 ? process.cwd() : argv[flag + 1])

const read = (file) => {
  try {
    return readFileSync(path.join(root, file), 'utf8')
  } catch {
    return undefined
  }
}
const json = (file) => {
  const text = read(file)
  try {
    return text ? JSON.parse(text) : undefined
  } catch {
    return undefined
  }
}
const exists = (file) => existsSync(path.join(root, file))
const firstExisting = (files) => files.find(exists)

const pkg = json('package.json')
const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
const version = (name) => deps[name]?.replace(/^[^\d]*/, '')
const major = (name) => Number(version(name)?.split('.')[0] ?? NaN)
const minor = (name) => Number(version(name)?.split('.')[1] ?? NaN)

const FRAMEWORKS = {
  next: 'next',
  vite: 'vite',
  cra: 'react-scripts',
  remix: '@remix-run/react',
  'react-router': 'react-router',
  astro: 'astro',
  nuxt: 'nuxt',
  vue: 'vue',
  sveltekit: '@sveltejs/kit',
  svelte: 'svelte',
  angular: '@angular/core',
  react: 'react',
  webpack: 'webpack',
}
const frameworks = Object.entries(FRAMEWORKS)
  .filter(([, name]) => deps[name])
  .map(([id, name]) => ({ id, package: name, version: deps[name] }))

const packageManager = exists('pnpm-lock.yaml')
  ? 'pnpm'
  : exists('yarn.lock')
    ? 'yarn'
    : exists('bun.lockb') || exists('bun.lock')
      ? 'bun'
      : exists('package-lock.json')
        ? 'npm'
        : undefined

const workspaces =
  pkg?.workspaces ??
  read('pnpm-workspace.yaml')
    ?.split('\n')
    .filter((line) => /^\s*-\s/.test(line))
    .map((line) => line.replace(/^\s*-\s*['"]?|['"]?\s*$/g, ''))

function workspaceApps() {
  if (!workspaces?.length) return []
  const apps = []
  for (const pattern of /** @type {string[]} */ ([]).concat(
    workspaces.packages ?? workspaces,
  )) {
    const base = pattern.replace(/\/\*+$/, '')
    const dirs = pattern.endsWith('*')
      ? (() => {
          try {
            return readdirSync(path.join(root, base)).map((d) => path.join(base, d))
          } catch {
            return []
          }
        })()
      : [base]
    for (const dir of dirs) {
      const child = json(path.join(dir, 'package.json'))
      if (!child) continue
      const childDeps = { ...child.dependencies, ...child.devDependencies }
      const found = Object.values(FRAMEWORKS).filter((name) => childDeps[name])
      if (found.length) apps.push({ dir, name: child.name, frameworks: found })
    }
  }
  return apps
}

const scripts = pkg?.scripts ?? {}
const run = (name) =>
  scripts[name] &&
  `${packageManager === 'npm' ? 'npm run' : (packageManager ?? 'npm run')} ${name}`

function devPort() {
  const dev = scripts.dev ?? scripts.start ?? ''
  const flagged = dev.match(/(?:--port|-p)[\s=](\d{2,5})/)?.[1]
  if (flagged) return Number(flagged)
  const viteConfig = read(
    firstExisting(['vite.config.ts', 'vite.config.js', 'vite.config.mjs']) ?? '',
  )
  const vitePort = viteConfig?.match(/port\s*:\s*(\d{2,5})/)?.[1]
  if (vitePort) return Number(vitePort)
  if (deps.next || deps['react-scripts']) return 3000
  if (deps.vite) return 5173
  if (deps.astro) return 4321
  if (deps['@angular/core']) return 4200
  return undefined
}

function next() {
  if (!deps.next) return undefined
  const srcDir = exists('src/app') || exists('src/pages')
  const base = srcDir ? 'src/' : ''
  const router =
    exists(`${base}app`) && exists(`${base}pages`)
      ? 'app+pages'
      : exists(`${base}app`)
        ? 'app'
        : 'pages'
  return {
    version: version('next'),
    router,
    srcDir,
    instrumentationClient: firstExisting(
      ['ts', 'js', 'tsx', 'jsx'].map((ext) => `${base}instrumentation-client.${ext}`),
    ),
    supportsInstrumentationClient:
      major('next') > 15 || (major('next') === 15 && minor('next') >= 3),
    output: '.next',
  }
}

function vite() {
  if (!deps.vite) return undefined
  const html = read('index.html')
  const entry = html?.match(
    /<script[^>]+type=["']module["'][^>]+src=["']\/?([^"']+)["']/,
  )?.[1]
  return {
    config: firstExisting(['vite.config.ts', 'vite.config.js', 'vite.config.mjs']),
    entry,
    output: 'dist',
  }
}

function cspHints() {
  const files = [
    'next.config.js',
    'next.config.mjs',
    'next.config.ts',
    'index.html',
    'public/index.html',
    'src/middleware.ts',
    'middleware.ts',
    'src/proxy.ts',
    'proxy.ts',
  ]
  return files.filter((file) => /content-security-policy/i.test(read(file) ?? ''))
}

// Folders a project's own source never lives in.
const NOT_SOURCE = new Set([
  'node_modules',
  '.git',
  '.next',
  '.annotant',
  'dist',
  'build',
  'out',
  'coverage',
])

// Over this size, a file is generated (a bundle, a dump), not the app's own.
const MAX_SOURCE_BYTES = 1_000_000
const small = (/** @type {string} */ file) => {
  try {
    return statSync(path.join(root, file)).size <= MAX_SOURCE_BYTES
  } catch {
    return false
  }
}

/**
 * The files under `dirs` whose name matches `pattern`, up to `limit`: regular
 * files, under MAX_SOURCE_BYTES.
 * @param {string[]} dirs
 * @param {RegExp} pattern
 */
function sourceFiles(dirs, pattern, limit = 500) {
  /** @type {string[]} */
  const found = []
  const walk = (/** @type {string} */ dir) => {
    let entries
    try {
      entries = readdirSync(path.join(root, dir), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= limit) return
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!NOT_SOURCE.has(entry.name)) walk(file)
      } else if (entry.isFile() && pattern.test(entry.name) && small(file)) {
        found.push(file)
      }
    }
  }
  dirs.forEach(walk)
  return found
}

/**
 * The theme a dark-mode selector stands for: `.dark` (a class) or
 * `[data-theme="dark"]` (an attribute), on `html`. None for a negation
 * (`:not(.light *)`): the value it names is the light one.
 * @param {string} selector
 */
function selectorTheme(selector) {
  if (selector.includes(':not(')) return undefined
  const attribute = selector.match(/\[([\w-]+)=["']?([\w-]+)["']?\]/)
  if (attribute) return { on: 'html', attribute: attribute[1], dark: attribute[2] }
  const name = selector.match(/\.([\w-]+)/)?.[1]
  return name ? { on: 'html', attribute: 'class', dark: name } : undefined
}

/**
 * How the app switches between light and dark, for `theme` in .annotant.json,
 * with the file that tells: a class or an attribute on `html` or `body`, the
 * OS setting (`media`), or undefined when nothing tells (the widget then
 * reads the page's background).
 */
function theme() {
  const dirs = ['src', 'app', 'pages', 'components', 'lib', 'styles', 'assets'].filter(
    exists,
  )
  const texts = [
    ...[
      'index.html',
      'tailwind.config.js',
      'tailwind.config.ts',
      'tailwind.config.cjs',
      'tailwind.config.mjs',
    ].filter(exists),
    ...sourceFiles(
      dirs,
      /\.(css|scss|sass|less|pcss|html|[cm]?[jt]sx?|vue|svelte|astro)$/,
    ),
  ].map((file) => ({ file, text: read(file) ?? '' }))
  const find = (/** @type {RegExp} */ pattern) => {
    for (const { file, text } of texts) {
      const match = text.match(pattern)
      if (match) return { file, match }
    }
    return undefined
  }

  // Tailwind 3: darkMode in its config; Tailwind 4: the dark variant in its CSS.
  // An array's strings may hold brackets: `['selector', '[data-mode="dark"]']`.
  const darkMode = find(
    /darkMode\s*:\s*(\[(?:[^\]'"]|'[^']*'|"[^"]*")*\]|['"][\w-]+['"])/,
  )
  if (darkMode) {
    const [mode, selector] = [...darkMode.match[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map(
      ([, single, double]) => single ?? double,
    )
    if (mode === 'media') return { setting: 'media', from: darkMode.file }
    const setting = selector
      ? selectorTheme(selector)
      : { on: 'html', attribute: 'class', dark: 'dark' }
    if (setting) return { setting, from: darkMode.file }
  }
  const variant = find(/@(?:custom-)?variant\s+dark\s*\(([^;{]+)\)/)
  const fromVariant = variant && selectorTheme(variant.match[1])
  if (variant && fromVariant) return { setting: fromVariant, from: variant.file }

  if (deps['next-themes']) {
    const attribute = find(/\battribute\s*[=:]\s*\{?\s*["']([\w-]+)["']/)
    const name = attribute?.match[1] ?? 'data-theme'
    return {
      setting: { on: 'html', attribute: name, dark: 'dark' },
      from: attribute?.file ?? 'package.json',
    }
  }
  if (deps['@mantine/core']) {
    return {
      setting: { on: 'html', attribute: 'data-mantine-color-scheme', dark: 'dark' },
      from: 'package.json',
    }
  }
  if (deps['@chakra-ui/react']) {
    return {
      setting: { on: 'body', attribute: 'class', dark: 'chakra-ui-dark' },
      from: 'package.json',
    }
  }

  // A switch of the app's own: an attribute set to dark, or a class, in its styles.
  const os = find(/prefers-color-scheme\s*:\s*dark/)
  const attribute = find(/\[((?:data-)?[\w-]*(?:theme|mode|scheme))=["']?dark["']?\]/)
  if (attribute) {
    const name = attribute.match[1]
    const light = os && find(new RegExp(`\\[${name}=["']?light["']?\\]`))
    return {
      setting: {
        on: 'html',
        attribute: name,
        dark: 'dark',
        ...(light && { light: 'light' }),
      },
      from: attribute.file,
    }
  }
  const darkClass = find(
    /(?:^|[\s,}])(?:html|:root|body)?\.(dark|dark-mode|theme-dark)(?![\w-])\s*[{,]/m,
  )
  if (darkClass) {
    const on = /(?:^|[\s,}])body\./.test(darkClass.match[0]) ? 'body' : 'html'
    return {
      setting: { on, attribute: 'class', dark: darkClass.match[1] },
      from: darkClass.file,
    }
  }
  if (os) return { setting: 'media', from: os.file }
  // Tailwind's dark variant without a config for it follows the OS.
  const variantUsed =
    (deps.tailwindcss || deps['@tailwindcss/vite']) && find(/\bdark:[\w[-]/)
  if (variantUsed) return { setting: 'media', from: variantUsed.file }
  return undefined
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

async function freePort(from = 4599) {
  for (let port = from; port < from + 50; port++) {
    if (await portFree(port)) return port
  }
  return undefined
}

const installed = json(CONFIG_FILE)
const gitignore = read('.gitignore') ?? ''
const port = devPort()

const report = {
  root,
  isPackage: !!pkg,
  name: pkg?.name ?? path.basename(root),
  packageManager,
  monorepo: workspaces?.length ? { workspaces, apps: workspaceApps() } : undefined,
  frameworks,
  webFrontend: frameworks.some((f) => f.id !== 'webpack') || exists('index.html'),
  react: !!deps.react,
  typescript: exists('tsconfig.json'),
  next: next(),
  vite: vite(),
  scripts: {
    dev: scripts.dev && run('dev'),
    build: scripts.build && run('build'),
    typecheck:
      (scripts.typecheck && run('typecheck')) ??
      (scripts['type-check'] && run('type-check')),
    lint: scripts.lint && run('lint'),
  },
  devPort: port,
  devUrl: port ? `http://localhost:${port}` : undefined,
  srcDirs: ['src', 'app', 'pages', 'components', 'lib'].filter(exists),
  cspFiles: cspHints(),
  theme: theme(),
  gitignore: {
    exists: exists('.gitignore'),
    hasCommentsDir: gitignore.includes('.annotant/'),
  },
  legacyInstall: ['.code-buddy.json', '.live-feedback.json'].find(exists),
  installed: installed
    ? { version: installed.version, current: WIDGET_VERSION, config: installed }
    : undefined,
  suggestedServerPort: installed?.port ?? (await freePort()),
}

console.log(JSON.stringify(report, null, 2))
