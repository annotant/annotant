// What the widget keeps across reloads of the page: for this tab only (`sessionStorage`),
// or for every tab of the app, until the reader changes it (`localStorage`, the layout).

// Read when called: merely naming the storage throws where it is blocked.
type Store = () => Storage

const session: Store = () => sessionStorage
const local: Store = () => localStorage

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names what it stored
function read<T>(store: Store, key: string): T | undefined {
  try {
    const raw = store().getItem(key)
    // Written by write with the same key and type.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}

function write(store: Store, key: string, value: unknown): boolean {
  try {
    if (value === undefined) store().removeItem(key)
    else store().setItem(key, JSON.stringify(value))
    return true
  } catch {
    // Storage can be unavailable (private mode) or full; the widget then just forgets.
    try {
      store().removeItem(key)
    } catch {
      // Unavailable: nothing was kept either.
    }
    return false
  }
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names what it stored
export function readSession<T>(key: string): T | undefined {
  return read<T>(session, key)
}

/** False when it could not be written: the key is then emptied, never left with an older value. */
export function writeSession(key: string, value: unknown): boolean {
  return write(session, key, value)
}

/** What was kept for every tab: only ever an `unknown`, to check, as another version may have written it. */
export function readLocal(key: string): unknown {
  return read<unknown>(local, key)
}

export function writeLocal(key: string, value: unknown): boolean {
  return write(local, key, value)
}
