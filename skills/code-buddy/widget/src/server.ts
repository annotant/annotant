// Where the widget's server is: next to the bundle the loader took from it,
// or where the browser extension found it (it sets `codeBuddyServer` in its
// own world before importing the bundle). Only a server on this machine: with
// the loader the widget shares the page's world, where any script can set it.
const LOCAL_SERVER = /^http:\/\/127\.0\.0\.1:\d{1,5}\/$/

export function serverOf(found: unknown, bundle: string): string {
  return typeof found === 'string' && LOCAL_SERVER.test(found)
    ? found
    : new URL('.', bundle).href
}

export const SERVER = serverOf(
  Reflect.get(globalThis, 'codeBuddyServer'),
  import.meta.url,
)
