import { execFile } from 'node:child_process'

/**
 * The project's repository, for the widget to link the issues a message
 * cites: GitHub's or GitLab's, and no other host, whose links it cannot know.
 * @typedef {{ kind: 'github' | 'gitlab', url: string }} Repository
 */

/**
 * A remote's url as a page of its repository, `https://host/owner/repo`:
 * from its HTTP(S) form (keeping its scheme and port), its `git://` one or
 * either SSH one (`git@host:owner/repo.git`, `ssh://git@host/owner/repo`),
 * without its credentials. Undefined for any other host than `github.com` or
 * one named `gitlab.*` or `*.gitlab.*` (a GitLab under another name, or GitHub
 * Enterprise, is not known), and for a path that is not a project's.
 * @param {string} remote
 * @returns {Repository | undefined}
 */
export function repositoryOf(remote) {
  const scp = /^[\w.-]+@([\w.-]+):(?!\/)(.+)$/.exec(remote.trim())
  /** @type {URL} */
  let parsed
  try {
    parsed = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : remote.trim())
  } catch {
    return undefined
  }
  if (!/^(https?|ssh|git|git\+ssh):$/.test(parsed.protocol)) return undefined
  const host = parsed.hostname.toLowerCase()
  const kind =
    host === 'github.com'
      ? 'github'
      : host.split('.').includes('gitlab')
        ? 'gitlab'
        : undefined
  const repo = parsed.pathname
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .replace(/^\/+/, '')
  // A GitLab project may sit in subgroups; a GitHub one is `owner/repo`.
  const parts = repo.split('/')
  if (!kind || parts.length < 2 || (kind === 'github' && parts.length !== 2))
    return undefined
  if (!parts.every((part) => /^[\w.-]+$/.test(part))) return undefined
  // A git or SSH remote's port is not the site's.
  const site = parsed.protocol.startsWith('http')
    ? `${parsed.protocol}//${parsed.host.toLowerCase()}`
    : `https://${host}`
  return { kind, url: `${site}/${repo}` }
}

/**
 * The repository of the project's `origin` remote, undefined when it has none,
 * when git cannot read it (said on stderr, but for a project outside git) or
 * when {@link repositoryOf} cannot read it (said too, by its host only: the
 * url may hold credentials).
 * @param {string} root
 * @returns {Promise<Repository | undefined>}
 */
export function originOf(root) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['remote', 'get-url', 'origin'],
      { cwd: root, timeout: 5000 },
      (error, stdout, stderr) => {
        if (error) {
          if (!/no such remote|not a git repository/i.test(stderr)) {
            console.error(
              `annotant server: cannot read the origin remote, issues stay text: ${error.message.trim()}`,
            )
          }
          return resolve(undefined)
        }
        const repository = repositoryOf(stdout)
        if (!repository) {
          const host = /^(?:[\w+]+:\/\/)?(?:[^@/]*@)?([^:/\s]+)/.exec(stdout.trim())?.[1]
          console.error(
            `annotant server: the origin remote (${host ?? 'unknown host'}) is neither on GitHub nor on a GitLab, issues stay text`,
          )
        }
        resolve(repository)
      },
    )
  })
}
