import { describe, expect, it } from 'vitest'
import {
  ARENA,
  addPlayer,
  allReady,
  BLAST_SECONDS,
  COUNTDOWN_SECONDS,
  createWorld,
  MINE_ARM_SECONDS,
  MINE_PENALTY,
  MINE_RADIUS,
  mineCount,
  PLAYER_RADIUS,
  ROUND_SECONDS,
  removePlayer,
  SPEED,
  sparkCount,
  startRound,
  step,
  type Target,
  winners,
} from './sim'

const still = new Map<number, Target>()

describe('step', () => {
  it('moves a player toward its target at a fixed speed, and stops there', () => {
    const world = createWorld(1)
    const player = addPlayer(world, 0, 'Ada')
    const target = { x: player.x, y: player.y + 300 }
    step(world, new Map([[0, target]]), 0.5)
    expect(player.y).toBeCloseTo(target.y - 300 + SPEED * 0.5)
    step(world, new Map([[0, target]]), 1)
    expect(player).toMatchObject(target)
  })

  it('keeps players inside the arena', () => {
    const world = createWorld(1)
    const player = addPlayer(world, 0, 'Ada')
    step(world, new Map([[0, { x: -500, y: ARENA + 500 }]]), 10)
    expect(player.x).toBe(PLAYER_RADIUS)
    expect(player.y).toBe(ARENA - PLAYER_RADIUS)
  })

  it('keeps sparks on the board, more with more players', () => {
    const world = createWorld(7)
    addPlayer(world, 0, 'Ada')
    step(world, still, 0.01)
    expect(world.sparks).toHaveLength(sparkCount(1))
    addPlayer(world, 1, 'Bo')
    step(world, still, 0.01)
    expect(world.sparks).toHaveLength(sparkCount(2))
  })

  it('gives a spark to the nearest player who touches it and puts a new one down', () => {
    const world = createWorld(3)
    const near = addPlayer(world, 0, 'Ada')
    const far = addPlayer(world, 1, 'Bo')
    startRound(world, ROUND_SECONDS, 0)
    world.sparks = [{ id: 99, x: 500, y: 500, gold: false }]
    Object.assign(near, { x: 500 + 10, y: 500 })
    Object.assign(far, { x: 500 - 20, y: 500 })
    const catches = step(world, still, 0.01)
    expect(catches).toEqual([{ playerId: 0, points: 1 }])
    expect(near.score).toBe(1)
    expect(far.score).toBe(0)
    expect(world.sparks.map((s) => s.id)).not.toContain(99)
    expect(world.sparks).toHaveLength(sparkCount(2))
  })

  it('counts a golden spark three times', () => {
    const world = createWorld(3)
    const player = addPlayer(world, 0, 'Ada')
    startRound(world, ROUND_SECONDS, 0)
    world.sparks = [{ id: 99, x: player.x, y: player.y, gold: true }]
    expect(step(world, still, 0.01)).toEqual([{ playerId: 0, points: 3 }])
    expect(player.score).toBe(3)
  })

  it('counts nothing in free play, before the first round', () => {
    const world = createWorld(3)
    const player = addPlayer(world, 0, 'Ada')
    player.score = 5
    world.sparks = [{ id: 98, x: player.x, y: player.y, gold: true }]
    world.mines = [{ id: 99, x: player.x + MINE_RADIUS, y: player.y, armIn: 0 }]
    const catches = step(world, still, 0.01)
    expect(world.phase).toBe('lobby')
    expect(catches).toEqual([
      { playerId: 0, points: 0 },
      { playerId: 0, points: 0 },
    ])
    expect(player.score).toBe(5)
    expect(world.sparks.map((s) => s.id)).not.toContain(98)
    expect(world.blasts).toHaveLength(1)
  })

  it('ends a round after its time, and then nobody scores', () => {
    const world = createWorld(5)
    const player = addPlayer(world, 0, 'Ada')
    player.score = 4
    startRound(world, ROUND_SECONDS, 0)
    expect(world).toMatchObject({ phase: 'play', timeLeft: ROUND_SECONDS })
    expect(player.score).toBe(0)
    step(world, still, ROUND_SECONDS - 1)
    expect(world.phase).toBe('play')
    step(world, still, 2)
    expect(world).toMatchObject({ phase: 'over', timeLeft: 0, sparks: [], mines: [] })
    step(world, still, 1)
    expect(world.sparks).toEqual([])
  })

  it('counts down before a round, with nothing on the board, then plays its full length', () => {
    const world = createWorld(5)
    const player = addPlayer(world, 0, 'Ada')
    startRound(world, 30)
    expect(world).toMatchObject({ phase: 'countdown', timeLeft: COUNTDOWN_SECONDS })
    const target = { x: player.x + 100, y: player.y }
    step(world, new Map([[0, target]]), 1)
    // The dots move, but nothing is put down yet.
    expect(player.x).toBeGreaterThan(target.x - 100)
    expect(world.sparks).toEqual([])
    expect(world.mines).toEqual([])
    step(world, still, COUNTDOWN_SECONDS)
    expect(world).toMatchObject({ phase: 'play', timeLeft: 30 })
    step(world, still, 0.01)
    expect(world.sparks.length).toBeGreaterThan(0)
  })

  it('keeps every player’s sparks, gold and mines of the round, and clears them anew', () => {
    const world = createWorld(3)
    const player = addPlayer(world, 0, 'Ada')
    startRound(world, ROUND_SECONDS, 0)
    world.sparks = [
      { id: 97, x: player.x, y: player.y, gold: true },
      { id: 98, x: player.x, y: player.y, gold: false },
    ]
    world.mines = [{ id: 99, x: player.x, y: player.y, armIn: 0 }]
    step(world, still, 0.01)
    expect(player).toMatchObject({ caught: 2, gold: 1, hits: 1, score: 2 })
    player.ready = true
    startRound(world)
    expect(player).toMatchObject({ caught: 0, gold: 0, hits: 0, score: 0, ready: false })
  })

  it('knows when everyone but the host is ready, and that the host alone is not', () => {
    const world = createWorld(3)
    addPlayer(world, 0, 'Host')
    expect(allReady(world)).toBe(false)
    const a = addPlayer(world, 1, 'Ada')
    const b = addPlayer(world, 2, 'Bo')
    a.ready = true
    expect(allReady(world)).toBe(false)
    b.ready = true
    expect(allReady(world)).toBe(true)
  })

  it('lasts as long as the host chose', () => {
    const world = createWorld(5)
    addPlayer(world, 0, 'Ada')
    startRound(world, 30, 0)
    step(world, still, 29)
    expect(world.phase).toBe('play')
    step(world, still, 2)
    expect(world.phase).toBe('over')
  })

  it('replays the same sparks from the same seed', () => {
    const run = () => {
      const world = createWorld(42)
      addPlayer(world, 0, 'Ada')
      step(world, still, 0.01)
      return world.sparks
    }
    expect(run()).toEqual(run())
  })
})

