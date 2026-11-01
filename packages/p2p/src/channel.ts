/**
 * Messages over a data channel, as JSON, and the means to check them. The other phone is not
 * trusted: whatever it sends is size-checked, parsed as JSON and checked field by field by a
 * parser, and anything else is dropped without a trace.
 */

/**
 * The longest message read. A game's state should stay well below; anything far longer is not
 * from an honest phone, and is dropped before it is parsed.
 */
export const MAX_MESSAGE_LENGTH = 16_384
export const MAX_NAME_LENGTH = 16

/** The part of a data channel used here, so tests can stand in for one (see `testing`). */
export interface Channel {
  readonly readyState: RTCDataChannelState
  send(data: string): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

/** A parser: the checked message, or undefined for anything that is not one. */
export type Parse<T> = (value: unknown) => T | undefined

/**
 * Sends a message as JSON, if the channel is open, and returns its length in characters; on a
 * closed channel, nothing happens and it returns 0.
 */
export function send(channel: Channel, message: unknown): number {
  if (channel.readyState !== 'open') return 0
  const text = JSON.stringify(message)
  channel.send(text)
  return text.length
}

/** Calls back with every message that arrives on a channel and that `parse` accepts. */
export function listen<T>(channel: Channel, parse: Parse<T>, callback: (message: T) => void): void {
  channel.addEventListener('message', (event) => {
    const message = decode(event.data, parse)
    if (message !== undefined) callback(message)
  })
}

/** A message as it arrives, checked: undefined unless it is short JSON that `parse` accepts. */
export function decode<T>(data: unknown, parse: Parse<T>): T | undefined {
  if (typeof data !== 'string' || data.length > MAX_MESSAGE_LENGTH) return undefined
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    return undefined
  }
  return parse(value)
}

/**
 * A name as other players see it: single line, short, never empty. Control and formatting
 * characters go, such as a right-to-left override that would make a name read as another, and
 * the name is cut by characters, so no emoji is split in half.
 */
export function cleanName(name: unknown, fallback: string): string {
  const text =
    typeof name === 'string'
      ? Array.from(
          name
            // Control characters first, but not whitespace, which then becomes single spaces:
            // the other way round, "a \0 b" would keep two spaces in a row.
            .replace(/(?![\t\n\v\f\r])[\p{Cc}\p{Cf}]/gu, '')
            .replace(/\s+/g, ' ')
            .trim(),
        )
          .slice(0, MAX_NAME_LENGTH)
          .join('')
          .trim()
      : ''
  return text || fallback
}

/** Checks for writing parsers. Each narrows `unknown` to what it checks. */

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A finite number: JSON reads 1e999 as Infinity. */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** A whole number from 0 up, such as an id. */
export function isId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

export function inRange(value: unknown, min: number, max: number): value is number {
  return isNumber(value) && value >= min && value <= max
}

/** Every item of an array, checked; undefined for no array, too many items or a bad one. */
export function list<T>(value: unknown, max: number, item: Parse<T>): T[] | undefined {
  if (!Array.isArray(value) || value.length > max) return undefined
  const items: T[] = []
  for (const entry of value) {
    const checked = item(entry)
    if (checked === undefined) return undefined
    items.push(checked)
  }
  return items
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
