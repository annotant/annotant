import { execFile } from 'node:child_process'

/**
 * The project's repository, for the widget to link the issues a message
 * cites: GitHub's or GitLab's, and no other host, whose links it cannot know.
 * @typedef {{ kind: 'github' | 'gitlab', url: string }} Repository
 */

/**
 * A remote's url as a page of its repository, `https://host/owner/repo`:
 * from its HTTPS form or either SSH one (`git@host:owner/repo.git`,
 * `ssh://git@host/owner/repo`), without its credentials. Undefined for any
 * other host than GitHub's or a GitLab.
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
  // An SSH remote's port is SSH's, not the site's.
  const site = parsed.protocol.startsWith('http') ? parsed.host.toLowerCase() : host
  return { kind, url: `https://${site}/${repo}` }
}

/**
 * The repository of the project's `origin` remote, undefined when it has none
 * (or git is missing) or a host {@link repositoryOf} does not know.
 * @param {string} root
 * @returns {Promise<Repository | undefined>}
 */
export function originOf(root) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['remote', 'get-url', 'origin'],
      { cwd: root, timeout: 5000 },
      (error, stdout) => resolve(error ? undefined : repositoryOf(stdout)),
    )
  })
}
