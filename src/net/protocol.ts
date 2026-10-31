import type { Snapshot } from '../game/sim'

/**
 * The version of the messages and snapshots. Phones update the game in the background, so a
 * host and a player can run different versions; a player whose version differs is not let in,
 * as it would not show everything the host's game has, such as mines.
 */
export const PROTOCOL = 2

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

export function send(channel: RTCDataChannel, message: ToHost | ToGuest): void {
  if (channel.readyState === 'open') channel.send(JSON.stringify(message))
}

/**
 * Calls back with every message that arrives on a channel. The other phone is trusted no
 * further than its JSON parsing: anything that is not an object with a type is dropped.
 */
export function listen<T extends { type: string }>(
  channel: RTCDataChannel,
  callback: (message: T) => void,
): void {
  channel.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return
    let message: unknown
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }
    if (typeof message === 'object' && message !== null && 'type' in message) {
      callback(message as T)
    }
  })
}
