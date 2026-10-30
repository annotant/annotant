import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { originOf, repositoryOf } from '../skills/annotant/scripts/lib/remote.mjs'
import { tempDir } from './helpers.mjs'

test("reads a GitHub remote's HTTPS and SSH forms as its page", () => {
  const page = { kind: 'github', url: 'https://github.com/acme/shop' }
  assert.deepEqual(repositoryOf('https://github.com/acme/shop.git\n'), page)
  assert.deepEqual(repositoryOf('https://github.com/acme/shop/'), page)
  assert.deepEqual(repositoryOf('git@github.com:acme/shop.git'), page)
  assert.deepEqual(repositoryOf('ssh://git@github.com:22/acme/shop.git'), page)
  assert.deepEqual(repositoryOf('git+ssh://git@GitHub.com/acme/shop'), page)
})

test("drops a remote's credentials", () => {
  assert.deepEqual(repositoryOf('https://me:ghp_secret@github.com/acme/shop.git'), {
    kind: 'github',
    url: 'https://github.com/acme/shop',
  })
})

test('reads a GitLab remote, in subgroups and on its own host', () => {
  assert.deepEqual(repositoryOf('git@gitlab.com:acme/web/shop.git'), {
    kind: 'gitlab',
    url: 'https://gitlab.com/acme/web/shop',
  })
  assert.deepEqual(repositoryOf('https://gitlab.acme.dev:8443/web/shop.git'), {
    kind: 'gitlab',
    url: 'https://gitlab.acme.dev:8443/web/shop',
  })
  // A plain-HTTP GitLab keeps its scheme: its pages are not served over HTTPS.
  assert.deepEqual(repositoryOf('http://gitlab.lan:8080/web/shop.git'), {
    kind: 'gitlab',
    url: 'http://gitlab.lan:8080/web/shop',
  })
})

test('knows no other host, nor a path that is not a repository', () => {
  assert.equal(repositoryOf('git@bitbucket.org:acme/shop.git'), undefined)
  assert.equal(repositoryOf('/srv/git/shop.git'), undefined)
  assert.equal(repositoryOf('file:///srv/git/shop.git'), undefined)
  assert.equal(repositoryOf('https://github.com/acme'), undefined)
  assert.equal(repositoryOf('https://github.com/acme/shop/tree/main'), undefined)
  assert.equal(repositoryOf('https://notgithub.com/acme/shop'), undefined)
  assert.equal(repositoryOf(''), undefined)
})

test("reads the project's origin, and nothing without one", async (t) => {
  const root = await tempDir(t)
  assert.equal(await originOf(root), undefined)
  execFileSync('git', ['init', '-q'], { cwd: root })
  assert.equal(await originOf(root), undefined)
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/shop.git'], {
    cwd: root,
  })
  assert.deepEqual(await originOf(root), {
    kind: 'github',
    url: 'https://github.com/acme/shop',
  })
})
