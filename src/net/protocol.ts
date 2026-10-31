import {
  ARENA,
  type Blast,
  MAX_PLAYERS,
  type Mine,
  type Phase,
  type Player,
  type Snapshot,
  type Spark,
} from '../game/sim'

/**
 * The version of the messages and snapshots. Phones update the game in the background, so a
 * host and a player can run different versions; a player whose version differs is not let in,
 * as it would not show everything the host's game has, such as mines.
 */
export const PROTOCOL = 2

/**
 * The longest message either side reads. A snapshot of a full game is under 3 KB; anything far
 * longer is not from an honest phone, and is dropped before it is parsed.
 */
export const MAX_MESSAGE_LENGTH = 16_384
export const MAX_NAME_LENGTH = 16
/** The longest a round trip may honestly take to be shown, in milliseconds. */
const MAX_PING_MS = 60_000

/** Messages a player's phone sends to the host. */
export type ToHost =
  /**
   * On `control`, once the channels are open. The token is the browser's own: a player who
   * comes back with it gets their place, color and score back.
   */
  | { type: 'hello'; name: string; token: string; version: number }
  /** On `fast`, many times a second: where the player steers, and their last ping. */
  | { type: 'input'; x: number | null; y: number | null; ping: number | null }
  /** On `fast`, once a second: the host answers at once, so the player can time the trip. */
  | { type: 'ping'; sent: number }

/** Messages the host sends to a player's phone. */
export type ToGuest =
  /** On `control`, in answer to `hello`: the player's id in every snapshot. */
  | { type: 'welcome'; id: number; host: string; rejoined: boolean; version: number }
  /** On `control`, in answer to `hello`, when the versions differ. */
  | { type: 'mismatch'; version: number }
  /** On `control`, when the host ends the game on purpose: there is nothing to rejoin. */
  | { type: 'bye' }
  /** On `control`, when the host has no room left. */
  | { type: 'full' }
  /** On `fast`, many times a second. */
  | { type: 'state'; state: Snapshot }
  | { type: 'pong'; sent: number }

/** The part of a data channel the protocol uses, so tests can stand in for one. */
export interface Channel {
  readonly readyState: RTCDataChannelState
  send(data: string): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

export function send(channel: Channel, message: ToHost | ToGuest): void {
  if (channel.readyState === 'open') channel.send(JSON.stringify(message))
}

/**
 * Calls back with every message that arrives on a channel and that `parse` accepts. The other
 * phone is not trusted: whatever it sends is size-checked, parsed as JSON and checked field by
 * field, and anything else is dropped without a trace.
 */
export function listen<T>(
  channel: Channel,
  parse: (value: unknown) => T | undefined,
  callback: (message: T) => void,
): void {
  channel.addEventListener('message', (event) => {
    const message = decode(event.data, parse)
    if (message !== undefined) callback(message)
  })
}

/** A message as it arrives, checked: undefined unless it is short JSON that `parse` accepts. */
export function decode<T>(data: unknown, parse: (value: unknown) => T | undefined): T | undefined {
  if (typeof data !== 'string' || data.length > MAX_MESSAGE_LENGTH) return undefined
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    return undefined
  }
  return parse(value)
}

/** A message to the host, if it is one, with every field checked and made safe. */
export function parseToHost(value: unknown): ToHost | undefined {
  if (!isObject(value)) return undefined
  switch (value.type) {
    case 'hello':
      return {
        type: 'hello',
        name: typeof value.name === 'string' ? value.name.slice(0, 256) : '',
        token: isToken(value.token) ? value.token : '',
        version: typeof value.version === 'number' ? value.version : -1,
      }
    case 'input': {
      // A target is both coordinates or none; JSON's 1e999 is Infinity, so finite is checked.
      const steering = isNumber(value.x) && isNumber(value.y)
      return {
        type: 'input',
        x: steering ? clamp(value.x as number, 0, ARENA) : null,
        y: steering ? clamp(value.y as number, 0, ARENA) : null,
        ping:
          isNumber(value.ping) && value.ping >= 0 && value.ping <= MAX_PING_MS ? value.ping : null,
      }
    }
    case 'ping':
      return isNumber(value.sent) ? { type: 'ping', sent: value.sent } : undefined
    default:
      return undefined
  }
}