describe('mines', () => {
  it('lie on the board, more with more players, apart from players and sparks', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const world = createWorld(seed)
      for (let id = 0; id < 4; id++) addPlayer(world, id, `P${id}`)
      step(world, still, 0.01)
      expect(world.mines).toHaveLength(mineCount(4))
      for (const mine of world.mines) {
        for (const p of world.players)
          expect(Math.hypot(p.x - mine.x, p.y - mine.y)).toBeGreaterThan(150)
        for (const s of world.sparks)
          expect(Math.hypot(s.x - mine.x, s.y - mine.y)).toBeGreaterThan(50)
      }
    }
    expect(mineCount(1)).toBeLessThan(mineCount(8))
  })

  it('are harmless while they arm', () => {
    const world = createWorld(3)
    const player = addPlayer(world, 0, 'Ada')
    world.mines = [{ id: 99, x: player.x, y: player.y, armIn: MINE_ARM_SECONDS }]
    step(world, still, MINE_ARM_SECONDS / 2)
    expect(player.score).toBe(0)
    expect(world.mines.map((m) => m.id)).toContain(99)
  })

  it('cost points when touched, below zero too, and go off elsewhere anew', () => {
    const world = createWorld(3)
    const victim = addPlayer(world, 0, 'Ada')
    const other = addPlayer(world, 1, 'Bo')
    startRound(world, ROUND_SECONDS, 0)
    world.mines = [{ id: 99, x: victim.x + MINE_RADIUS, y: victim.y, armIn: 0 }]
    Object.assign(other, { x: victim.x + MINE_RADIUS * 2 + 20, y: victim.y })
    const catches = step(world, still, 0.01)
    expect(catches).toEqual([{ playerId: 0, points: -MINE_PENALTY }])
    expect(victim.score).toBe(-MINE_PENALTY)
    expect(other.score).toBe(0)
    expect(world.blasts).toMatchObject([{ playerId: 0, x: victim.x + MINE_RADIUS, y: victim.y }])
    expect(world.mines.map((m) => m.id)).not.toContain(99)
    expect(world.mines).toHaveLength(mineCount(2))
    expect(world.mines.every((m) => m.armIn > 0)).toBe(true)
  })

  it('leave a blast that fades', () => {
    const world = createWorld(3)
    const player = addPlayer(world, 0, 'Ada')
    world.mines = [{ id: 99, x: player.x, y: player.y, armIn: 0 }]
    step(world, still, 0.01)
    expect(world.blasts).toHaveLength(1)
    step(world, still, BLAST_SECONDS)
    expect(world.blasts).toEqual([])
  })

  it('are cleared when a round starts', () => {
    const world = createWorld(3)
    addPlayer(world, 0, 'Ada')
    step(world, still, 0.01)
    expect(world.mines.length).toBeGreaterThan(0)
    startRound(world, ROUND_SECONDS, 0)
    expect(world.mines).toEqual([])
  })
})

describe('players', () => {
  it('start apart and can leave', () => {
    const world = createWorld(1)
    const a = addPlayer(world, 0, 'Ada')
    const b = addPlayer(world, 1, 'Bo')
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(PLAYER_RADIUS * 2)
    removePlayer(world, 0)
    expect(world.players).toEqual([b])
  })

  it('win with the top score, together on a tie, and not with nothing', () => {
    const world = createWorld(1)
    const a = addPlayer(world, 0, 'Ada')
    const b = addPlayer(world, 1, 'Bo')
    expect(winners(world.players)).toEqual([])
    a.score = 2
    expect(winners(world.players)).toEqual([a])
    b.score = 2
    expect(winners(world.players)).toEqual([a, b])
    a.score = -2
    b.score = -4
    expect(winners(world.players)).toEqual([])
  })
})
