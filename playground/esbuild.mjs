// The playground's bundle, shared by serve.mjs (development) and build.mjs (production).
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.dirname(fileURLToPath(import.meta.url))

/**
 * @param {'development' | 'production'} mode
 * @returns {import('esbuild').BuildOptions}
 */
export function options(mode) {
  return {
    absWorkingDir: ROOT,
    entryPoints: ['src/main.tsx', 'src/styles.css'],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    loader: { '.woff2': 'file' },
    assetNames: '[name]-[hash]',
    // Production drops the dev-only branches, the Annotant loader among them.
    minify: mode === 'production',
    sourcemap: mode === 'development',
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
    logLevel: 'info',
  }
}
