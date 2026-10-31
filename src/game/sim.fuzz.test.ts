import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  ARENA,
  addPlayer,
  createWorld,
  MAX_PLAYERS,
  mineCount,
  PLAYER_RADIUS,
  removePlayer,
  sparkCount,
  startRound,
  step,
  type Target,
} from './sim'

const coordinate = fc.oneof(
  fc.double({ min: -2 * ARENA, max: 3 * ARENA, noNaN: true }),
  fc.constantFrom(Number.NaN, Infinity, -Infinity, 1e308, -1e308),
)
const action = fc.oneof(
  fc.record({
    kind: fc.constant('step' as const),
    dt: fc.double({ min: 0, max: 0.5, noNaN: true }),
  }),
  fc.record({
    kind: fc.constant('steer' as const),
    id: fc.nat(MAX_PLAYERS - 1),
    target: fc.option(fc.record({ x: coordinate, y: coordinate }), { nil: null }),
  }),
  fc.record({ kind: fc.constant('join' as const), id: fc.nat(MAX_PLAYERS - 1) }),
  fc.record({ kind: fc.constant('leave' as const), id: fc.nat(MAX_PLAYERS - 1) }),
  fc.record({ kind: fc.constant('start' as const), seconds: fc.integer({ min: 1, max: 120 }) }),
)

describe('the rules, fuzzed', () => {
  it('keep every game sound, whatever players do', () => {
    fc.assert(
      fc.property(fc.integer(), fc.array(action, { maxLength: 200 }), (seed, actions) => {
        const world = createWorld(seed)
        const targets = new Map<number, Target>()
        let seconds = 60
        for (const a of actions) {
          if (a.kind === 'step') {
            const before = new Map(world.players.map((p) => [p.id, p.score]))
            const catches = step(world, targets, a.dt)
            // Every point won or lost is accounted for.
            for (const p of world.players) {
              const change = catches
                .filter((c) => c.playerId === p.id)
                .reduce((sum, c) => sum + c.points, 0)
              expect(p.score - (before.get(p.id) ?? 0)).toBe(change)
            }
          } else if (a.kind === 'steer') {
            targets.set(a.id, a.target)
          } else if (a.kind === 'join') {
            if (!world.players.some((p) => p.id === a.id)) addPlayer(world, a.id, `P${a.id}`)
          } else if (a.kind === 'leave') {
            removePlayer(world, a.id)
          } else {
            seconds = a.seconds
            startRound(world, seconds)
          }
          for (const p of world.players) {
            expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
            expect(p.x >= PLAYER_RADIUS && p.x <= ARENA - PLAYER_RADIUS).toBe(true)
            expect(p.y >= PLAYER_RADIUS && p.y <= ARENA - PLAYER_RADIUS).toBe(true)
            expect(Number.isSafeInteger(p.score)).toBe(true)
          }
          for (const thing of [...world.sparks, ...world.mines, ...world.blasts]) {
            expect(thing.x >= 0 && thing.x <= ARENA && thing.y >= 0 && thing.y <= ARENA).toBe(true)
          }
          expect(world.timeLeft >= 0 && world.timeLeft <= Math.max(seconds, 60)).toBe(true)
          if (a.kind === 'step' && world.phase !== 'over') {
            // Players who leave leave their sparks and mines behind, until they are taken.
            expect(world.sparks.length).toBeGreaterThanOrEqual(sparkCount(world.players.length))
            expect(world.sparks.length).toBeLessThanOrEqual(sparkCount(MAX_PLAYERS))
            expect(world.mines.length).toBeGreaterThanOrEqual(mineCount(world.players.length))
            expect(world.mines.length).toBeLessThanOrEqual(mineCount(MAX_PLAYERS))
          }
          if (world.phase === 'over') expect(world.sparks.length + world.mines.length).toBe(0)
          const ids = [...world.sparks, ...world.mines, ...world.blasts].map((t) => t.id)
          expect(new Set(ids).size).toBe(ids.length)
        }
      }),
      { numRuns: 500 },
    )
  })
})
