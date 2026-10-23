// serve.mjs [--port <port>]
// The playground's dev server: rebuilds on every change and reloads the page.
import path from 'node:path'
import { context } from 'esbuild'
import { ROOT, options } from './esbuild.mjs'

const argv = process.argv.slice(2)
const flag = argv.indexOf('--port')
const port = flag === -1 ? 5190 : Number(argv[flag + 1])

const ctx = await context({
  ...options('development'),
  outdir: path.join(ROOT, 'public/assets'),
  // Served from memory: nothing is written to public/.
  write: false,
})
await ctx.watch()
await ctx.serve({
  host: '127.0.0.1',
  port,
  servedir: path.join(ROOT, 'public'),
  // Every route is the app's: the router reads the path.
  fallback: path.join(ROOT, 'public/index.html'),
})
console.log(`READY http://localhost:${port}`)
