/** A query parameter a sign-in or a magic link may leave its secret in: keep it in step with `SECRET` in `scripts/server.mjs`. */
const SECRET =
  /token|secret|passw|pwd|csrf|xsrf|nonce|api[-_]?key|session|signature|jwt|credential|authori[sz]ation|bearer|oobcode|oauth_verifier|samlresponse|^(?:auth|code|key|otp|sid|sig|ticket)$/i

/**
 * The page a new comment is on: its origin, path and query, without its
 * credentials, its hash or its query's secret-looking parameters (a sign-in
 * may leave its token in either of the last two). OAuth's `state` goes with
 * them, but an app's own (`?state=closed`) stays. `href` is an absolute URL.
 */
export function pageUrl(href: string): string {
  const url = new URL(href)
  const secrets = [...url.searchParams.keys()].filter((name) => SECRET.test(name))
  if (secrets.length) secrets.push('state')
  // The query is written anew only when a secret goes: `searchParams` encodes
  // every parameter again (`%20` becomes `+`).
  for (const name of secrets) url.searchParams.delete(name)
  return url.origin + url.pathname + url.search
}

/**
 * `path` resolved on this page, or none when it leaves the app's origin or does
 * not parse: a hand-edited comment may hold anything, `//elsewhere.com`
 * included (or `/\` and `/<tab>/`, which browsers read the same).
 */
export function appUrl(path: string): URL | undefined {
  try {
    const url = new URL(path, window.location.href)
    return url.origin === window.location.origin ? url : undefined
  } catch {
    return undefined
  }
}

/** `path` as a link, or '' when it would leave the app (see `appUrl`). */
export const appHref = (path: string): string => (appUrl(path) ? path : '')
