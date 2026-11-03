/**
 * A short log of what happened, in memory only, for a game's debug report: the last few hundred
 * lines, each with the seconds since the log began and the part of the game it is about. It
 * says what happened, never what was said: no tokens, codes, addresses or message contents go
 * in, and what looks like one is masked, in case an error message carries it.
 */
export class DebugLog {
  private readonly kept: string[] = []
  private started: number

  constructor(
    /** Lines kept, the oldest go first. */
    readonly maxLines = 300,
    private readonly clock: () => number = Date.now,
  ) {
    this.started = clock()
  }

  /** Adds a line, such as `log('net', 'player 2: no message for 800 ms')`. */
  log(area: string, message: string): void {
    const seconds = Math.round((this.clock() - this.started) / 100) / 10
    this.kept.push(`+${seconds}s [${redact(area)}] ${redact(message)}`)
    if (this.kept.length > this.maxLines) this.kept.splice(0, this.kept.length - this.maxLines)
  }

  /** Every line kept, oldest first. */
  lines(): readonly string[] {
    return this.kept
  }

  /** Starts the log afresh. */
  clear(): void {
    this.kept.length = 0
    this.started = this.clock()
  }

  /** Logs errors nobody caught, so a report shows them too. */
  captureErrors(target: Pick<Window, 'addEventListener'> = window): void {
    target.addEventListener('error', (event) =>
      this.log(
        'error',
        describeError((event as ErrorEvent).error ?? (event as ErrorEvent).message),
      ),
    )
    target.addEventListener('unhandledrejection', (event) =>
      this.log('error', `unhandled: ${describeError((event as PromiseRejectionEvent).reason)}`),
    )
  }
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

/**
 * Masks what must not leave the phone: connection codes (`P1~…`), IP addresses, MAC addresses,
 * mDNS names and tokens.
 */
export function redact(text: string): string {
  return text
    .replace(/\bP\d+~[^\s"']*/g, '<code>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>')
    .replace(/\b[0-9a-f]{2}(?:([:-])[0-9a-f]{2})(?:\1[0-9a-f]{2}){4}\b/gi, '<mac>')
    .replace(/\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\b/gi, (match) =>
      match.length > 6 ? '<ip>' : match,
    )
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local\b/gi, '<mdns>')
    .replace(/\b[0-9a-f]{20,}\b/gi, '<token>')
    .replace(/\btoken-[\w-]+/g, '<token>')
}
