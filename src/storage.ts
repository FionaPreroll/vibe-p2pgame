/**
 * The browser's local storage, under keys of this game only. Reading and writing never throw:
 * private browsing, a full disk or blocked storage only mean that nothing is remembered.
 */
const PREFIX = 'vibe-p2pgame:'

export function readJson(key: string): unknown {
  try {
    const text = localStorage.getItem(PREFIX + key)
    return text === null ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
}

/** A plain string, as stored before values were JSON. */
export function readText(key: string): string | undefined {
  try {
    return localStorage.getItem(PREFIX + key) ?? undefined
  } catch {
    return undefined
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {}
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {}
}

/** Forgets everything this game has stored, and nothing of other sites on the same origin. */
export function clearAll(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key)
    }
  } catch {}
}
