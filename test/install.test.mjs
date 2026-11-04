// lib/install.mjs tells, from a project's files, what in its install no
// longer matches what init writes; detect.mjs reports it for `update`.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { installDrift } from '../skills/annotant/scripts/lib/install.mjs'
import { WIDGET_VERSION } from '../skills/annotant/scripts/lib/project.mjs'
import { SCRIPTS, run, tempDir } from './helpers.mjs'

/** @param {number} port */
const loader = (port) =>
  [
    "if (process.env.NODE_ENV === 'development') {",
    "  const script = document.createElement('script')",
    "  script.type = 'module'",
    `  script.src = 'http://127.0.0.1:${port}/widget.js'`,
    "  script.dataset.annotantLoader = ''",
    '  document.head.append(script)',
    '}',
    '',
  ].join('\n')

/**
 * A project made of `files`, and the kinds of drift found in it with `config`.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, unknown>} config
 * @param {Record<string, string>} files
 */
async function driftOf(t, config, files = {}) {
  const root = await tempDir(t, 'annotant-install-')
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), text)
  }
  return installDrift(root, config)
}

const CURRENT = { version: WIDGET_VERSION, port: 4599, loader: ['src/main.ts'] }

test('finds nothing in an install as init writes it', async (t) => {
  assert.deepEqual(await driftOf(t, CURRENT, { 'src/main.ts': loader(4599) }), [])
})

test('finds a config older or newer than the plugin', async (t) => {
  const files = { 'src/main.ts': loader(4599) }
  const kinds = async (/** @type {unknown} */ version) =>
    (await driftOf(t, { ...CURRENT, version }, files)).map((one) => one.kind)
  assert.deepEqual(await kinds(undefined), ['version-old'])
  assert.deepEqual(await kinds('1'), ['version-old'])
  assert.deepEqual(await kinds(WIDGET_VERSION - 1), ['version-old'])
  assert.equal(
    (await driftOf(t, { ...CURRENT, version: undefined }, files))[0]?.detail,
    `.annotant.json is version null, this plugin writes ${WIDGET_VERSION}`,
  )
  assert.deepEqual(await kinds(WIDGET_VERSION + 1), ['version-new'])
})

test('finds a loader that asks another port than the server', async (t) => {
  const drift = await driftOf(
    t,
    { ...CURRENT, port: 4601 },
    { 'src/main.ts': loader(4599) },
  )
  assert.deepEqual(drift, [
    {
      kind: 'loader-port',
      file: 'src/main.ts',
      detail: 'the loader in "src/main.ts" asks port 4599, the server listens on 4601',
    },
  ])
})

test('finds a loader moved out of its file, or its file gone', async (t) => {
  const drift = await driftOf(
    t,
    { ...CURRENT, loader: ['src/main.ts', 'src/old.ts'] },
    { 'src/main.ts': 'createRoot(app).render(<App />)\n', 'src/other.ts': loader(4599) },
  )
  assert.deepEqual(
    drift.map(({ kind, file }) => [kind, file]),
    [
      ['loader-absent', 'src/main.ts'],
      ['file-missing', 'src/old.ts'],
    ],
  )
})

test('reads only regular files of the project', async (t) => {
  const drift = await driftOf(
    t,
    { ...CURRENT, loader: ['src', '../outside.ts', '/etc/hosts'] },
    { 'src/main.ts': loader(4599) },
  )
  assert.deepEqual(
    drift.map(({ kind, detail }) => [kind, detail]),
    [
      ['file-missing', '"src" is not a file'],
      ['file-missing', '"../outside.ts" is outside the project'],
      ['file-missing', '"/etc/hosts" is outside the project'],
    ],
  )
})

test('compares every URL of a loader with the port, the default one included', async (t) => {
  const two = `${loader(4599)}// fallback\nimport('http://[::1]:4600/widget.js')\n`
  const { port: _, ...noPort } = CURRENT
  assert.deepEqual(
    (await driftOf(t, noPort, { 'src/main.ts': two })).map(({ kind, detail }) => [
      kind,
      detail,
    ]),
    [
      [
        'loader-port',
        'the loader in "src/main.ts" asks port 4600, the server listens on 4599',
      ],
    ],
  )
  // Not a port: the server fails to start and says so.
  assert.deepEqual(
    await driftOf(t, { ...CURRENT, port: 'abc' }, { 'src/main.ts': loader(4599) }),
    [],
  )
})

test('finds a config that lists no loader', async (t) => {
  const kinds = async (/** @type {unknown} */ files) =>
    (await driftOf(t, { ...CURRENT, loader: files })).map((one) => one.kind)
  assert.deepEqual(await kinds(undefined), ['loader-unlisted'])
  assert.deepEqual(await kinds([]), ['loader-unlisted'])
  assert.deepEqual(await kinds('src/main.ts'), ['loader-unlisted'])
})

test('reads the file names of a loader list mixed with other values', async (t) => {
  const drift = await driftOf(
    t,
    { ...CURRENT, loader: [{ path: 'index.html' }, 'src/main.ts'] },
    { 'src/main.ts': loader(4599) },
  )
  assert.deepEqual(drift, [
    {
      kind: 'loader-unlisted',
      detail: '`loader` entry 0 in .annotant.json is not a file name',
    },
  ])
})

test('takes a loader whose port is a variable, by its marker', async (t) => {
  const variable = loader(4599).replace("'http://127.0.0.1:4599/widget.js'", 'WIDGET_URL')
  assert.deepEqual(await driftOf(t, CURRENT, { 'src/main.ts': variable }), [])
})

test('finds a loader without its marker, and takes one written by hand', async (t) => {
  const unmarked = loader(4599).replace("  script.dataset.annotantLoader = ''\n", '')
  assert.deepEqual(
    (await driftOf(t, CURRENT, { 'src/main.ts': unmarked })).map((one) => one.kind),
    ['loader-marker'],
  )
  // index.html with a plain tag, on localhost: the same server.
  const tag =
    '<script type="module" src="http://localhost:4599/widget.js" data-annotant-loader></script>'
  assert.deepEqual(
    await driftOf(t, { ...CURRENT, loader: ['index.html'] }, { 'index.html': tag }),
    [],
  )
})

test('detect.mjs reports the drift of an installed project', async (t) => {
  const root = await tempDir(t, 'annotant-install-')
  await writeFile(path.join(root, 'package.json'), '{"name":"app"}')
  await writeFile(
    path.join(root, '.annotant.json'),
    JSON.stringify({ ...CURRENT, port: 4602 }),
  )
  await mkdir(path.join(root, 'src'))
  await writeFile(path.join(root, 'src/main.ts'), loader(4599))
  const { code, stdout, stderr } = await run('node', [
    path.join(SCRIPTS, 'detect.mjs'),
    '--project',
    root,
  ])
  assert.equal(code, 0, stderr)
  assert.deepEqual(
    JSON.parse(stdout).installed.drift.map(
      (/** @type {{ kind: string }} */ one) => one.kind,
    ),
    ['loader-port'],
  )
})

test('does not block on a FIFO listed as a loader', async (t) => {
  const root = await tempDir(t, 'annotant-install-')
  execFileSync('mkfifo', [path.join(root, 'pipe')])
  assert.deepEqual(installDrift(root, { ...CURRENT, loader: ['pipe'] }), [
    { kind: 'file-missing', file: 'pipe', detail: '"pipe" is not a file' },
  ])
})
