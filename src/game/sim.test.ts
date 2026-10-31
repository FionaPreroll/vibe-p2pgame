import { describe, expect, it } from 'vitest'
import {
  ARENA,
  addPlayer,
  createWorld,
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
    world.sparks = [{ id: 99, x: 500, y: 500, gold: false }]
    Object.assign(near, { x: 500 + 10, y: 500 })
    Object.assign(far, { x: 500 - 20, y: 500 })
    const catches = step(world, still, 0.01)
    expect(catches).toEqual([{ playerId: 0, gold: false }])
    expect(near.score).toBe(1)
    expect(far.score).toBe(0)
    expect(world.sparks.map((s) => s.id)).not.toContain(99)
    expect(world.sparks).toHaveLength(sparkCount(2))
  })

  it('counts a golden spark three times', () => {
    const world = createWorld(3)
    const player = addPlayer(world, 0, 'Ada')
    world.sparks = [{ id: 99, x: player.x, y: player.y, gold: true }]
    expect(step(world, still, 0.01)).toEqual([{ playerId: 0, gold: true }])
    expect(player.score).toBe(3)
  })

  it('ends a round after its time, and then nobody scores', () => {
    const world = createWorld(5)
    const player = addPlayer(world, 0, 'Ada')
    player.score = 4
    startRound(world)
    expect(world).toMatchObject({ phase: 'play', timeLeft: ROUND_SECONDS })
    expect(player.score).toBe(0)
    step(world, still, ROUND_SECONDS - 1)
    expect(world.phase).toBe('play')
    step(world, still, 2)
    expect(world).toMatchObject({ phase: 'over', timeLeft: 0, sparks: [] })
    step(world, still, 1)
    expect(world.sparks).toEqual([])
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
  })
})
