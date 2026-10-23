#!/usr/bin/env node
// launch.mjs prepare [keep] [demo] | open [demo]
// The app is playground/, or demo/ with `demo` (the app the website's video is
// shot on), run from its working copy .playground/ or .demo/.
// prepare: builds the widget with its debug panel (npm run build:dev) when the
//   bundle is missing, a release build or older than its sources, then refreshes
//   the working copy from the app (kept as it is with `keep`).
//   PORT_BUSY lists what holds the ports: HOLDER <pid> <command>, one per process.
// open: waits for the app and its Annotant server, then opens the app in the browser.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const [mode, ...options] = process.argv.slice(2)
const APP = options.includes('demo') ? 'demo' : 'playground'
const SOURCE = path.join(REPO, APP)
const COPY = path.join(REPO, `.${APP}`)
const WIDGET = path.join(REPO, 'skills/annotant/widget')
// Top-level folders never copied: installed packages, the build, and earlier comments.
const SKIPPED = new Set(['node_modules', 'dist', '.annotant'])

/** @type {{ port: number, devUrl: string }} */
const config = JSON.parse(readFileSync(path.join(SOURCE, '.annotant.json'), 'utf8'))
const health = `http://127.0.0.1:${config.port}/api/health`

/** The latest modification time under `dir`, in milliseconds. */
function newest(dir) {
  let latest = statSync(dir).mtimeMs
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    latest = Math.max(latest, entry.isDirectory() ? newest(full) : statSync(full).mtimeMs)
  }
  return latest
}

/**
 * The processes listening on `ports`, as `<pid> <command>` lines. Empty when
 * lsof is missing (Windows) or finds none.
 * @param {number[]} ports
 */
function holders(ports) {
  const lsof = spawnSync(
    'lsof',
    ['-nP', '-t', ...ports.flatMap((port) => [`-iTCP:${port}`]), '-sTCP:LISTEN'],
    { encoding: 'utf8' },
  )
  const pids = [...new Set((lsof.stdout ?? '').split('\n').filter(Boolean))]
  return pids.map((pid) => {
    const ps = spawnSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' })
    return `${pid} ${(ps.stdout ?? '').trim()}`
  })
}

/** Whether something answers at `url`. */
async function answers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) })
    return true
  } catch {
    return false
  }
}

async function prepare(keep) {
  const busy = []
  if (await answers(config.devUrl)) busy.push(`app ${config.devUrl}`)
  if (await answers(health)) {
    // Another clone's playground, most often: its server says which.
    const served = await fetch(health)
      .then((response) => response.json())
      .then((body) => (typeof body?.project === 'string' ? ` for ${body.project}` : ''))
      .catch(() => '')
    busy.push(`Annotant server ${health}${served}`)
  }
  if (busy.length) {
    console.log(`PORT_BUSY ${busy.join(', ')}`)
    for (const holder of holders([Number(new URL(config.devUrl).port), config.port])) {
      console.log(`HOLDER ${holder}`)
    }
    process.exit(1)
  }

  const bundle = path.join(WIDGET, 'dist/widget.js')
  if (
    !existsSync(bundle) ||
    // A release build, from npm run build: no debug panel. build.mjs writes this
    // banner on a dev build; test/bundle.test.mjs holds it to it.
    !readFileSync(bundle, 'utf8').startsWith('/* annotant widget (dev build') ||
    statSync(bundle).mtimeMs < newest(path.join(WIDGET, 'src'))
  ) {
    console.log(
      'BUILD the widget is missing, a release build or older than its sources: npm run build:dev',
    )
    const result = spawnSync('npm', ['run', 'build:dev'], { cwd: REPO, stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status ?? 1)
  }

  if (keep && existsSync(COPY)) {
    console.log(`KEPT ${COPY}`)
  } else {
    rmSync(COPY, { recursive: true, force: true })
    cpSync(SOURCE, COPY, {
      recursive: true,
      filter: (file) =>
        !SKIPPED.has(path.relative(SOURCE, file).split(path.sep)[0] ?? ''),
    })
    console.log(`COPIED ${SOURCE} to ${COPY}`)
  }
  console.log(`READY app ${config.devUrl}, Annotant port ${config.port}`)
}

async function open() {
  const deadline = Date.now() + 120_000
  while (!((await answers(config.devUrl)) && (await answers(health)))) {
    if (Date.now() > deadline) {
      console.log(`TIMEOUT ${config.devUrl} or ${health} did not answer within 2 minutes`)
      process.exit(1)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  /** @type {[string, string[]]} */
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', []]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '']]
        : ['xdg-open', []]
  spawn(command, [...args, config.devUrl], { detached: true, stdio: 'ignore' }).unref()
  console.log(`OPENED ${config.devUrl}`)
}

const allowed = mode === 'prepare' ? ['keep', 'demo'] : ['demo']
if (options.some((option) => !allowed.includes(option))) {
  // A typo would refresh the working copy (`kep`) or run the other app (`dmeo`).
  console.error('usage: launch.mjs prepare [keep] [demo] | open [demo]')
  process.exit(2)
}
if (mode === 'prepare') await prepare(options.includes('keep'))
else if (mode === 'open') await open()
else {
  console.error('usage: launch.mjs prepare [keep] [demo] | open [demo]')
  process.exit(2)
}
