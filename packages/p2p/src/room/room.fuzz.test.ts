import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanName } from '../channel.ts'
import { linkPair } from '../testing.ts'
import { GuestRoom } from './guest.ts'
import { HostRoom } from './host.ts'
import { ROOM_PROTOCOL } from './messages.ts'

/**
 * Hostile phones, made up by fast-check: whatever they send, in whatever order, the room lets
 * the honest player play, and hands the game only what its parsers accept.
 */

type State = { digits: Record<string, number> }
const VERSION = 7
const parseInput = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 9 ? (v as number) : undefined
const parseState = (v: unknown): State | undefined =>
  typeof v === 'object' &&
  v !== null &&
  'digits' in v &&
  typeof v.digits === 'object' &&
  v.digits !== null
    ? (v as State)
    : undefined

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
  fc.constantFrom(null, true, -1, 0, 9, 10, 1e308, ROOM_PROTOCOL, VERSION, '‮', 'x'.repeat(3000)),
)
const fields = fc.dictionary(
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
    'playerId',
  ),
  value,
)
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
  fc.constantFrom(
    '{"type":"input","data":1e999,"ping":1e999}',
    '{"type":"ping","sent":1e999}',
    `{"type":"hello","name":"x","token":"${'t'.repeat(10)}","room":${ROOM_PROTOCOL},"version":${VERSION}}`,
  ),
)
const hostileStep = fc.record({
  channel: fc.constantFrom('control', 'fast'),
  text: hostileText,
  wait: fc.integer({ min: 0, max: 300 }),
})

describe('the host room, fuzzed', () => {
  it('lets an honest player play while hostile phones send anything', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.array(hostileStep, { maxLength: 25 }), { minLength: 1, maxLength: 3 }),
        async (attackers) => {
          const room = new HostRoom<number, State>({
            name: 'Hosty',
            version: VERSION,
            parseInput,
            maxPlayers: 4,
          })
          const inputs: unknown[] = []
          const digits = new Map<number, number>()
          room.onInput = (player, input) => {
            inputs.push(input)
            digits.set(player.id, input)
          }
          room.onTick = () => ({ digits: Object.fromEntries(digits) })
          const honest = linkPair()
          const attached = room.attach(honest.host.link)
          honest.open()
          const guest = await GuestRoom.join<number, State>(honest.guest.link, {
            name: 'Honest',
            token: token(),
            version: VERSION,
            parseState,
          })
          const { player } = await attached.joined
          guest.setInput(4)
          const rogues = attackers.map(() => {
            const pair = linkPair()
            room.attach(pair.host.link).joined.catch(() => {})
            pair.open()
            return pair
          })
          const longest = Math.max(...attackers.map((a) => a.length))
          for (let i = 0; i < longest; i++) {
            for (const [r, steps] of attackers.entries()) {
              const step = steps[i]
              const channel = step && rogues[r]?.guest[step.channel]
              if (step && channel?.readyState === 'open') channel.send(step.text)
            }
            await vi.advanceTimersByTimeAsync(Math.max(...attackers.map((a) => a[i]?.wait ?? 0)))
          }
          await vi.advanceTimersByTimeAsync(2000)

          // The game saw only input its parser accepts, and the honest player's got through.
          for (const input of inputs) expect(parseInput(input)).toBe(input)
          expect(digits.get(player.id)).toBe(4)
          expect(guest.state()?.digits[player.id]).toBe(4)
          const players = room.players()
          expect(players.length).toBeLessThanOrEqual(3)
          expect(new Set(players.map((p) => p.id)).size).toBe(players.length)
          for (const p of players) {
            expect(cleanName(p.name, '?')).toBe(p.name)
            expect(p.ping === null || (p.ping >= 0 && p.ping <= 60_000)).toBe(true)
          }
          room.close()
          guest.close()
        },
      ),
      { numRuns: 60 },
    )
  })
})

describe('a player room, fuzzed', () => {
  it('stays sound whatever a hostile host sends', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(hostileStep, { maxLength: 40 }), async (steps) => {
        const pair = linkPair()
        pair.open()
        const joining = GuestRoom.join<number, State>(pair.guest.link, {
          name: 'Guesty',
          token: token(),
          version: VERSION,
          parseState,
        })
        joining.catch(() => {})
        await vi.advanceTimersByTimeAsync(0)
        pair.host.control.send(
          JSON.stringify({
            type: 'welcome',
            id: 1,
            host: 'Host',
            rejoined: false,
            room: ROOM_PROTOCOL,
            version: VERSION,
          }),
        )
        const guest = await joining
        guest.setInput(2)
        const lost = vi.fn()
        guest.onLost = lost
        for (const step of steps) {
          if (pair.host[step.channel].readyState === 'open') pair.host[step.channel].send(step.text)
          await vi.advanceTimersByTimeAsync(step.wait)
          const seen = guest.state()
          if (seen !== null) expect(parseState(seen)).toBe(seen)
          const ping = guest.ping()
          expect(ping === null || (Number.isFinite(ping) && ping >= 0)).toBe(true)
        }
        // Whatever arrived, what the player sends back is still sound.
        for (const message of pair.guest.fast.sent) {
          const sent = JSON.parse(message)
          expect(['input', 'ping']).toContain(sent.type)
          if (sent.type === 'input') {
            expect(sent.data).toBe(2)
            expect(sent.ping === null || Number.isFinite(sent.ping)).toBe(true)
          }
        }
        expect(lost.mock.calls.length).toBeLessThanOrEqual(1)
        guest.close()
      }),
      { numRuns: 150 },
    )
  })
})
