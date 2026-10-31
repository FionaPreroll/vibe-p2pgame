import { readJson, remove, writeJson } from '../storage'
import type { Seat } from './seats'

/** Saved games older than this are not offered any more. */
export const MAX_AGE_MS = 12 * 60 * 60 * 1000

/**
 * This browser's player token. The host knows a returning player by it, so it stays the same
 * for as long as the browser keeps its storage. It is not secret: it only finds a seat again.
 */
export function playerToken(): string {
  const stored = readJson('token')
  if (typeof stored === 'string' && stored.length >= 8) return stored
  const token = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  writeJson('token', token)
  return token
}

/** The game this phone last joined, to rejoin it after dropping out. */
export interface JoinedGame {
  readonly host: string
  readonly savedAt: number
}

export function rememberJoinedGame(host: string): void {
  writeJson('joined', { host, savedAt: Date.now() } satisfies JoinedGame)
}

export function joinedGame(now = Date.now()): JoinedGame | null {
  return parseJoinedGame(readJson('joined'), now)
}

export function forgetJoinedGame(): void {
  remove('joined')
}

export function parseJoinedGame(stored: unknown, now: number): JoinedGame | null {
  if (!isObject(stored) || typeof stored.host !== 'string' || !fresh(stored.savedAt, now)) {
    return null
  }
  return { host: stored.host, savedAt: stored.savedAt as number }
}

/**
 * The game this phone hosts, saved as it goes: if the page is closed or reloaded, the host
 * can carry on with the same players and scores, once they have scanned codes again.
 */
export interface HostedGame {
  readonly savedAt: number
  readonly hostScore: number
  /** Every other player, connected at the time or away. */
  readonly players: readonly Seat[]
  readonly nextId: number
}

export function saveHostedGame(game: Omit<HostedGame, 'savedAt'>): void {
  writeJson('hosted', { ...game, savedAt: Date.now() })
}

export function hostedGame(now = Date.now()): HostedGame | null {
  return parseHostedGame(readJson('hosted'), now)
}

export function forgetHostedGame(): void {
  remove('hosted')
}

export function parseHostedGame(stored: unknown, now: number): HostedGame | null {
  if (!isObject(stored) || !fresh(stored.savedAt, now)) return null
  if (!Array.isArray(stored.players) || !isCount(stored.nextId) || !isCount(stored.hostScore)) {
    return null
  }
  const players: Seat[] = []
  for (const p of stored.players) {
    if (
      !isObject(p) ||
      typeof p.token !== 'string' ||
      typeof p.name !== 'string' ||
      !isCount(p.id) ||
      p.id === 0 ||
      !isCount(p.score)
    ) {
      return null
    }
    players.push({ token: p.token, id: p.id, name: p.name, score: p.score })
  }
  return {
    savedAt: stored.savedAt as number,
    hostScore: stored.hostScore,
    players,
    nextId: stored.nextId,
  }
}

function fresh(savedAt: unknown, now: number): boolean {
  return typeof savedAt === 'number' && savedAt <= now && now - savedAt < MAX_AGE_MS
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
