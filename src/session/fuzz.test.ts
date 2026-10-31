import { cleanName } from '@fionapreroll/p2p'
import { ROOM_PROTOCOL } from '@fionapreroll/p2p/room'
import { linkPair } from '@fionapreroll/p2p/testing'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARENA, MAX_PLAYERS, PLAYER_RADIUS } from '../game/sim'
import { PROTOCOL, parseSnapshot } from '../net/protocol'
import { GuestSession } from './guest'
import { HostSession } from './host'

/**
 * Hostile phones, made up by fast-check: whatever they send, in whatever order, the host and
 * the honest players keep a sound game.
 */

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

let tokens = 0
const token = () => `fuzz-token-${++tokens}`

const value = fc.oneof(
  fc.jsonValue(),
  fc.double(),
  fc.string(),
  fc.constantFrom(null, true, -1, 0, 1e308, '1e999', '‮', 'x'.repeat(3000)),
)
const fields = fc.dictionary(
  fc.constantFrom(
    'name',
    'token',
    'room',
    'version',
    'data',
    'x',
    'y',
    'ping',
    'sent',
    'id',
    'host',
    'rejoined',
    'state',
    'playerId',
  ),
  value,
)
/** One thing a hostile phone sends: raw text, or a message of a known type with odd fields. */
const hostileText = fc.oneof(
  fc.string(),
  fc.json(),
  fc
    .tuple(
      fc.constantFrom(
        'hello',
        'input',
        'ping',
        'pong',
        'welcome',
        'state',
        'bye',
        'full',
        'mismatch',
      ),
      fields,
    )
    .map(([type, rest]) => JSON.stringify({ ...rest, type })),
  // Spark Hunt's own input and state, with odd values inside the room's envelope.
  fc
    .tuple(
      fc.constantFrom('input', 'state'),
      fc.dictionary(fc.constantFrom('x', 'y', 'phase', 'players', 'timeLeft'), value),
      value,
    )
    .map(([type, data, ping]) => JSON.stringify({ type, data, ping })),
  // JSON's own way to Infinity, which JSON.stringify never writes.
  fc.constantFrom(
    '{"type":"input","data":{"x":1e999,"y":-1e999},"ping":1e999}',
    '{"type":"ping","sent":1e999}',
    `{"type":"hello","name":"x","token":"${'t'.repeat(10)}","room":${ROOM_PROTOCOL},"version":${PROTOCOL}}`,
  ),
)
const hostileStep = fc.record({
  channel: fc.constantFrom('control', 'fast'),
  text: hostileText,
  wait: fc.integer({ min: 0, max: 300 }),
})

describe('the host, fuzzed', () => {
  it('keeps a sound game for an honest player while hostile phones send anything', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.array(hostileStep, { maxLength: 25 }), { minLength: 1, maxLength: 3 }),
        fc.boolean(),
        async (attackers, startRound) => {
          const host = new HostSession('Hosty')
          const honest = linkPair()
          const attached = host.attach(honest.host.link)
          honest.open()
          const guest = await GuestSession.join(honest.guest.link, 'Honest', token())
          await attached.joined
          guest.setTarget({ x: 700, y: 300 })
          if (startRound) host.start(30)
          const rogues = attackers.map(() => {
            const pair = linkPair()
            host.attach(pair.host.link).joined.catch(() => {})
            pair.open()
            return pair
          })
          const longest = Math.max(...attackers.map((a) => a.length))
          for (let i = 0; i < longest; i++) {
            for (const [r, steps] of attackers.entries()) {
              const step = steps[i]
              const rogue = rogues[r]
              if (!step || !rogue) continue
              if (rogue.guest[step.channel].readyState === 'open')
                rogue.guest[step.channel].send(step.text)
            }
            await vi.advanceTimersByTimeAsync(Math.max(...attackers.map((a) => a[i]?.wait ?? 0)))
          }
          await vi.advanceTimersByTimeAsync(2000)

          // The honest player is still in, steered where they wanted, and sees a sound game.
          const players = host.world.players
          expect(players.length).toBeLessThanOrEqual(MAX_PLAYERS)
          expect(players.find((p) => p.name === 'Honest')).toMatchObject({ x: 700, y: 300 })
          for (const p of players) {
            expect(p.x >= PLAYER_RADIUS && p.x <= ARENA - PLAYER_RADIUS).toBe(true)
            expect(p.y >= PLAYER_RADIUS && p.y <= ARENA - PLAYER_RADIUS).toBe(true)
            expect(Number.isSafeInteger(p.score)).toBe(true)
            expect(cleanName(p.name, '?')).toBe(p.name)
            expect(p.ping === null || (p.ping >= 0 && p.ping <= 60_000)).toBe(true)
          }
          expect(new Set(players.map((p) => p.id)).size).toBe(players.length)
          const seen = guest.snapshot()
          expect(seen).not.toBeNull()
          expect(parseSnapshot(seen)).toEqual(seen)
          host.close()
          guest.close()
        },
      ),
      { numRuns: 60 },
    )
  })
})

describe('a player, fuzzed', () => {
  it('stays sound whatever a hostile host sends', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(hostileStep, { maxLength: 40 }), async (steps) => {
        const pair = linkPair()
        pair.open()
        const joining = GuestSession.join(pair.guest.link, 'Guesty', token())
        joining.catch(() => {})
        await vi.advanceTimersByTimeAsync(0)
        pair.host.control.send(
          JSON.stringify({
            type: 'welcome',
            id: 1,
            host: 'Host',
            rejoined: false,
            room: ROOM_PROTOCOL,
            version: PROTOCOL,
          }),
        )
        const guest = await joining
        const lost = vi.fn()
        guest.onLost = lost
        for (const step of steps) {
          if (pair.host[step.channel].readyState === 'open') pair.host[step.channel].send(step.text)
          await vi.advanceTimersByTimeAsync(step.wait)
          const seen = guest.snapshot()
          if (seen !== null) expect(parseSnapshot(seen)).toEqual(seen)
        }
        // Whatever arrived, what the player sends back is still sound.
        for (const message of pair.guest.fast.sent) {
          const sent = JSON.parse(message)
          expect(['input', 'ping']).toContain(sent.type)
          if (sent.type === 'input')
            expect(sent.ping === null || Number.isFinite(sent.ping)).toBe(true)
        }
        expect(lost.mock.calls.length).toBeLessThanOrEqual(1)
        guest.close()
      }),
      { numRuns: 150 },
    )
  })
})
