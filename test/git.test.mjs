// lib/git.mjs: where a project is in git, and the store's record of where a
// run wrote.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { tempDir, tempProject } from './helpers.mjs'

/** @type {typeof import('../skills/annotant/scripts/lib/git.mjs')} */
let git
/** @type {typeof import('../skills/annotant/scripts/lib/store.mjs')} */
let store
/** @type {typeof import('../skills/annotant/scripts/lib/project.mjs')} */
let projects

before(async (t) => {
  process.env.ANNOTANT_STATE_DIR = await tempDir(t)
  git = await import('../skills/annotant/scripts/lib/git.mjs')
  store = await import('../skills/annotant/scripts/lib/store.mjs')
  projects = await import('../skills/annotant/scripts/lib/project.mjs')
})

/**
 * Runs git in `dir`, without the user's signing or hooks.
 * @param {string} dir
 * @param {string[]} args
 */
const gitIn = (dir, ...args) =>
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      ...args,
    ],
    { cwd: dir, encoding: 'utf8' },
  ).trim()

/**
 * A repository with one commit, on `main`.
 * @param {import('node:test').TestContext} t
 */
async function repository(t) {
  // As the system names it: through a symbolic link on macOS (/var).
  const dir = await tempDir(t, 'annotant-git-')
  gitIn(dir, 'init', '-q', '-b', 'main')
  gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'first')
  return dir
}

test('names the branch of the main checkout, without a worktree', async (t) => {
  const dir = await repository(t)
  assert.deepEqual(await git.gitPlace(dir), { branch: 'main' })
  gitIn(dir, 'switch', '-q', '-c', 'feature/blue')
  // From a folder inside it, git names its folders in two ways.
  const web = path.join(dir, 'web')
  await mkdir(web)
  assert.deepEqual(await git.gitPlace(web), { branch: 'feature/blue' })
})

test('names the short commit of a detached HEAD', async (t) => {
  const dir = await repository(t)
  gitIn(dir, 'switch', '-q', '--detach')
  assert.deepEqual(await git.gitPlace(dir), {
    commit: gitIn(dir, 'rev-parse', '--short', 'HEAD'),
  })
})

test('names the worktree of a linked checkout, from a folder inside it too', async (t) => {
  const dir = await repository(t)
  // Removed with its folder, as the repository's is.
  const linked = path.join(await tempDir(t), 'blue')
  gitIn(dir, 'worktree', 'add', '-q', '-b', 'blue', linked)
  const top = await realpath(linked)
  assert.deepEqual(await git.gitPlace(linked), { branch: 'blue', worktree: top })
  gitIn(linked, 'switch', '-q', '-c', 'blue-web')
  const web = path.join(linked, 'web')
  await mkdir(web)
  assert.deepEqual(await git.gitPlace(web), {
    branch: 'blue-web',
    worktree: top,
  })
})

test('says nothing outside a git repository', async (t) => {
  const dir = await tempDir(t)
  assert.equal(await git.gitPlace(dir), undefined)
  assert.equal(await git.defaultBranch(dir), undefined)
})

test("finds the default branch from origin's, else main or master", async (t) => {
  const dir = await repository(t)
  assert.equal(await git.defaultBranch(dir), 'main')
  gitIn(dir, 'branch', '-q', '-m', 'main', 'master')
  assert.equal(await git.defaultBranch(dir), 'master')
  gitIn(dir, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD')
  gitIn(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
  assert.equal(await git.defaultBranch(dir), 'trunk')
})

/**
 * A project with one comment, claimed: run r1.
 * @param {import('node:test').TestContext} t
 */
async function claimed(t) {
  const project = projects.project(await tempProject(t))
  const comments = store.createStore(project, { history: false })
  const { id } = await comments.create({
    route: '/',
    anchor: { section: '', quote: '', occurrence: 0 },
    body: 'Make it blue',
  })
  await comments.claim(id, { git: { branch: 'main' } })
  const read = async () => (await comments.readAll()).find((one) => one.id === id)
  return { comments, id, read }
}

test("records where a run first wrote, with where it started on the claim's event", async (t) => {
  const { comments, id, read } = await claimed(t)
  assert.equal(await comments.wrote(id, 'r1', { branch: 'feature/blue' }), true)
  // The same place again changes nothing.
  assert.equal(await comments.wrote(id, 'r1', { branch: 'feature/blue' }), false)
  const comment = await read()
  assert.deepEqual(comment?.events.at(-1)?.git, { branch: 'main' })
  assert.equal(comment?.writes?.length, 1)
  assert.equal(comment?.writes?.[0]?.run, 'r1')
  assert.equal(comment?.writes?.[0]?.branch, 'feature/blue')
  assert.equal(comment?.writes?.[0]?.switched, undefined)
})

test('a later write elsewhere switched the run; back where it first wrote, it still had', async (t) => {
  const { comments, id, read } = await claimed(t)
  await comments.wrote(id, 'r1', { branch: 'main' })
  assert.equal(await comments.wrote(id, 'r1', { commit: 'abc1234' }), true)
  assert.equal(await comments.wrote(id, 'r1', { branch: 'main' }), false)
  assert.deepEqual((await read())?.writes?.[0]?.switched, { commit: 'abc1234' })
})

test('records nothing for a run that ended', async (t) => {
  const { comments, id, read } = await claimed(t)
  await comments.answer(id, 'Done.')
  assert.equal(await comments.wrote(id, 'r1', { branch: 'main' }), false)
  assert.equal((await read())?.writes, undefined)
})

test("each run records where it wrote, never as another run's switch", async (t) => {
  const { comments, id, read } = await claimed(t)
  await comments.wrote(id, 'r1', { branch: 'main' })
  await comments.answer(id, 'Done.')
  await comments.update(id, { followUp: 'Now in green' })
  await comments.claim(id, { git: { branch: 'feature/green' } })
  assert.equal(await comments.wrote(id, 'r2', { branch: 'feature/green' }), true)
  assert.deepEqual(
    (await read())?.writes?.map((write) => [write.run, write.branch, write.switched]),
    [
      ['r1', 'main', undefined],
      ['r2', 'feature/green', undefined],
    ],
  )
})
