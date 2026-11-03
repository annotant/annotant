import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import path from 'node:path'

/** @typedef {import('./format.mjs').GitPlace} GitPlace */

/**
 * git's output in `dir`, trimmed, or how it failed: `code`, its exit status,
 * and what it said; undefined when it did not run or was killed (the 5 s
 * timeout), with Node's reason.
 * @param {string} dir
 * @param {string[]} args
 * @returns {Promise<{ out?: string, code?: number, stderr: string }>}
 */
function git(dir, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: dir, timeout: 5000 }, (error, stdout, stderr) =>
      resolve(
        error
          ? typeof error.code === 'number'
            ? { code: error.code, stderr: stderr.trim() }
            : // Not run (no git), or killed (the timeout): why, from Node.
              { stderr: error.message }
          : { out: stdout.trim(), stderr: '' },
      ),
    )
  })
}

const NOT_A_REPOSITORY = /not a git repository/i

/**
 * Where the project at `dir` is in git: its branch, or its short commit on a
 * detached HEAD, and its worktree's folder when it is not the repository's
 * main checkout. Undefined outside a git repository, and when git fails:
 * then `report` gets why (git missing, a repository it refuses, a timeout),
 * never a guess that would show as a branch switch.
 * @param {string} dir
 * @param {(why: string) => void} [report]
 * @returns {Promise<GitPlace | undefined>}
 */
export async function gitPlace(dir, report = () => undefined) {
  const [dirs, head] = await Promise.all([
    git(dir, ['rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir']),
    git(dir, ['symbolic-ref', '-q', '--short', 'HEAD']),
  ])
  const [top, gitDir, common] = dirs.out?.split('\n') ?? []
  if (!top || !gitDir || !common) {
    if (!NOT_A_REPOSITORY.test(dirs.stderr))
      report(`git rev-parse failed: ${dirs.stderr}`)
    return undefined
  }
  // `-q`: a detached HEAD exits 1 and says nothing; anything else failed.
  const detached = head.out === undefined && head.code === 1 && !head.stderr
  if (head.out === undefined && !detached) {
    report(`git symbolic-ref failed: ${head.stderr}`)
    return undefined
  }
  const branch = head.out
  // A fixed length: `--short` alone grows with the repository, and the same
  // HEAD would read as a move.
  const read = detached ? await git(dir, ['rev-parse', '--short=12', 'HEAD']) : undefined
  const commit = read?.out
  if (read && !commit) report(`git rev-parse HEAD failed: ${read.stderr}`)
  if (!branch && !commit) return undefined
  // A linked worktree has a git folder of its own, under the main one's. git
  // may print one through a symbolic link and not the other (/var,
  // /private/var); when either cannot be resolved, both are compared as given.
  const given = [gitDir, common].map((one) => path.resolve(dir, one))
  const real = await Promise.all(given.map((one) => realpath(one).catch(() => undefined)))
  const [own, shared] = real.every(Boolean) ? real : given
  return {
    ...(branch ? { branch } : { commit }),
    ...(own !== shared ? { worktree: top } : {}),
  }
}

/**
 * The repository's default branch: `origin`'s, else `main` or `master` when
 * the repository has it. Undefined when none of them is known, and when git
 * fails: then `report` gets why (a missing ref is no failure: `-q` exits 1).
 * @param {string} dir
 * @param {(why: string) => void} [report]
 * @returns {Promise<string | undefined>}
 */
export async function defaultBranch(dir, report = () => undefined) {
  /** @param {string[]} args */
  const read = async (args) => {
    const done = await git(dir, args)
    if (done.out === undefined && (done.code !== 1 || done.stderr)) {
      if (!NOT_A_REPOSITORY.test(done.stderr))
        report(`git ${args[0]} failed: ${done.stderr}`)
      return { out: undefined, failed: true }
    }
    return { out: done.out, failed: false }
  }
  const remote = await read(['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'])
  if (remote.out) return remote.out.replace(/^origin\//, '')
  if (remote.failed) return undefined
  for (const name of ['main', 'master']) {
    const found = await read(['rev-parse', '-q', '--verify', `refs/heads/${name}`])
    if (found.out) return name
    if (found.failed) return undefined
  }
  return undefined
}

/**
 * Whether two places are the same: the same branch (or commit) in the same
 * worktree. The widget's domain.ts flags a run by the same rule.
 * @param {GitPlace} a
 * @param {GitPlace} b
 */
const samePlace = (a, b) =>
  a.branch === b.branch && a.commit === b.commit && a.worktree === b.worktree

/**
 * Whether a run's `write` already says it wrote at `place`: where it first
 * wrote, or where it `switched` to. A write back where it first wrote records
 * nothing: `switched` is the last other place, not where the run ended.
 * @param {import('./format.mjs').Write} write
 * @param {GitPlace} place
 */
export const wroteAt = (write, place) =>
  samePlace(write, place) || (!!write.switched && samePlace(write.switched, place))
