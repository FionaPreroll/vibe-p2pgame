/**
 * A short log of what happened, in memory only, for the debug report (see src/report.ts): the
 * last few hundred lines, from this start of the game. It says what happened, never what was
 * said: no tokens, codes, addresses or message contents go in, and what looks like one is
 * masked, in case an error message carries it.
 */

const MAX_LINES = 300
const lines: string[] = []
let started = Date.now()

export function log(area: string, message: string): void {
  const seconds = Math.round((Date.now() - started) / 100) / 10
  lines.push(`+${seconds}s [${area}] ${redact(message)}`)
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES)
}

export function logLines(): readonly string[] {
  return lines
}

/** An error as a short line: its code and message, whatever kind of error it is. */
export function describeError(error: unknown): string {
  if (error === null || error === undefined) return String(error)
  if (typeof error !== 'object') return String(error).slice(0, 300)
  const { code, message, name } = error as { code?: unknown; message?: unknown; name?: unknown }
  const parts = [code, typeof message === 'string' ? message : name].filter(
    (part) => part !== undefined && part !== '',
  )
  return (
    parts.length > 0 ? parts.map(String).join(': ') : Object.prototype.toString.call(error)
  ).slice(0, 300)
}

/** Masks what must not leave the phone: codes, addresses and tokens. */
export function redact(text: string): string {
  return text
    .replace(/P1~[^\s"']*/g, '<code>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>')
    .replace(/\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\b/gi, (match) =>
      match.length > 6 ? '<ip>' : match,
    )
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local\b/gi, '<mdns>')
    .replace(/\b[0-9a-f]{20,}\b/gi, '<token>')
    .replace(/\btoken-[\w-]+/g, '<token>')
}

/** Logs errors nobody caught, so a report shows them too. */
export function captureErrors(target: Pick<Window, 'addEventListener'> = window): void {
  target.addEventListener('error', (event) =>
    log('error', describeError((event as ErrorEvent).error ?? (event as ErrorEvent).message)),
  )
  target.addEventListener('unhandledrejection', (event) =>
    log('error', `unhandled: ${describeError((event as PromiseRejectionEvent).reason)}`),
  )
}

/** For tests: starts the log afresh. */
export function clearLog(): void {
  lines.length = 0
  started = Date.now()
}
