import type { ConnectionDetails } from '@fionapreroll/p2p'
import type { NetLog } from '@fionapreroll/p2p/debug'
import type { ConnectionTest, ConnectionTestRun } from '@fionapreroll/p2p/room'
import type { Snapshot, Target } from '../game/sim'

/** What the game screen needs, whether this phone hosts the game or joined it. */
export interface Session {
  readonly isHost: boolean
  /** This phone's player id, once known. */
  selfId(): number | null
  snapshot(): Snapshot | null
  setTarget(target: Target): void
  target(): Target
  /** How well the connections keep up, sampled once a second. */
  readonly net: NetLog
  /** The other phones connected now, by player id: the host's players, or the host. */
  peers(): readonly number[]
  /** What the transport tells about the connection to one of them. */
  details(peer: number): Promise<ConnectionDetails | null>
  /** The last connection test: the host's run, or this player's result. */
  lastTest(): ConnectionTestRun | ConnectionTest | null
  /** On the host's phone: tests every player's connection. */
  testConnections?(): Promise<ConnectionTestRun>
  close(): void
}
