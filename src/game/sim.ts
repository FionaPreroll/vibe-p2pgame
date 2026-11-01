/**
 * The rules of Spark Hunt, as pure TypeScript. The host runs them; the other phones only draw
 * the snapshots the host sends.
 *
 * Every player steers a glowing dot toward the spot they touch. Sparks appear around the arena:
 * whoever reaches one first scores, a golden spark counts three. Mines cost two points: touched,
 * one explodes and lays itself again elsewhere. A score can drop below zero. The round ends
 * after a minute.
 *
 * Before the first round is free play: everything works as in a round, but nothing counts.
 */

export const ARENA = 1000
export const ROUND_SECONDS = 60
export const PLAYER_RADIUS = 30
export const SPARK_RADIUS = 16
/** Arena units per second. */
export const SPEED = 450
export const MAX_PLAYERS = 8
export const MINE_RADIUS = 24
/** Points a player loses on touching a mine. */
export const MINE_PENALTY = 2
/** A new mine is harmless this long, and shows it, so nobody is hit without warning. */
export const MINE_ARM_SECONDS = 1
/** How long the flash of an exploding mine shows. */
export const BLAST_SECONDS = 0.8
const GOLD_CHANCE = 1 / 8
const GOLD_VALUE = 3
/** New mines keep this far from every player. */
const MINE_SAFE_DISTANCE = 180
/** New sparks and mines keep this far from mines, so no spark lies on a mine. */
const MINE_CLEARANCE = 70
const PLACEMENT_TRIES = 12

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

export interface Mine {
  readonly id: number
  readonly x: number
  readonly y: number
  /** Seconds until the mine is live; 0 when it is. */
  armIn: number
}

/** A mine going off, for players to see where points were lost, and whose. */
export interface Blast {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly playerId: number
  /** Seconds since the mine went off. */
  age: number
}

/** Where a player wants to go, in arena units, or null to stay. */
export type Target = { readonly x: number; readonly y: number } | null

/** What the host sends to every player, many times a second. */
export interface Snapshot {
  phase: Phase
  timeLeft: number
  players: Player[]
  sparks: Spark[]
  mines: Mine[]
  blasts: Blast[]
  /** Players who dropped out and may rejoin. The host fills this in; the rules ignore it. */
  away?: { id: number; name: string }[]
}

export interface World extends Snapshot {
  /** The id of the next spark, mine or blast. */
  nextId: number
  seed: number
}

/** Points won or lost: a spark caught, or a mine touched. */
export interface Catch {
  readonly playerId: number
  readonly points: number
}

export function createWorld(seed: number): World {
  return {
    phase: 'lobby',
    timeLeft: ROUND_SECONDS,
    players: [],
    sparks: [],
    mines: [],
    blasts: [],
    nextId: 1,
    seed,
  }
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
  world.mines = []
  world.blasts = []
  for (const player of world.players) player.score = 0
}

/** The number of sparks on the board: more players, more sparks. */
export function sparkCount(players: number): number {
  return 3 + players
}

/** The number of mines on the board: one, and one more for every two players. */
export function mineCount(players: number): number {
  return 1 + Math.floor(players / 2)
}

/**
 * Moves the world on by `dt` seconds and returns the points won and lost on the way. In free
 * play, before the first round, sparks are caught and mines go off as in a round, for 0 points.
 */
export function step(world: World, targets: ReadonlyMap<number, Target>, dt: number): Catch[] {
  for (const player of world.players) move(player, targets.get(player.id) ?? null, dt)
  for (const blast of world.blasts) blast.age += dt
  world.blasts = world.blasts.filter((blast) => blast.age < BLAST_SECONDS)
  if (world.phase === 'over') return []
  if (world.phase === 'play') {
    world.timeLeft = Math.max(0, world.timeLeft - dt)
    if (world.timeLeft === 0) {
      world.phase = 'over'
      world.sparks = []
      world.mines = []
      return []
    }
  }
  const counts = world.phase === 'play'
  const catches: Catch[] = []
  world.sparks = world.sparks.filter((spark) => {
    const catcher = nearestInReach(world.players, spark, SPARK_RADIUS)
    if (catcher === undefined) return true
    const points = counts ? (spark.gold ? GOLD_VALUE : 1) : 0
    catcher.score += points
    catches.push({ playerId: catcher.id, points })
    return false
  })
  world.mines = world.mines.filter((mine) => {
    mine.armIn = Math.max(0, mine.armIn - dt)
    if (mine.armIn > 0) return true
    const victim = nearestInReach(world.players, mine, MINE_RADIUS)
    if (victim === undefined) return true
    const points = counts ? -MINE_PENALTY : 0
    victim.score += points
    catches.push({ playerId: victim.id, points })
    world.blasts.push({ id: world.nextId++, x: mine.x, y: mine.y, playerId: victim.id, age: 0 })
    return false
  })
  while (world.mines.length < mineCount(world.players.length)) world.mines.push(newMine(world))
  while (world.sparks.length < sparkCount(world.players.length)) world.sparks.push(newSpark(world))
  return catches
}

/** The winners of a round: everyone with the top score, or nobody if nobody scored. */
export function winners(players: readonly Player[]): Player[] {
  const best = Math.max(0, ...players.map((p) => p.score))
  return best === 0 ? [] : players.filter((p) => p.score === best)
}

/** The nearest player who touches a thing, so two players at once is still fair. */
function nearestInReach(
  players: readonly Player[],
  thing: { readonly x: number; readonly y: number },
  radius: number,
): Player | undefined {
  let nearest: Player | undefined
  let nearestDistance = PLAYER_RADIUS + radius
  for (const player of players) {
    const distance = Math.hypot(player.x - thing.x, player.y - thing.y)
    if (distance <= nearestDistance) {
      nearest = player
      nearestDistance = distance
    }
  }
  return nearest
}

function move(player: Player, target: Target, dt: number): void {
  // The host checks every target it is sent; this keeps a position finite whatever comes.
  if (target === null || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return
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
  const { x, y } = place(world, SPARK_RADIUS * 3, () => 0)
  return { id: world.nextId++, x, y, gold: random(world) < GOLD_CHANCE }
}

function newMine(world: World): Mine {
  const { x, y } = place(world, MINE_RADIUS * 3, (point) =>
    Math.min(
      ...world.players.map((p) => Math.hypot(p.x - point.x, p.y - point.y) - MINE_SAFE_DISTANCE),
      ...world.sparks.map((s) => Math.hypot(s.x - point.x, s.y - point.y) - MINE_CLEARANCE),
    ),
  )
  return { id: world.nextId++, x, y, armIn: MINE_ARM_SECONDS }
}

/**
 * A random place in the arena, `margin` from its edges and clear of mines. `room` says how much
 * room a place has besides, below 0 for too little. The best of a few tries wins: on a crowded
 * board a place with too little room is better than none.
 */
function place(
  world: World,
  margin: number,
  room: (point: { x: number; y: number }) => number,
): { x: number; y: number } {
  let best = { x: ARENA / 2, y: ARENA / 2 }
  let bestRoom = Number.NEGATIVE_INFINITY
  for (let i = 0; i < PLACEMENT_TRIES; i++) {
    const point = {
      x: margin + random(world) * (ARENA - 2 * margin),
      y: margin + random(world) * (ARENA - 2 * margin),
    }
    const clearance = Math.min(
      room(point),
      ...world.mines.map((m) => Math.hypot(m.x - point.x, m.y - point.y) - MINE_CLEARANCE),
    )
    if (clearance >= 0) return point
    if (clearance > bestRoom) {
      best = point
      bestRoom = clearance
    }
  }
  return best
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
