#!/usr/bin/env node
// detect.mjs [--project <dir>]
// Prints what /annotant init needs to know about a project, as JSON.
// It only reads files; every decision is left to the agent and the user.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
