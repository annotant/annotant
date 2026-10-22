import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { SCRIPTS, freePort, run, tempDir } from './helpers.mjs'

/**
 * A project installed under a former name, as its init wrote it.
 * @param {import('node:test').TestContext} t
 * @param {string} name
 * @param {string} loader
 */
async function legacyProject(t, name, loader) {
  const root = await tempDir(t)
  await mkdir(path.join(root, `.${name}`))
  await writeFile(
    path.join(root, `.${name}`, 'comments.json'),
    '{"version":2,"comments":[]}\n',
  )
  await writeFile(
    path.join(root, 'main.ts'),
    `if (import.meta.env.DEV) script.dataset.${loader} = ''\n`,
  )
  await writeFile(
    path.join(root, '.gitignore'),
    `node_modules/\n# ${name} skill\n.${name}/\n`,
  )
  await writeFile(
    path.join(root, `.${name}.json`),
    JSON.stringify({
      version: 1,
      // Nothing serves it: the migration checks no session of the former name does.
      port: await freePort(),
      commentsFile: `.${name}/comments.json`,
      loader: ['main.ts'],
    }),
  )
  return root
}

/** @param {string} root */
const migrate = (root) =>
  run(process.execPath, [path.join(SCRIPTS, 'migrate.mjs'), '--project', root])

for (const [name, loader] of [
  ['code-buddy', 'codeBuddyLoader'],
  ['live-feedback', 'liveFeedbackLoader'],
]) {
  test(`moves a project installed as ${name} to annotant`, async (t) => {
    const root = await legacyProject(t, name, loader)
    const { code, stderr } = await migrate(root)
    assert.equal(code, 0, stderr)

    const config = JSON.parse(await readFile(path.join(root, '.annotant.json'), 'utf8'))
    assert.equal(config.commentsFile, '.annotant/comments.json')
    assert.ok(!existsSync(path.join(root, `.${name}.json`)))
    assert.ok(existsSync(path.join(root, '.annotant', 'comments.json')))
    assert.ok(!existsSync(path.join(root, `.${name}`)))
    assert.equal(
      await readFile(path.join(root, 'main.ts'), 'utf8'),
      "if (import.meta.env.DEV) script.dataset.annotantLoader = ''\n",
    )
    assert.equal(
      await readFile(path.join(root, '.gitignore'), 'utf8'),
      'node_modules/\n# annotant skill\n.annotant/\n',
    )
  })
}

test('leaves a project already on annotant as it is', async (t) => {
  const root = await legacyProject(t, 'code-buddy', 'codeBuddyLoader')
  await writeFile(path.join(root, '.annotant.json'), '{}\n')
  const { code, stdout } = await migrate(root)
  assert.equal(code, 0)
  assert.match(stdout, /nothing to migrate/)
  assert.ok(existsSync(path.join(root, '.code-buddy.json')))
})
