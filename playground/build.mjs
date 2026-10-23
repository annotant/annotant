// build.mjs [--outdir <dir>]
// The playground's production build, in dist/ unless --outdir says otherwise.
import { copyFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { ROOT, options } from './esbuild.mjs'

const argv = process.argv.slice(2)
const flag = argv.indexOf('--outdir')
const outdir = path.resolve(flag === -1 ? path.join(ROOT, 'dist') : argv[flag + 1])

rmSync(outdir, { recursive: true, force: true })
await build({ ...options('production'), outdir: path.join(outdir, 'assets') })
copyFileSync(path.join(ROOT, 'public/index.html'), path.join(outdir, 'index.html'))
