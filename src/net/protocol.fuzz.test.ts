import { cleanName, MAX_NAME_LENGTH } from '@fionapreroll/p2p'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ARENA, MAX_PLAYERS, type Snapshot } from '../game/sim'
import { parseInput, parseSnapshot } from './protocol'

/** Values a hostile phone may send in place of a field: anything JSON can carry, and worse. */
const field = fc.oneof(
  fc.jsonValue(),
  fc.double(),
  fc.integer(),
  fc.string(),
  fc.constantFrom(Number.NaN, Infinity, -Infinity, -0, 1e308, Number.MAX_SAFE_INTEGER + 2, null),
  fc.constantFrom('__proto__', 'constructor', '‮', '\u0000', 'x'.repeat(5000)),
)
/** A snapshot as an honest host sends it. */
const coordinate = fc.integer({ min: 0, max: ARENA })
const honestSnapshot: fc.Arbitrary<Snapshot> = fc.record({
  phase: fc.constantFrom('lobby', 'countdown', 'play', 'over'),
  timeLeft: fc.double({ min: 0, max: 120, noNaN: true }),
  players: fc.uniqueArray(
    fc.record({
      id: fc.nat(100),
      name: fc.string({ minLength: 1, maxLength: MAX_NAME_LENGTH }).map((n) => cleanName(n, '?')),
      x: coordinate,
      y: coordinate,
      score: fc.integer({ min: -100, max: 100 }),
      ping: fc.option(fc.nat(1000), { nil: null }),
      caught: fc.nat(50),
      gold: fc.nat(10),
      hits: fc.nat(10),
      ready: fc.boolean(),
    }),
    { maxLength: MAX_PLAYERS, selector: (p) => p.id },
  ),
  sparks: fc.array(fc.record({ id: fc.nat(), x: coordinate, y: coordinate, gold: fc.boolean() }), {
    maxLength: 20,
  }),
  mines: fc.array(
    fc.record({
      id: fc.nat(),
      x: coordinate,
      y: coordinate,
      armIn: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    { maxLength: 8 },
  ),
  blasts: fc.array(
    fc.record({
      id: fc.nat(),
      x: coordinate,
      y: coordinate,
      playerId: fc.nat(100),
      age: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    { maxLength: 8 },
  ),
  away: fc.array(fc.record({ id: fc.nat(100), name: fc.constantFrom('Ada', 'Bo') }), {
    maxLength: 4,
  }),
  watching: fc.array(fc.record({ id: fc.nat(100), name: fc.constantFrom('Cy', 'Di') }), {
    maxLength: 4,
  }),
})

/** Sets one place in a value, found by a path of keys and indexes, to something else. */
function mutate(value: unknown, path: readonly number[], replacement: unknown): unknown {
  if (path.length === 0 || typeof value !== 'object' || value === null) return replacement
  const keys = Object.keys(value)
  if (keys.length === 0) return replacement
  const key = keys[(path[0] ?? 0) % keys.length] as string
  const copy = (Array.isArray(value) ? [...value] : { ...value }) as Record<string, unknown>
  copy[key] = mutate((value as Record<string, unknown>)[key], path.slice(1), replacement)
  return copy
}

function expectSound(snapshot: Snapshot): void {
  expect(snapshot.players.length).toBeLessThanOrEqual(MAX_PLAYERS)
  expect(new Set(snapshot.players.map((p) => p.id)).size).toBe(snapshot.players.length)
  for (const thing of [
    ...snapshot.players,
    ...snapshot.sparks,
    ...snapshot.mines,
    ...snapshot.blasts,
  ]) {
    expect(thing.x >= 0 && thing.x <= ARENA && thing.y >= 0 && thing.y <= ARENA).toBe(true)
  }
  for (const p of snapshot.players) {
    expect(Number.isSafeInteger(p.score)).toBe(true)
    expect(cleanName(p.name, '?')).toBe(p.name)
  }
}

describe('parsers, fuzzed', () => {
  it('never throw, whatever arrives', () => {
    fc.assert(
      fc.property(fc.oneof(fc.anything(), field), (value) => {
        parseInput(value)
        parseSnapshot(value)
      }),
      { numRuns: 2000 },
    )
  })

  it('give the host only targets in the arena, or none, and true switches', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.record({
            target: fc.oneof(fc.record({ x: field, y: field }), field),
            ready: fc.oneof(fc.boolean(), field),
            watch: fc.oneof(fc.boolean(), field),
          }),
          fc.dictionary(fc.constantFrom('target', 'ready', 'watch', 'x', 'y'), field),
          field,
        ),
        (value) => {
          const input = parseInput(JSON.parse(JSON.stringify(value) ?? 'null'))
          if (input) {
            expect(typeof input.ready === 'boolean' && typeof input.watch === 'boolean').toBe(true)
            for (const v of input.target ? [input.target.x, input.target.y] : [])
              expect(Number.isFinite(v) && v >= 0 && v <= ARENA).toBe(true)
          }
        },
      ),
      { numRuns: 2000 },
    )
    const input = (target: string) =>
      parseInput(JSON.parse(`{"target":${target},"ready":false,"watch":false}`))
    expect(input('{"x":1e999,"y":1}')).toBeUndefined()
    expect(input('null')).toEqual({ target: null, ready: false, watch: false })
    expect(input('{"x":-5,"y":2000}')?.target).toEqual({ x: 0, y: ARENA })
    expect(parseInput(null)).toBeUndefined()
    // The input of the version before, a bare target, is no input now.
    expect(parseInput({ x: 1, y: 2 })).toBeUndefined()
  })

  it('accept every honest snapshot unchanged', () => {
    fc.assert(
      fc.property(honestSnapshot, (snapshot) => {
        expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
      }),
      { numRuns: 500 },
    )
  })

  it('turn any damaged snapshot into a sound one or none', () => {
    fc.assert(
      fc.property(
        honestSnapshot,
        fc.array(fc.nat(), { maxLength: 4 }),
        field,
        (snapshot, path, value) => {
          const damaged = JSON.parse(JSON.stringify(mutate(snapshot, path, value)) ?? 'null')
          const parsed = parseSnapshot(damaged)
          if (parsed !== undefined) {
            expectSound(parsed)
            // Reading a sound snapshot again changes nothing.
            expect(parseSnapshot(parsed)).toEqual(parsed)
          }
        },
      ),
      { numRuns: 3000 },
    )
  })
})
