// Shared by the tests: throwaway projects and state folders, and a way to run
// the scripts as Claude Code would.
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const SCRIPTS = new URL('../skills/code-buddy/scripts/', import.meta.url).pathname

/**
 * A TCP port nothing listens on.
 * @returns {Promise<number>}
 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('no TCP port'))
        return
      }
      probe.close(() => resolve(address.port))
    })
  })
}

/**
 * A response's JSON, as the test expects it to be.
 * @param {Response} response
 * @returns {Promise<any>}
 */
export const json = (response) => response.json()

/** A folder removed after the test. */
export async function tempDir(t, prefix = 'code-buddy-test-') {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** A project with a .code-buddy.json, as init writes it. */
export async function tempProject(t, config = {}) {
  const root = await tempDir(t, 'code-buddy-project-')
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(
    path.join(root, '.code-buddy.json'),
    JSON.stringify({
      version: 1,
      name: 'test',
      port: 4599,
      commentsFile: '.code-buddy/comments.json',
      editable: ['src'],
      ...config,
    }),
  )
  return root
}

/**
 * Runs a script with `input` on stdin.
 * @param {string} command
 * @param {string[]} args
 * @param {{ input?: string, env?: Record<string, string>, cwd?: string }} [options]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
export function run(command, args, { input = '', env = {}, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(input)
  })
}
