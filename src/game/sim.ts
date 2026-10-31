/**
 * The rules of Spark Hunt, as pure TypeScript. The host runs them; the other phones only draw
 * the snapshots the host sends.
 *
 * Every player steers a glowing dot toward the spot they touch. Sparks appear around the arena:
 * whoever reaches one first scores, a golden spark counts three. The round ends after a minute.
 */

export const ARENA = 1000
export const ROUND_SECONDS = 60
export const PLAYER_RADIUS = 30
export const SPARK_RADIUS = 16
/** Arena units per second. */
export const SPEED = 450
export const MAX_PLAYERS = 8
const GOLD_CHANCE = 1 / 8
const GOLD_VALUE = 3

export type Phase = 'lobby' | 'play' | 'over'

export interface Player {
  readonly id: number
  name: string
  x: number
  y: number
  score: number
  /** Round trip time to the host in milliseconds, as the player last measured it. */
  ping: number | null
}

export interface Spark {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly gold: boolean
}

/** Where a player wants to go, in arena units, or null to stay. */
export type Target = { readonly x: number; readonly y: number } | null

/** What the host sends to every player, many times a second. */
export interface Snapshot {
  phase: Phase
  timeLeft: number
  players: Player[]
  sparks: Spark[]
  /** Players who dropped out and may rejoin. The host fills this in; the rules ignore it. */
  away?: { id: number; name: string }[]
}

export interface World extends Snapshot {
  nextSpark: number
  seed: number
}

export interface Catch {
  readonly playerId: number
  readonly gold: boolean
}

export function createWorld(seed: number): World {
  return { phase: 'lobby', timeLeft: ROUND_SECONDS, players: [], sparks: [], nextSpark: 1, seed }
}

export function addPlayer(world: World, id: number, name: string): Player {
  // Around a circle in the middle, so nobody starts on top of another player.
  const angle = (id / MAX_PLAYERS) * Math.PI * 2
  const player: Player = {
    id,
    name,
    x: ARENA / 2 + Math.cos(angle) * ARENA * 0.25,
    y: ARENA / 2 + Math.sin(angle) * ARENA * 0.25,
    score: 0,
    ping: null,
  }
  world.players.push(player)
  return player
}

export function removePlayer(world: World, id: number): void {
  world.players = world.players.filter((p) => p.id !== id)
}

export function startRound(world: World, seconds = ROUND_SECONDS): void {
  world.phase = 'play'
  world.timeLeft = seconds
  world.sparks = []
  for (const player of world.players) player.score = 0
}

/** The number of sparks on the board: more players, more sparks. */
export function sparkCount(players: number): number {
  return 3 + players
}

/** Moves the world on by `dt` seconds and returns the sparks caught on the way. */
export function step(world: World, targets: ReadonlyMap<number, Target>, dt: number): Catch[] {
  for (const player of world.players) move(player, targets.get(player.id) ?? null, dt)
  if (world.phase === 'over') return []
  if (world.phase === 'play') {
    world.timeLeft = Math.max(0, world.timeLeft - dt)
    if (world.timeLeft === 0) {
      world.phase = 'over'
      world.sparks = []
      return []
    }
  }
  const catches: Catch[] = []
  world.sparks = world.sparks.filter((spark) => {
    const catcher = nearestInReach(world.players, spark)
    if (catcher === undefined) return true
    catcher.score += spark.gold ? GOLD_VALUE : 1
    catches.push({ playerId: catcher.id, gold: spark.gold })
    return false
  })
  while (world.sparks.length < sparkCount(world.players.length)) world.sparks.push(newSpark(world))
  return catches
}

/** The winners of a round: everyone with the top score, or nobody if nobody scored. */
export function winners(players: readonly Player[]): Player[] {
  const best = Math.max(0, ...players.map((p) => p.score))
  return best === 0 ? [] : players.filter((p) => p.score === best)
}

/** The nearest player who touches a spark, so two players at once is still fair. */
function nearestInReach(players: readonly Player[], spark: Spark): Player | undefined {
  let nearest: Player | undefined
  let nearestDistance = PLAYER_RADIUS + SPARK_RADIUS
  for (const player of players) {
    const distance = Math.hypot(player.x - spark.x, player.y - spark.y)
    if (distance <= nearestDistance) {
      nearest = player
      nearestDistance = distance
    }
  }
  return nearest
}

function move(player: Player, target: Target, dt: number): void {
  if (target === null) return
  const dx = target.x - player.x
  const dy = target.y - player.y
  const distance = Math.hypot(dx, dy)
  const reach = SPEED * dt
  if (distance <= reach) {
    player.x = target.x
    player.y = target.y
  } else {
    player.x += (dx / distance) * reach
    player.y += (dy / distance) * reach
  }
  player.x = clamp(player.x, PLAYER_RADIUS, ARENA - PLAYER_RADIUS)
  player.y = clamp(player.y, PLAYER_RADIUS, ARENA - PLAYER_RADIUS)
}

function newSpark(world: World): Spark {
  const margin = SPARK_RADIUS * 3
  return {
    id: world.nextSpark++,
    x: margin + random(world) * (ARENA - 2 * margin),
    y: margin + random(world) * (ARENA - 2 * margin),
    gold: random(world) < GOLD_CHANCE,
  }
}

/** Mulberry32: a small seeded generator, so tests can replay a round. */
function random(world: World): number {
  world.seed = (world.seed + 0x6d2b79f5) | 0
  let t = world.seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
