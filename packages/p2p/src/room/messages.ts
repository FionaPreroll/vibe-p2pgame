import {
  cleanName,
  inRange,
  isId,
  isNumber,
  isObject,
  MAX_MESSAGE_LENGTH,
  type Parse,
} from '../channel.ts'
import { type ConnectionTest, MAX_TEST_MS, parseConnectionTest } from './probe.ts'

/**
 * The version of the room's own messages. A game has a version of its own besides, for its
 * input and state; a player is let in only when both match the host's.
 */
export const ROOM_PROTOCOL = 3

/** The longest a round trip may honestly take to be shown, in milliseconds. */
const MAX_PING_MS = 60_000

/** Messages a player's phone sends to the host. */
export type ToHost<Input, Event = never> =
  /**
   * On `control`, once the channels are open. The token is the browser's own: a player who
   * comes back with it gets their place back.
   */
  | { type: 'hello'; name: string; token: string; room: number; version: number }
  /** On `fast`, many times a second: the game's input, and the player's last ping. */
  | { type: 'input'; data: Input; ping: number | null }
  /**
   * On `fast`, once a second: the host answers at once, so the player can time the trip. It
   * carries the player's last ping too, for games that send no input.
   */
  | { type: 'ping'; sent: number; ping: number | null }
  /** On `control`, now and then: one of the game's events, such as a move, which must arrive. */
  | { type: 'event'; data: Event }
  /** On `fast`, during a connection test: data to measure how much gets through. */
  | { type: 'probe'; test: number; pad: string }
  /** On `fast`, during a connection test: the answer to the host's probe `seq`, at once. */
  | { type: 'echo'; test: number; seq: number }
  /** On `control`, as a connection test ends: what the player sent and received in it. */
  | {
      type: 'tested'
      test: number
      sent: number
      sentChars: number
      received: number
      receivedChars: number
    }

/** Messages the host sends to a player's phone. */
export type ToGuest<State, Event = never> =
  /** On `control`, in answer to `hello`: the player's id. */
  | { type: 'welcome'; id: number; host: string; rejoined: boolean; room: number; version: number }
  /** On `control`, in answer to `hello`, when the versions differ. */
  | { type: 'mismatch'; room: number; version: number }
  /** On `control`, when the host ends the game on purpose: there is nothing to rejoin. */
  | { type: 'bye' }
  /** On `control`, when the host has no room left. */
  | { type: 'full' }
  /**
   * On `fast`, many times a second: the game's state, numbered by the host's tick, so a player
   * can tell an old state that arrives after a newer one, as `fast` may reorder.
   */
  | { type: 'state'; data: State; n?: number }
  | { type: 'pong'; sent: number }
  /** On `control`, now and then: one of the game's events, which must arrive. */
  | { type: 'event'; data: Event }
  /** On `control`: a connection test of `ms` milliseconds begins. */
  | { type: 'test'; test: number; ms: number }
  /**
   * On `fast`, during a connection test: data to measure how much gets through, or, with a
   * `seq`, a ping for the player to answer at once.
   */
  | { type: 'probe'; test: number; seq: number | null; pad: string }
  /** On `control`, once a connection test is over: how it went. */
  | { type: 'tested'; test: number; result: ConnectionTest }

/** Takes no event at all: for games without events. */
const noEvents: Parse<never> = () => undefined

/** Reads messages to the host; `parseInput` and `parseEvent` check the game's part. */
export function hostParser<Input, Event = never>(
  parseInput: Parse<Input>,
  parseEvent: Parse<Event> = noEvents,
): Parse<ToHost<Input, Event>> {
  return (value) => {
    if (!isObject(value)) return undefined
    switch (value.type) {
      case 'hello':
        return {
          type: 'hello',
          name: typeof value.name === 'string' ? value.name.slice(0, 256) : '',
          token: isToken(value.token) ? value.token : '',
          room: isNumber(value.room) ? value.room : -1,
          version: isNumber(value.version) ? value.version : -1,
        }
      case 'input': {
        const data = parseInput(value.data)
        if (data === undefined) return undefined
        return {
          type: 'input',
          data,
          ping: inRange(value.ping, 0, MAX_PING_MS) ? value.ping : null,
        }
      }
      case 'ping':
        return isNumber(value.sent)
          ? {
              type: 'ping',
              sent: value.sent,
              ping: inRange(value.ping, 0, MAX_PING_MS) ? value.ping : null,
            }
          : undefined
      case 'event': {
        const data = parseEvent(value.data)
        return data === undefined ? undefined : { type: 'event', data }
      }
      case 'probe':
        return isId(value.test) && isPad(value.pad)
          ? { type: 'probe', test: value.test, pad: value.pad }
          : undefined
      case 'echo':
        return isId(value.test) && isId(value.seq)
          ? { type: 'echo', test: value.test, seq: value.seq }
          : undefined
      case 'tested':
        return isId(value.test) &&
          isId(value.sent) &&
          isId(value.sentChars) &&
          isId(value.received) &&
          isId(value.receivedChars)
          ? {
              type: 'tested',
              test: value.test,
              sent: value.sent,
              sentChars: value.sentChars,
              received: value.received,
              receivedChars: value.receivedChars,
            }
          : undefined
      default:
        return undefined
    }
  }
}

/** Reads messages to a player; `parseState` and `parseEvent` check the game's part. */
export function guestParser<State, Event = never>(
  parseState: Parse<State>,
  parseEvent: Parse<Event> = noEvents,
): Parse<ToGuest<State, Event>> {
  return (value) => {
    if (!isObject(value)) return undefined
    switch (value.type) {
      case 'welcome':
        if (!isId(value.id)) return undefined
        return {
          type: 'welcome',
          id: value.id,
          host: cleanName(value.host, '?'),
          rejoined: value.rejoined === true,
          room: isNumber(value.room) ? value.room : -1,
          version: isNumber(value.version) ? value.version : -1,
        }
      case 'mismatch':
        return {
          type: 'mismatch',
          room: isNumber(value.room) ? value.room : -1,
          version: isNumber(value.version) ? value.version : -1,
        }
      case 'bye':
        return { type: 'bye' }
      case 'full':
        return { type: 'full' }
      case 'state': {
        const data = parseState(value.data)
        if (data === undefined) return undefined
        return isId(value.n) ? { type: 'state', data, n: value.n } : { type: 'state', data }
      }
      case 'pong':
        return isNumber(value.sent) ? { type: 'pong', sent: value.sent } : undefined
      case 'event': {
        const data = parseEvent(value.data)
        return data === undefined ? undefined : { type: 'event', data }
      }
      case 'test':
        return isId(value.test) && inRange(value.ms, 0, MAX_TEST_MS)
          ? { type: 'test', test: value.test, ms: value.ms }
          : undefined
      case 'probe':
        return isId(value.test) && (value.seq === null || isId(value.seq)) && isPad(value.pad)
          ? { type: 'probe', test: value.test, seq: value.seq, pad: value.pad }
          : undefined
      case 'tested': {
        const result = parseConnectionTest(value.result)
        return isId(value.test) && result ? { type: 'tested', test: value.test, result } : undefined
      }
      default:
        return undefined
    }
  }
}

/** A connection test's filler: any text, as only its length counts. */
function isPad(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_MESSAGE_LENGTH
}

/** A player token as browsers make them: random letters, digits and dashes. */
export function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value)
}

/** A new random token, for a browser to keep (see `HostRoom`). */
export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}
