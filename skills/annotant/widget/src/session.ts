// What the widget keeps across reloads of the page, for this tab only.

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names what it stored
export function readSession<T>(key: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(key)
    // Written by writeSession with the same key and type.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}

/** False when it could not be written: the key is then emptied, never left with an older value. */
export function writeSession(key: string, value: unknown): boolean {
  try {
    if (value === undefined) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // Storage can be unavailable (private mode) or full; the widget then just forgets.
    try {
      sessionStorage.removeItem(key)
    } catch {
      // Unavailable: nothing was kept either.
    }
    return false
  }
}
