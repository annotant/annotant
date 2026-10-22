#!/usr/bin/env node
// verify-prod.mjs --project <dir> [--dir <build output>]
// Run after a production build: fails if the widget loader made it into the output.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { findProject } from './lib/project.mjs'

const project = findProject()
if (!project) {
  console.error('no .annotant.json found; pass --project <dir>')
  process.exit(2)
}
const argv = process.argv.slice(2)
const dirFlag = argv.indexOf('--dir')
const outDir = path.resolve(
  project.root,
  dirFlag === -1 ? (project.config.buildOutput ?? 'dist') : argv[dirFlag + 1],
)
const port = project.config.port ?? 4599
const markers = [`127.0.0.1:${port}/widget.js`, 'annotantLoader']
const TEXT = /\.(m?js|cjs|html?|css|json|txt|map|rsc)$/
const SKIP = new Set(['cache', 'dev', 'node_modules'])

async function* files(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) yield* files(full)
    } else if (TEXT.test(entry.name)) {
      yield full
    }
  }
}

const hits = []
let scanned = 0
for await (const file of files(outDir)) {
  scanned++
  const text = await readFile(file, 'utf8')
  for (const marker of markers) {
    if (text.includes(marker))
      hits.push({ file: path.relative(project.root, file), marker })
  }
}

if (scanned === 0) {
  console.error(`no build output found in ${outDir}: run the production build first`)
  process.exit(2)
}
if (hits.length) {
  console.error(
    `FAIL: the widget loader is in the production build (${scanned} files scanned)`,
  )
  for (const hit of hits) console.error(`  ${hit.file}: ${hit.marker}`)
  process.exit(1)
}
console.log(
  `OK: no widget loader in ${path.relative(project.root, outDir)} (${scanned} files scanned)`,
)
