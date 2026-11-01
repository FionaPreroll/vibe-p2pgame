import type { Snapshot, Target } from '../game/sim'
import type { NetLog } from '../net/netlog'

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
  close(): void
}
