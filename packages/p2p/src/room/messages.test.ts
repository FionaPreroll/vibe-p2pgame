import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { guestParser, hostParser, isToken, ROOM_PROTOCOL, randomToken } from './messages.ts'

/** A tiny game for the tests: input is a whole number from 0 to 9, state any string. */
const parseInput = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 9 ? (v as number) : undefined
const parseState = (v: unknown) => (typeof v === 'string' ? v : undefined)
const toHost = hostParser(parseInput)
const toGuest = guestParser(parseState)

const field = fc.oneof(
  fc.jsonValue(),
  fc.double(),
  fc.constantFrom(Number.NaN, Infinity, -Infinity, null, '__proto__', 'x'.repeat(5000)),
)
const message = fc
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
      'event',
      'other',
    ),
    fc.dictionary(
      fc.constantFrom(
        'name',
        'token',
        'room',
        'version',
        'data',
        'ping',
        'sent',
        'id',
        'host',
        'rejoined',
      ),
      field,
    ),
  )
  .map(([type, rest]) => ({ ...rest, type }))

describe('room messages', () => {
  it('read honest messages as they were sent', () => {
    const hello = {
      type: 'hello',
      name: 'Ada',
      token: 'token-12345678',
      room: ROOM_PROTOCOL,
      version: 3,
    }
    expect(toHost(hello)).toEqual(hello)
    expect(toHost({ type: 'input', data: 4, ping: 12 })).toEqual({
      type: 'input',
      data: 4,
      ping: 12,
    })
    expect(toHost({ type: 'ping', sent: 5 })).toEqual({ type: 'ping', sent: 5 })
    const welcome = {
      type: 'welcome',
      id: 2,
      host: 'Bo',
      rejoined: true,
      room: ROOM_PROTOCOL,
      version: 3,
    }
    expect(toGuest(welcome)).toEqual(welcome)
    expect(toGuest({ type: 'state', data: 'hi' })).toEqual({ type: 'state', data: 'hi' })
    for (const type of ['bye', 'full']) expect(toGuest({ type })).toEqual({ type })
  })

  it('drop the game’s part when its parser does, and the whole message with it', () => {
    expect(toHost({ type: 'input', data: 10, ping: 1 })).toBeUndefined()
    expect(toGuest({ type: 'state', data: 7 })).toBeUndefined()
  })

  it('make every field safe, whatever arrives', () => {
    fc.assert(
      fc.property(fc.oneof(fc.anything(), message), (value) => {
        const h = toHost(JSON.parse(JSON.stringify(value) ?? 'null'))
        if (h?.type === 'hello') {
          expect(h.token === '' || isToken(h.token)).toBe(true)
          expect(Number.isFinite(h.room) && Number.isFinite(h.version)).toBe(true)
          expect(h.name.length).toBeLessThanOrEqual(256)
        } else if (h?.type === 'input') {
          expect(parseInput(h.data)).toBe(h.data)
          expect(h.ping === null || (h.ping >= 0 && h.ping <= 60_000)).toBe(true)
        } else if (h?.type === 'ping') {
          expect(Number.isFinite(h.sent)).toBe(true)
        }
        const g = toGuest(value)
        if (g?.type === 'welcome') {
          expect(Number.isSafeInteger(g.id) && g.id >= 0).toBe(true)
          expect(typeof g.rejoined).toBe('boolean')
        } else if (g?.type === 'pong') {
          expect(Number.isFinite(g.sent)).toBe(true)
        }
      }),
      { numRuns: 3000 },
    )
  })

  it('make tokens that pass their own check', () => {
    const token = randomToken()
    expect(isToken(token)).toBe(true)
    expect(randomToken()).not.toBe(token)
    expect(isToken('short')).toBe(false)
    expect(isToken('has space in it')).toBe(false)
  })
})

describe('events', () => {
  const parseEvent = (v: unknown) => (typeof v === 'string' && v.length <= 10 ? v : undefined)

  it('are read only by a game that takes them, and only as the game checks them', () => {
    const event = { type: 'event', data: 'move-3' }
    expect(hostParser(parseInput, parseEvent)(event)).toEqual(event)
    expect(guestParser(parseState, parseEvent)(event)).toEqual(event)
    expect(
      hostParser(parseInput, parseEvent)({ type: 'event', data: 'x'.repeat(11) }),
    ).toBeUndefined()
    expect(guestParser(parseState, parseEvent)({ type: 'event' })).toBeUndefined()
    // A game without events takes none.
    expect(toHost(event)).toBeUndefined()
    expect(toGuest(event)).toBeUndefined()
  })
})
