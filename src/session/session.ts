import type { Snapshot, Target } from '../game/sim'

/** What the game screen needs, whether this phone hosts the game or joined it. */
export interface Session {
  readonly isHost: boolean
  /** This phone's player id, once known. */
  selfId(): number | null
  snapshot(): Snapshot | null
  setTarget(target: Target): void
  target(): Target
  close(): void
}

/** A phone that sends nothing for this long is taken for gone, even if WebRTC has not noticed. */
export const SILENCE_MS = 8000
/** How often the host sends the state, and players their input. */
export const TICK_MS = 1000 / 30

/** A name as other players see it: short, single line, never empty. */
export function cleanName(name: unknown, fallback: string): string {
  const text = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 16) : ''
  return text || fallback
}
