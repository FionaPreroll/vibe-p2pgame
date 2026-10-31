import { clamp, cleanName, inRange, isId, isNumber, isObject, list } from '@fionapreroll/p2p'
import {
  ARENA,
  type Blast,
  MAX_PLAYERS,
  type Mine,
  type Phase,
  type Player,
  type Snapshot,
  type Spark,
  type Target,
} from '../game/sim'

/**
 * Spark Hunt's input and state, as they travel inside the messages of `@fionapreroll/p2p`'s
 * room. The room checks its own messages; these parsers check the game's part, field by field.
 */

/**
 * The version of Spark Hunt's input and snapshots. Phones update the game in the background,
 * so a host and a player can run different versions; a player whose version differs is not
 * let in, as they would misread the host's snapshots.
 */
export const PROTOCOL = 3

/** The longest a round trip may honestly take to be shown, in milliseconds. */
const MAX_PING_MS = 60_000

/**
 * Where a player steers, or null. A target is both coordinates or none; they must be finite
 * (JSON reads 1e999 as Infinity) and are kept inside the arena.
 */
export function parseInput(value: unknown): Target | undefined {
  if (value === null) return null
  if (!isObject(value) || !isNumber(value.x) || !isNumber(value.y)) return undefined
  return { x: clamp(value.x, 0, ARENA), y: clamp(value.y, 0, ARENA) }
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
  if (!inRange(value.timeLeft, 0, 24 * 3600)) return undefined
  const players = list(value.players, MAX_PLAYERS, (p): Player | undefined =>
    isObject(p) && isId(p.id) && inArena(p.x) && inArena(p.y) && isScore(p.score)
      ? {
          id: p.id,
          name: cleanName(p.name, '?'),
          x: p.x,
          y: p.y,
          score: p.score,
          ping: inRange(p.ping, 0, MAX_PING_MS) ? p.ping : null,
        }
      : undefined,
  )
  const sparks = list(value.sparks, MAX_SPARKS, (s): Spark | undefined =>
    isObject(s) && isId(s.id) && inArena(s.x) && inArena(s.y) && typeof s.gold === 'boolean'
      ? { id: s.id, x: s.x, y: s.y, gold: s.gold }
      : undefined,
  )
  const mines = list(value.mines, MAX_MINES, (m): Mine | undefined =>
    isObject(m) && isId(m.id) && inArena(m.x) && inArena(m.y) && inRange(m.armIn, 0, 3600)
      ? { id: m.id, x: m.x, y: m.y, armIn: m.armIn }
      : undefined,
  )
  const blasts = list(value.blasts, MAX_BLASTS, (b): Blast | undefined =>
    isObject(b) &&
    isId(b.id) &&
    inArena(b.x) &&
    inArena(b.y) &&
    isId(b.playerId) &&
    inRange(b.age, 0, 3600)
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

function isScore(value: unknown): value is number {
  return Number.isSafeInteger(value) && Math.abs(value as number) <= MAX_SCORE
}

function inArena(value: unknown): value is number {
  return inRange(value, 0, ARENA)
}
