import { GuestRoom, HostRoom, ROOM_PROTOCOL } from '@fionapreroll/p2p/room'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NearbyHosting, NearbySearch } from './flow.ts'
import { type JoinRequest, MAX_REQUESTS, Nearby, type NearbyEvent, type Peer } from './index.ts'
import { NearbyAir } from './testing.ts'

/**
 * Bluetooth under attack, made up by fast-check: phones nearby that ask and give up at random,
 * a native side that reports whatever it likes, and a phone the host let in that then sends
 * anything. Whatever happens, the honest player gets in and plays, only phones the host accepted
 * reach the room, and the room hands the game only what its parsers accept.
 */

const SERVICE = 'com.example.fuzzgame'
const VERSION = 3
type State = { digits: Record<string, number> }
type Event = { play: number }
const parseInput = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 9 ? (v as number) : undefined
const parseEvent = (v: unknown): Event | undefined =>
  typeof v === 'object' && v !== null && 'play' in v && parseInput(v.play) !== undefined
    ? { play: v.play as number }
    : undefined
const parseState = (v: unknown): State | undefined =>
  typeof v === 'object' && v !== null && 'digits' in v ? (v as State) : undefined

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const later = (ms = 0) => vi.advanceTimersByTimeAsync(ms)
let tokens = 0

