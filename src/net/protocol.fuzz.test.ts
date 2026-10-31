import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ARENA, MAX_PLAYERS, type Snapshot } from '../game/sim'
import {
  cleanName,
  decode,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  parseSnapshot,
  parseToGuest,
  parseToHost,
} from './protocol'

/** Values a hostile phone may send in place of a field: anything JSON can carry, and worse. */
const field = fc.oneof(
  fc.jsonValue(),
  fc.double(),
  fc.integer(),
  fc.string(),
  fc.constantFrom(Number.NaN, Infinity, -Infinity, -0, 1e308, Number.MAX_SAFE_INTEGER + 2, null),
  fc.constantFrom('__proto__', 'constructor', '‮', '\u0000', 'x'.repeat(5000)),
)
const message = fc.dictionary(
  fc.constantFrom(
    'type',
    'name',
    'token',
    'version',
    'x',
    'y',
    'ping',
    'sent',
    'id',
    'host',
    'rejoined',
    'state',
  ),
  field,
)
const typed = fc
  .tuple(
    fc.constantFrom(
      'hello',
      'input',
      'ping',
      'welcome',
      'mismatch',
      'bye',
      'full',
      'state',
      'pong',
      'other',
    ),
    message,
  )
  .map(([type, rest]) => ({ ...rest, type }))

/** A snapshot as an honest host sends it. */
const coordinate = fc.integer({ min: 0, max: ARENA })
const honestSnapshot: fc.Arbitrary<Snapshot> = fc.record({
  phase: fc.constantFrom('lobby', 'play', 'over'),
  timeLeft: fc.double({ min: 0, max: 120, noNaN: true }),
  players: fc.uniqueArray(
    fc.record({
      id: fc.nat(100),
      name: fc.string({ minLength: 1, maxLength: MAX_NAME_LENGTH }).map((n) => cleanName(n, '?')),
      x: coordinate,
      y: coordinate,
      score: fc.integer({ min: -100, max: 100 }),
      ping: fc.option(fc.nat(1000), { nil: null }),
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
      fc.property(fc.oneof(fc.anything(), message, typed), (value) => {
        parseToHost(value)
        parseToGuest(value)
        parseSnapshot(value)
      }),
      { numRuns: 2000 },
    )
  })

  it('never throw on raw text, and drop anything too long', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: 'binary' }), fc.json()), (text) => {
        decode(text, parseToHost)
        decode(text, parseToGuest)
      }),
      { numRuns: 2000 },
    )
    const long = JSON.stringify({ type: 'ping', sent: 1, pad: 'x'.repeat(MAX_MESSAGE_LENGTH) })
    expect(decode(long, parseToHost)).toBeUndefined()
  })

  it('give the host only safe input', () => {
    fc.assert(
      fc.property(typed, (value) => {
        const parsed = parseToHost(JSON.parse(JSON.stringify(value)))
        if (parsed?.type === 'input') {
          expect((parsed.x === null) === (parsed.y === null)).toBe(true)
          for (const v of [parsed.x, parsed.y]) {
            if (v !== null) expect(Number.isFinite(v) && v >= 0 && v <= ARENA).toBe(true)
          }
          if (parsed.ping !== null) expect(parsed.ping >= 0 && parsed.ping <= 60_000).toBe(true)
        } else if (parsed?.type === 'hello') {
          expect(typeof parsed.name).toBe('string')
          expect(parsed.token === '' || /^[A-Za-z0-9-]{8,64}$/.test(parsed.token)).toBe(true)
          expect(typeof parsed.version).toBe('number')
        } else if (parsed?.type === 'ping') {
          expect(Number.isFinite(parsed.sent)).toBe(true)
        }
      }),
      { numRuns: 2000 },
    )
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

  it('make every name short, single line and printable', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.string({ unit: 'grapheme' }),
          fc.string({ unit: 'binary' }),
          field,
        ),
        (name) => {
          const clean = cleanName(name, '?')
          expect(clean.length).toBeGreaterThan(0)
          expect(Array.from(clean).length).toBeLessThanOrEqual(MAX_NAME_LENGTH)
          expect(clean).not.toMatch(/[\p{Cc}\p{Cf}\n\r\t]/u)
          expect(clean).toBe(clean.trim())
          expect(cleanName(clean, '?')).toBe(clean)
        },
      ),
      { numRuns: 2000 },
    )
  })
})
