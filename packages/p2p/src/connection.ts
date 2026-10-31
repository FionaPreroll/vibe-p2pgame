import type { Channel } from './channel.ts'

/**
 * A connection between a host and a player, whatever carries it: WebRTC (`createOffer`), a
 * message transport such as Bluetooth (`packetConnection`), or memory in tests (`linkPair`).
 * Rooms work on this alone, so a game can let each player choose how to connect.
 */
export type ConnectionState = 'connecting' | 'open' | 'closed'

export interface Connection {
  /** Reliable and ordered: for messages that must arrive. */
  readonly control: Channel
  /** For input and state, where only the newest message counts; it may drop or reorder. */
  readonly fast: Channel
  readonly state: ConnectionState
  /** Calls back whenever `state` may have changed. */
  onStateChange(listener: () => void): void
  close(): void
  /**
   * The least time between two states a host sends on this connection, in milliseconds, for
   * transports slower than a Wi-Fi: a host then sends this player fewer states, and the others
   * as many as before.
   */
  readonly minStateIntervalMs?: number
}

/** Resolves once the connection is open, and rejects if it closes or times out first. */
export function opened(connection: Connection, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => settle(new Error('Connection timed out')), timeoutMs)
    function settle(error?: Error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const check = () => {
      if (connection.state === 'open') settle()
      else if (connection.state === 'closed') settle(new Error('Connection failed'))
    }
    connection.onStateChange(check)
    check()
  })
}

/** Calls back once when the other side is gone: closed, failed or out of reach. */
export function onLost(connection: Connection, callback: () => void): void {
  let lost = false
  const check = () => {
    if (lost || connection.state !== 'closed') return
    lost = true
    callback()
  }
  connection.onStateChange(check)
  check()
}