/** Endpoints of strangers: never the honest player's, whose id Nearby gives and none can take. */
const stranger = fc.constantFrom('E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'bad id', '', 42, null)
const text = fc.oneof(
  fc.string(),
  fc.json(),
  fc.constantFrom(
    JSON.stringify({
      type: 'hello',
      name: 'Rogue',
      token: 'rogue-token-1',
      room: ROOM_PROTOCOL,
      version: VERSION,
    }),
    JSON.stringify({ type: 'input', data: 9, ping: 5 }),
    // JSON reads 1e999 as Infinity.
    '{"type":"input","data":1e999,"ping":-1}',
    JSON.stringify({ type: 'event', data: { play: 8 } }),
    JSON.stringify({ type: 'event', data: { play: '8' } }),
    JSON.stringify({ type: 'ping', sent: 1 }),
    JSON.stringify({
      type: 'welcome',
      id: 0,
      host: 'Fake',
      rejoined: true,
      room: ROOM_PROTOCOL,
      version: VERSION,
    }),
    'x'.repeat(20_000),
  ),
)
/** Whatever the native side may report, as NearbyPlugin's events. */
const nativeEvent = fc.oneof(
  // Strangers who ask properly, often, so that the list of requests fills up.
  {
    weight: 3,
    arbitrary: fc.record({
      event: fc.constant<NearbyEvent>('request'),
      value: fc.record({
        endpointId: fc.constantFrom('E1', 'E2', 'E3', 'E4', 'E5', 'E6'),
        name: fc.string({ maxLength: 20 }),
        digits: fc.constantFrom('1234', '5678'),
        incoming: fc.constant(true),
      }),
    }),
  },
  fc.record({
    event: fc.constant<NearbyEvent>('request'),
    value: fc.record({
      endpointId: stranger,
      name: fc.oneof(fc.string(), fc.anything()),
      digits: fc.oneof(
        fc.constantFrom('1234', '0000', '12345678', '1'.repeat(9), ''),
        fc.anything(),
      ),
      incoming: fc.oneof(fc.boolean(), fc.anything()),
    }),
  }),
  fc.record({
    event: fc.constantFrom<NearbyEvent>('connected', 'disconnected', 'rejected', 'lost', 'found'),
    value: fc.oneof(fc.record({ endpointId: stranger, name: fc.string() }), fc.anything()),
  }),
  fc.record({
    event: fc.constant<NearbyEvent>('message'),
    value: fc.oneof(
      fc.record({
        endpointId: stranger,
        channel: fc.oneof(fc.constantFrom('control', 'fast'), fc.anything()),
        data: fc.oneof(text, fc.anything()),
      }),
      fc.anything(),
    ),
  }),
  fc.record({
    event: fc.constant<NearbyEvent>('bandwidth'),
    value: fc.oneof(
      fc.record({
        endpointId: stranger,
        quality: fc.oneof(fc.constantFrom('low', 'medium', 'high', 'unknown'), fc.anything()),
      }),
      fc.anything(),
    ),
  }),
)
const hostAction = fc.oneof(
  fc.record({ kind: fc.constant('native' as const), native: nativeEvent }),
  // Several strangers asking at once, as a group of phones nearby could.
  fc.record({ kind: fc.constant('flood' as const), count: fc.integer({ min: 1, max: 6 }) }),
  fc.record({ kind: fc.constant('accept' as const), pick: fc.nat() }),
  fc.record({ kind: fc.constant('reject' as const), pick: fc.nat() }),
  fc.record({ kind: fc.constant('wait' as const), ms: fc.integer({ min: 0, max: 3000 }) }),
)

/** A host phone with a room, advertised through NearbyHosting; every connection it attaches is counted. */
function hostPhone(air: NearbyAir) {
  const fake = air.phone('HOST1')
  const nearby = new Nearby({ serviceId: SERVICE }, fake)
  const room = new HostRoom<number, State, Event>({
    name: 'Hosty',
    version: VERSION,
    parseInput,
    parseEvent,
  })
  const digits = new Map<number, number>()
  const inputs: unknown[] = []
  const events: unknown[] = []
  /** What reached the game as each player's, by id. */
  const byPlayer = new Map<number, unknown[]>()
  const record = (id: number, value: unknown) =>
    byPlayer.set(id, [...(byPlayer.get(id) ?? []), value])
  room.onInput = (player, input) => {
    inputs.push(input)
    record(player.id, input)
    digits.set(player.id, input)
  }
  room.onEvent = (player, event) => {
    events.push(event)
    record(player.id, event)
  }
  /** Everything that reached the game as the honest player's. */
  const honestSaid = () => {
    const bo = room.players().find((p) => p.name === 'Bo')
    return bo ? (byPlayer.get(bo.id) ?? []) : []
  }
  room.onTick = () => ({ digits: Object.fromEntries(digits) })
  let attached = 0
  const hosting = new NearbyHosting(nearby, 'Hosty', (connection) => {
    attached++
    return room.attach(connection).joined
  })
  return { fake, nearby, room, hosting, inputs, events, honestSaid, attachedCount: () => attached }
}

/** The honest player, who looks, asks the host and plays the digit 4 once in. */
function honestPlayer(air: NearbyAir) {
  const nearby = new Nearby({ serviceId: SERVICE }, air.phone('PLAY1'))
  const guests: GuestRoom<number, State, Event>[] = []
  const search = new NearbySearch(nearby, 'Bo', (connection) =>
    GuestRoom.join<number, State, Event>(connection, {
      name: 'Bo',
      token: `honest-token-${++tokens}`,
      version: VERSION,
      parseState,
      parseEvent,
    }),
  )
  search.onJoined = (guest) => {
    guest.setInput(4)
    guest.send({ play: 6 })
    guests.push(guest)
  }
  return { search, guests }
}

describe('Bluetooth, fuzzed', () => {
  it('lets the honest player in, and nobody the host did not accept, whatever happens nearby', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(hostAction, { maxLength: 40 }),
        fc.nat(40),
        async (actions, honestAt) => {
          const air = new NearbyAir()
          const host = hostPhone(air)
          await later()
          const player = honestPlayer(air)
          await later()
          void player.search.choose(player.search.hosts()[0] as Peer)
          await later()
          const honest = host.hosting.requests()[0]?.request as JoinRequest
          expect(honest?.name).toBe('Bo')

          for (const [i, action] of [...actions, null].entries()) {
            if (i === Math.min(honestAt, actions.length)) host.hosting.accept(honest.endpointId)
            if (!action) continue
            const others = host.hosting
              .requests()
              .filter((r) => r.request.endpointId !== honest.endpointId)
            switch (action.kind) {
              case 'native':
                host.fake.emit(action.native.event, action.native.value)
                break
              case 'flood':
                for (let k = 1; k <= action.count; k++)
                  host.fake.emit('request', {
                    endpointId: `E${k}`,
                    name: `Rogue ${k}`,
                    digits: '1234',
                    incoming: true,
                  })
                break
              case 'accept': {
                const picked = others[action.pick % Math.max(1, others.length)]
                if (picked) host.hosting.accept(picked.request.endpointId)
                break
              }
              case 'reject': {
                const picked = others[action.pick % Math.max(1, others.length)]
                if (picked) host.hosting.reject(picked.request.endpointId)
                break
              }
              case 'wait':
                await later(action.ms)
                break
            }
            await later()
            // Strangers cannot pile up requests: few wait at once. Rows the host accepted stay
            // until the player is in or the host removes them, and only the host makes those.
            const waiting = host.hosting.requests().filter((r) => r.status === 'waiting')
            expect(waiting.length).toBeLessThanOrEqual(MAX_REQUESTS)
          }
          await later(2000)

          // The honest player is in, and plays.
          expect(player.search.state()).toMatchObject({ phase: 'joined' })
          const guest = player.guests[0]
          expect(guest).toBeDefined()
          expect(host.room.players().map((p) => p.name)).toContain('Bo')
          expect(guest?.state()?.digits[guest.id]).toBe(4)
          // Only connections the host accepted ever reached the room, and the game got only
          // what its parsers accept.
          expect(host.room.players().length).toBeLessThanOrEqual(host.attachedCount())
          for (const input of host.inputs) expect(parseInput(input)).toBe(input)
          for (const event of host.events) expect(parseEvent(event)).toEqual(event)
          expect(host.events).toContainEqual({ play: 6 })
          // Nothing a stranger sent reached the game as the honest player's.
          expect(new Set(host.honestSaid().map((v) => JSON.stringify(v)))).toEqual(
            new Set(['4', '{"play":6}']),
          )
          host.room.close()
          guest?.close()
        },
      ),
      { numRuns: 120 },
    )
  })

  it('keeps the room sound while a phone the host let in sends anything over Bluetooth', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            from: fc.constantFrom('E1', 'E1', 'E1', 'E2'),
            channel: fc.oneof(fc.constantFrom('control', 'fast'), fc.anything()),
            data: fc.oneof(text, fc.anything()),
            wait: fc.integer({ min: 0, max: 500 }),
          }),
          { maxLength: 40 },
        ),
        async (messages) => {
          const air = new NearbyAir()
          const host = hostPhone(air)
          await later()
          const player = honestPlayer(air)
          await later()
          void player.search.choose(player.search.hosts()[0] as Peer)
          await later()
          host.hosting.accept(host.hosting.requests()[0]?.request.endpointId ?? '')
          await later(100)

          // A stranger asks, as Nearby would report, and the host lets it in: its link opens.
          host.fake.answers.set('E1', 'pending')
          host.fake.emit('request', {
            endpointId: 'E1',
            name: 'Rogue',
            digits: '4321',
            incoming: true,
          })
          host.hosting.accept('E1')
          await later()
          host.fake.emit('connected', { endpointId: 'E1' })
          await later()

          for (const message of messages) {
            host.fake.emit('message', {
              endpointId: message.from,
              channel: message.channel,
              data: message.data,
            })
            await later(message.wait)
          }
          await later(2000)

          const guest = player.guests[0]
          expect(guest?.state()?.digits[guest.id]).toBe(4)
          const names = host.room.players().map((p) => p.name)
          expect(names).toContain('Bo')
          // E2 was never accepted: whatever it sent, it is not in the room.
          expect(names.length).toBeLessThanOrEqual(2)
          for (const input of host.inputs) expect(parseInput(input)).toBe(input)
          for (const event of host.events) expect(parseEvent(event)).toEqual(event)
          // Nothing a stranger sent reached the game as the honest player's.
          expect(new Set(host.honestSaid().map((v) => JSON.stringify(v)))).toEqual(
            new Set(['4', '{"play":6}']),
          )
          host.room.close()
          guest?.close()
        },
      ),
      { numRuns: 120 },
    )
  })
})
