import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanName } from '../channel.ts'
import { linkPair } from '../testing.ts'
import { GuestRoom } from './guest.ts'
import { HostRoom } from './host.ts'
import { ROOM_PROTOCOL } from './messages.ts'

/**
 * Hostile phones, made up by fast-check: whatever they send, in whatever order, the room lets
 * the honest player play, and hands the game only what its parsers accept. A hostile phone may
 * also connect and drop out, say hello or never, again and again.
 */

type State = { digits: Record<string, number> }
const VERSION = 7
const parseInput = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 9 ? (v as number) : undefined
/** The game's events: a move, a digit to play. */
type Event = { play: number }
const parseEvent = (v: unknown): Event | undefined =>
  typeof v === 'object' && v !== null && 'play' in v && parseInput(v.play) !== undefined
    ? { play: v.play as number }
    : undefined
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
        'event',
      ),
      fields,
    )
    .map(([type, rest]) => JSON.stringify({ ...rest, type })),
  fc.constantFrom(
    '{"type":"input","data":1e999,"ping":1e999}',
    '{"type":"ping","sent":1e999}',
    '{"type":"event","data":{"play":3}}',
    '{"type":"event","data":{"play":3,"__proto__":{"polluted":true}}}',
    '{"type":"event","data":{"play":"3"}}',
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
          const room = new HostRoom<number, State, Event>({
            name: 'Hosty',
            version: VERSION,
            parseInput,
            parseEvent,
            maxPlayers: 4,
          })
          const inputs: unknown[] = []
          const events: [number, unknown][] = []
          room.onEvent = (player, event) => events.push([player.id, event])
          const digits = new Map<number, number>()
          room.onInput = (player, input) => {
            inputs.push(input)
            digits.set(player.id, input)
          }
          room.onTick = () => ({ digits: Object.fromEntries(digits) })
          const honest = linkPair()
          const attached = room.attach(honest.host.link)
          honest.open()
          const guest = await GuestRoom.join<number, State, Event>(honest.guest.link, {
            name: 'Honest',
            token: token(),
            version: VERSION,
            parseState,
            parseEvent,
          })
          const { player } = await attached.joined
          guest.setInput(4)
          guest.send({ play: 7 })
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

          // The game saw only input and events its parsers accept, and the honest player's got
          // through, the event once. No message reached into an object's prototype.
          for (const input of inputs) expect(parseInput(input)).toBe(input)
          for (const [, event] of events) expect(parseEvent(event)).toEqual(event)
          expect(events.filter(([id]) => id === player.id)).toEqual([[player.id, { play: 7 }]])
          expect(({} as Record<string, unknown>).polluted).toBeUndefined()
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
        const joining = GuestRoom.join<number, State, Event>(pair.guest.link, {
          name: 'Guesty',
          token: token(),
          version: VERSION,
          parseState,
          parseEvent,
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
        const heard: unknown[] = []
        guest.onEvent = (event) => heard.push(event)
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
        // The game heard only events its parser accepts.
        for (const event of heard) expect(parseEvent(event)).toEqual(event)
        expect(lost.mock.calls.length).toBeLessThanOrEqual(1)
        guest.close()
      }),
      { numRuns: 150 },
    )
  })
})

/** What a hostile phone does with its connection, besides sending. */
const lifeStep = fc.oneof(
  fc.constant({ kind: 'open' as const }),
  fc.constant({ kind: 'drop' as const }),
  fc.constant({ kind: 'reconnect' as const }),
  fc.record({
    kind: fc.constant('hello' as const),
    // A small pool, so phones take each other's places; never the honest player's token.
    token: fc.constantFrom('rogue-token-a', 'rogue-token-b', 'rogue-token-c', '', 'x'),
    room: fc.constantFrom(ROOM_PROTOCOL, ROOM_PROTOCOL + 1),
    version: fc.constantFrom(VERSION, VERSION + 1),
    name: fc.string({ maxLength: 40 }),
  }),
  fc.record({
    kind: fc.constant('send' as const),
    channel: fc.constantFrom('control' as const, 'fast' as const),
    text: hostileText,
  }),
  fc.record({ kind: fc.constant('wait' as const), ms: fc.integer({ min: 0, max: 20_000 }) }),
)

describe('hostile connections, fuzzed', () => {
  it('keep the room sound however they connect, greet, go silent and drop out', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.array(lifeStep, { maxLength: 20 }), { minLength: 1, maxLength: 4 }),
        async (rogues) => {
          const room = new HostRoom<number, State, Event>({
            name: 'Hosty',
            version: VERSION,
            parseInput,
            parseEvent,
            maxPlayers: 4,
          })
          // Who is in, by the room's own word: every join and every leave.
          const present = new Set<number>()
          room.onJoin = (player) => {
            expect(present.has(player.id)).toBe(false)
            present.add(player.id)
          }
          room.onLeave = (player) => {
            expect(present.delete(player.id)).toBe(true)
          }
          room.onTick = () => ({ digits: {} })

          const honest = linkPair()
          const attached = room.attach(honest.host.link)
          honest.open()
          const guest = await GuestRoom.join<number, State, Event>(honest.guest.link, {
            name: 'Honest',
            token: token(),
            version: VERSION,
            parseState,
          })
          guest.setInput(1)
          const { player } = await attached.joined

          // Every connection ever made, and whether the room has settled it.
          const all: { pair: ReturnType<typeof linkPair>; settled: boolean }[] = []
          const connect = () => {
            const entry = { pair: linkPair(), settled: false }
            all.push(entry)
            const done = () => {
              entry.settled = true
            }
            room.attach(entry.pair.host.link).joined.then(done, done)
            return entry.pair
          }
          const pairs = rogues.map(connect)
          const longest = Math.max(...rogues.map((steps) => steps.length))
          for (let i = 0; i < longest; i++) {
            for (const [r, steps] of rogues.entries()) {
              const step = steps[i]
              const pair = pairs[r]
              if (!step || !pair) continue
              switch (step.kind) {
                case 'open':
                  pair.open()
                  break
                case 'drop':
                  pair.guest.connection.close()
                  break
                case 'reconnect':
                  pair.guest.connection.close()
                  pairs[r] = connect()
                  break
                case 'hello':
                  if (pair.guest.control.readyState === 'open')
                    pair.guest.control.send(JSON.stringify({ type: 'hello', ...step }))
                  break
                case 'send':
                  if (pair.guest[step.channel].readyState === 'open')
                    pair.guest[step.channel].send(step.text)
                  break
                case 'wait':
                  await vi.advanceTimersByTimeAsync(step.ms)
                  break
              }
            }
            await vi.advanceTimersByTimeAsync(0)
          }
          // Long enough for every silent connection to be given up.
          await vi.advanceTimersByTimeAsync(20_000)

          const players = room.players()
          expect(new Set(players.map((p) => p.id))).toEqual(present)
          expect(players.length).toBeLessThanOrEqual(3)
          // The honest player stays in, whatever happened around them, and plays.
          expect(present.has(player.id)).toBe(true)
          expect(guest.state()).not.toBeNull()
          // No connection is held open without joining: the hostile connections still open
          // are exactly the hostile players in the room. And every connection that opened or
          // closed has heard how it ended.
          const open = all.filter(({ pair }) => pair.host.connection.state === 'open')
          expect(open.length).toBe(present.size - 1)
          for (const { pair, settled } of all) {
            if (pair.host.connection.state !== 'connecting') expect(settled).toBe(true)
          }
          room.close()
          guest.close()
        },
      ),
      { numRuns: 80 },
    )
  })
})
