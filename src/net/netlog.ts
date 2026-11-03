import type { ConnectionDetails } from '@fionapreroll/p2p'
import type { NetLog } from '@fionapreroll/p2p/debug'
import type { ConnectionTest, ConnectionTestRun } from '@fionapreroll/p2p/room'

/**
 * The connections of the game played last, or now, on this phone, for the debug report: the
 * room's samples (see `NetLog` in `@fionapreroll/p2p/debug`), what each connection's transport
 * tells while it lasts, and the last connection test. The sessions say which is the newest.
 */
export interface NetSource {
  readonly net: NetLog
  /** The other phones still connected, by player id. */
  peers(): readonly number[]
  details(peer: number): Promise<ConnectionDetails | null>
  lastTest(): ConnectionTestRun | ConnectionTest | null
}

let latest: NetSource | null = null

/** A new game began: its connections are the ones the report tells from now on. */
export function rememberNet(source: NetSource): void {
  latest = source
}

/** The connections of the game played last, or now; null before the first. */
export function latestNet(): NetSource | null {
  return latest
}