/** A message to a player, if it is one, with every field checked. */
export function parseToGuest(value: unknown): ToGuest | undefined {
  if (!isObject(value)) return undefined
  switch (value.type) {
    case 'welcome':
      if (!isId(value.id)) return undefined
      return {
        type: 'welcome',
        id: value.id,
        host: cleanName(value.host, '?'),
        rejoined: value.rejoined === true,
        version: typeof value.version === 'number' ? value.version : -1,
      }
    case 'mismatch':
      return { type: 'mismatch', version: typeof value.version === 'number' ? value.version : -1 }
    case 'bye':
      return { type: 'bye' }
    case 'full':
      return { type: 'full' }
    case 'state': {
      const state = parseSnapshot(value.state)
      return state && { type: 'state', state }
    }
    case 'pong':
      return isNumber(value.sent) ? { type: 'pong', sent: value.sent } : undefined
    default:
      return undefined
  }
}

const PHASES: readonly Phase[] = ['lobby', 'play', 'over']
/** Bounds well above what the rules make, so an honest snapshot always fits. */
const MAX_SPARKS = 64
const MAX_MINES = 32
const MAX_BLASTS = 64
const MAX_AWAY = 64
const MAX_SCORE = 1_000_000

/**
 * A snapshot from the host, if it is a whole and sound one: a phone draws it as it is, so a
 * single wrong field drops all of it, and the next snapshot comes a moment later.
 */
export function parseSnapshot(value: unknown): Snapshot | undefined {
  if (!isObject(value)) return undefined
  if (!PHASES.includes(value.phase as Phase)) return undefined
  if (!isNumber(value.timeLeft) || value.timeLeft < 0 || value.timeLeft > 24 * 3600)
    return undefined
  const players = list(value.players, MAX_PLAYERS, (p): Player | undefined =>
    isObject(p) && isId(p.id) && inArena(p.x) && inArena(p.y) && isScore(p.score)
      ? {
          id: p.id,
          name: cleanName(p.name, '?'),
          x: p.x,
          y: p.y,
          score: p.score,
          ping: isNumber(p.ping) && p.ping >= 0 && p.ping <= MAX_PING_MS ? p.ping : null,
        }
      : undefined,
  )
  const sparks = list(value.sparks, MAX_SPARKS, (s): Spark | undefined =>
    isObject(s) && isId(s.id) && inArena(s.x) && inArena(s.y) && typeof s.gold === 'boolean'
      ? { id: s.id, x: s.x, y: s.y, gold: s.gold }
      : undefined,
  )
  const mines = list(value.mines, MAX_MINES, (m): Mine | undefined =>
    isObject(m) && isId(m.id) && inArena(m.x) && inArena(m.y) && isNumber(m.armIn) && m.armIn >= 0
      ? { id: m.id, x: m.x, y: m.y, armIn: m.armIn }
      : undefined,
  )
  const blasts = list(value.blasts, MAX_BLASTS, (b): Blast | undefined =>
    isObject(b) &&
    isId(b.id) &&
    inArena(b.x) &&
    inArena(b.y) &&
    isId(b.playerId) &&
    isNumber(b.age) &&
    b.age >= 0
      ? { id: b.id, x: b.x, y: b.y, playerId: b.playerId, age: b.age }
      : undefined,
  )
  const away =
    value.away === undefined
      ? []
      : list(value.away, MAX_AWAY, (a) =>
          isObject(a) && isId(a.id) ? { id: a.id, name: cleanName(a.name, '?') } : undefined,
        )
  if (!players || !sparks || !mines || !blasts || !away) return undefined
  // Ids are what a phone finds its own dot by: two players with one id are no game.
  if (new Set(players.map((p) => p.id)).size !== players.length) return undefined
  return {
    phase: value.phase as Phase,
    timeLeft: value.timeLeft,
    players,
    sparks,
    mines,
    blasts,
    away,
  }
}

/**
 * A name as other players see it: single line, short, never empty. Control and formatting
 * characters go, such as a right-to-left override that would make a name read as another.
 */
export function cleanName(name: unknown, fallback: string): string {
  const text =
    typeof name === 'string'
      ? Array.from(
          name
            .replace(/\s+/g, ' ')
            .replace(/[\p{Cc}\p{Cf}]/gu, '')
            .trim(),
        )
          .slice(0, MAX_NAME_LENGTH)
          .join('')
          .trim()
      : ''
  return text || fallback
}

/** Every item of an array, checked; undefined for no array, too many items or a bad one. */
function list<T>(
  value: unknown,
  max: number,
  item: (value: unknown) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value) || value.length > max) return undefined
  const items: T[] = []
  for (const entry of value) {
    const checked = item(entry)
    if (checked === undefined) return undefined
    items.push(checked)
  }
  return items
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A finite number: JSON reads 1e999 as Infinity. */
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isScore(value: unknown): value is number {
  return Number.isSafeInteger(value) && Math.abs(value as number) <= MAX_SCORE
}

function inArena(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value <= ARENA
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
