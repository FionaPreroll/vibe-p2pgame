import { listen } from '@fionapreroll/p2p'
import { GuestRoom, HostRoom } from '@fionapreroll/p2p/room'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type JoinRequest,
  MAX_REQUESTS,
  Nearby,
  type NearbyEvent,
  type NearbyNative,
  NearbyStartError,
  type Peer,
  STATE_INTERVAL_MS,
} from './index.ts'
import { NearbyAir } from './testing.ts'

/**
 * Nearby between phones in memory (`NearbyAir` from the testing entry point), with the rooms of
 * `@fionapreroll/p2p` and a tiny game: each player sends a digit, and the host sends back
 * every player's digit. No phone, no Capacitor, and time under the test's control.
 */

const SERVICE = 'com.example.tinygame'
let lines: string[] = []
const nearby = (phone: NearbyNative, options = {}) =>
  new Nearby({ serviceId: SERVICE, log: (line) => lines.push(line), ...options }, phone)

type Input = number
type State = { digits: Record<string, number> }
const VERSION = 1
const parseInput = (v: unknown): Input | undefined =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 9 ? (v as number) : undefined
const parseState = (v: unknown): State | undefined =>
  typeof v === 'object' && v !== null && 'digits' in v ? (v as State) : undefined

beforeEach(() => {
  lines = []
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const later = (ms: number) => vi.advanceTimersByTimeAsync(ms)

/** A host phone advertising and a player phone looking. */
async function phones(service = SERVICE) {
  const air = new NearbyAir()
  const hostPhone = air.phone('HOST1')
  const playerPhone = air.phone('PLAY1')
  const host = nearby(hostPhone)
  const player = nearby(playerPhone, { serviceId: service })
  const requests: JoinRequest[] = []
  const found: Peer[] = []
  host.onRequest = (request) => requests.push(request)
  player.onFound = (peer) => found.push(peer)
  await host.host('Hosty')
  await player.look('Bo')
  await later(0)
  return { air, hostPhone, playerPhone, host, player, requests, found }
}

/** The tiny game, its player joined over Nearby. */
async function game() {
  const p = await phones()
  const room = new HostRoom<Input, State>({ name: 'Hosty', version: VERSION, parseInput })
  const digits = new Map<number, number>()
  room.onInput = (player, input) => digits.set(player.id, input)
  room.onTick = () => ({ digits: Object.fromEntries(digits) })
  const dialing = p.player.dial(p.found[0] as Peer, 'Bo')
  const joining = GuestRoom.join<Input, State>(dialing.connection, {
    name: 'Bo',
    token: 'token-1',
    version: VERSION,
    parseState,
  })
  await later(0)
  const request = p.requests[0] as JoinRequest
  const connection = p.host.accept(request)
  if (!connection) throw new Error('not accepted')
  const joined = room.attach(connection).joined
  const guest = await joining
  await joined
  return { ...p, room, guest, dialing, request, digits }
}

describe('between two phones', () => {
  it('finds the host, shows the same code on both phones, and plays once the host accepts', async () => {
    const { found, room, guest, dialing, request, hostPhone, playerPhone } = await game()
    expect(found).toEqual([{ endpointId: 'HOST1', name: 'Hosty' }])
    expect(request).toMatchObject({ endpointId: 'PLAY1', name: 'Bo' })
    expect(await dialing.digits).toBe(request.digits)
    expect([hostPhone.service, playerPhone.service]).toEqual([SERVICE, SERVICE])
    guest.setInput(7)
    await later(1000)
    expect(guest.state()).toEqual({ digits: { 1: 7 } })
    // Each side names the other by Nearby's id, never by a Bluetooth address.
    expect(await guest.details()).toMatchObject({
      transport: 'bluetooth',
      remote: { address: 'HOST1', type: 'nearby' },
    })
    expect(await room.details(guest.id)).toMatchObject({
      transport: 'bluetooth',
      remote: { address: 'PLAY1' },
    })
    room.close()
  })

  it('says whether a connection stays on Bluetooth or moves up to Wi-Fi', async () => {
    const { hostPhone, playerPhone, room, guest } = await game()
    expect((await guest.details())?.state).toBeUndefined()
    playerPhone.emit('bandwidth', { endpointId: 'HOST1', quality: 'low' })
    expect(await guest.details()).toMatchObject({
      state: 'low bandwidth',
      remote: { address: 'HOST1', network: 'bluetooth' },
    })
    hostPhone.emit('bandwidth', { endpointId: 'PLAY1', quality: 'high' })
    expect(await room.details(guest.id)).toMatchObject({
      state: 'high bandwidth',
      remote: { network: 'wifi' },
    })
    // Made up, or for a connection nobody here has: ignored.
    playerPhone.emit('bandwidth', { endpointId: 'HOST1', quality: 'huge' })
    playerPhone.emit('bandwidth', { endpointId: 'NOBODY', quality: 'high' })
    playerPhone.emit('bandwidth', { endpointId: 'HOST1\n', quality: 'high' })
    expect((await guest.details())?.state).toBe('low bandwidth')
    expect(lines).toContain('bandwidth of HOST1: low, over bluetooth')
    expect(lines).toContain('bandwidth of PLAY1: high, over wifi')
    room.close()
  })

  it('sends a player fewer states than over Wi-Fi, as often as the game says', async () => {
    const { hostPhone, room } = await game()
    const count = () => hostPhone.sent.filter((m) => m.data.includes('"state"')).length
    const before = count()
    await later(1000)
    const states = count() - before
    expect(states).toBeGreaterThanOrEqual(Math.floor(1000 / STATE_INTERVAL_MS) - 1)
    expect(states).toBeLessThanOrEqual(Math.ceil(1000 / STATE_INTERVAL_MS) + 1)
    room.close()
  })

  it('lets nobody in whom the host turns down', async () => {
    const { player, host, found, requests } = await phones()
    const dialing = player.dial(found[0] as Peer, 'Bo')
    await later(0)
    host.reject(requests[0] as JoinRequest)
    await later(0)
    expect(dialing.connection.state).toBe('closed')
  })

  it('finds only games of the same service', async () => {
    const { found } = await phones('com.example.othergame')
    expect(found).toEqual([])
  })

  it('carries what is sent, on its channel', async () => {
    const { player, host, found, requests } = await phones()
    const dialing = player.dial(found[0] as Peer, 'Bo')
    await later(0)
    const connection = host.accept(requests[0] as JoinRequest)
    if (!connection) throw new Error('not accepted')
    await later(0)
    const got: unknown[] = []
    listen(
      connection.control,
      (v) => v,
      (message) => got.push(message),
    )
    dialing.connection.control.send(JSON.stringify({ hello: 1 }))
    await later(0)
    expect(got).toEqual([{ hello: 1 }])
  })

  it('wants a sound service name, and logs what happens without names', async () => {
    const phone = new NearbyAir().phone('P1')
    for (const serviceId of ['', 'ab', 'has space', 'x'.repeat(65)]) {
      expect(() => new Nearby({ serviceId }, phone)).toThrow('Bad serviceId')
    }
    await nearby(phone).look('Secretname')
    expect(lines).toEqual(['start as player', 'started as player'])
  })
})

describe('when the native side fails', () => {
  it('turns down the requests nobody answered when the host stops advertising', async () => {
    const { air, host, hostPhone, requests } = await phones()
    const late = nearby(air.phone('PLAY2'))
    await late.look('Cy')
    late.dial({ endpointId: 'HOST1', name: 'Hosty' }, 'Cy')
    await later(0)
    expect(requests.map((r) => r.endpointId)).toEqual(['PLAY2'])
    await host.stop()
    expect(hostPhone.rejected).toEqual(['PLAY2'])
    expect(hostPhone.role).toBeNull()
    // Gone with the stop: it cannot be accepted any more.
    expect(host.accept(requests[0] as JoinRequest)).toBeNull()
  })

  it('closes the connection when the host’s yes does not reach Nearby', async () => {
    const { host, hostPhone, player, found, requests } = await phones()
    player.dial(found[0] as Peer, 'Bo')
    await later(0)
    hostPhone.accept = async () => {
      throw new Error('8011 endpoint unknown')
    }
    const connection = host.accept(requests[0] as JoinRequest)
    await later(0)
    expect(connection?.state).toBe('closed')
  })

  it('closes the player’s connection when asking fails, with the code in the log', async () => {
    const { player, found } = await phones()
    const { connection } = player.dial({ ...(found[0] as Peer), endpointId: 'GONE1' }, 'Bo')
    await later(0)
    expect(connection.state).toBe('closed')
    expect(lines).toContain('could not ask GONE1: nearby-8011: not found')
  })

  it('closes the player’s connection when its own yes does not reach Nearby', async () => {
    const { player, playerPhone, found } = await phones()
    playerPhone.accept = async () => {
      throw new Error('radio off')
    }
    const { connection } = player.dial(found[0] as Peer, 'Bo')
    await later(0)
    expect(connection.state).toBe('closed')
  })

  it('ends the connection before when the player asks the same host again', async () => {
    const { player, found } = await phones()
    const first = player.dial(found[0] as Peer, 'Bo')
    player.dial(found[0] as Peer, 'Bo')
    expect(first.connection.state).toBe('closed')
  })

  it('gives the native side’s diagnostics for a report', async () => {
    const { player } = await phones()
    expect(await player.diagnostics()).toEqual({
      sdk: 34,
      bluetooth: 'on',
      log: ['+0s start player'],
    })
  })
})

describe('starting', () => {
  it('says why it cannot start, and keeps the native code and message for a report', async () => {
    for (const [code, kind, shown] of [
      ['permission', 'permission', 'permission'],
      ['unavailable', 'unavailable', 'unavailable'],
      ['bluetooth-off', 'bluetooth-off', 'bluetooth-off'],
      ['location-off', 'location-off', 'location-off'],
      ['nearby-8007', 'radio', 'nearby-8007'],
      [undefined, 'radio', 'failed'],
    ] as const) {
      const phone = new NearbyAir().phone('P1')
      phone.startError = Object.assign(new Error('Could not discover: 8007 STATUS_RADIO_ERROR'), {
        code,
      })
      const failure = await nearby(phone)
        .look('Bo')
        .catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(NearbyStartError)
      expect(failure).toMatchObject({
        kind,
        code: shown,
        message: 'Could not discover: 8007 STATUS_RADIO_ERROR',
      })
    }
    expect(
      lines.some((line) => line.includes('could not start as player: radio (nearby-8007')),
    ).toBe(true)
  })

  it('ends what an earlier page left behind, once', async () => {
    const phone = new NearbyAir().phone('P1')
    const reset = vi.spyOn(phone, 'reset')
    const bt = nearby(phone)
    await bt.look('Bo')
    await bt.look('Bo')
    expect(reset).toHaveBeenCalledOnce()
  })
})

describe('against a misbehaving native side or neighbour', () => {
  /** Nearby on a phone whose native events the test makes up. */
  async function rigged(role: 'host' | 'player') {
    const phone = new NearbyAir().phone('ME')
    const bt = nearby(phone)
    const requests: JoinRequest[] = []
    const found: Peer[] = []
    bt.onRequest = (r) => requests.push(r)
    bt.onFound = (p) => found.push(p)
    if (role === 'host') await bt.host('Hosty')
    else await bt.look('Bo')
    return { phone, bt, requests, found }
  }

  it('turns down requests beyond a few at once, and doubles', async () => {
    const { phone, requests } = await rigged('host')
    for (let i = 0; i < MAX_REQUESTS + 3; i++) {
      phone.emit('request', { endpointId: `E${i}`, name: `P${i}`, digits: '1234', incoming: true })
    }
    phone.emit('request', { endpointId: 'E0', name: 'Again', digits: '9999', incoming: true })
    expect(requests).toHaveLength(MAX_REQUESTS)
    expect(phone.rejected).toEqual(['E4', 'E5', 'E6'])
  })

  it('ignores requests to a phone that is not hosting, and answers it never asked for', async () => {
    const player = await rigged('player')
    player.phone.emit('request', { endpointId: 'E1', name: 'X', digits: '1234', incoming: true })
    expect(player.requests).toEqual([])
    player.phone.emit('request', { endpointId: 'E2', name: 'X', digits: '1234', incoming: false })
    expect(player.phone.rejected).toEqual(['E2'])
  })

  it('reads every event field by field, and drops what does not fit', async () => {
    const { phone, requests, found } = await rigged('host')
    for (const value of [
      null,
      'request',
      { endpointId: 'has space', name: 'X', digits: '1234', incoming: true },
      { endpointId: 'x'.repeat(100), name: 'X', digits: '1234', incoming: true },
      { endpointId: 'E1', name: 'X', digits: '12345678901', incoming: true },
      { endpointId: 'E1', name: 'X', digits: 1234, incoming: true },
      { endpointId: 42, name: 'X', digits: '1234', incoming: true },
    ]) {
      phone.emit('request', value)
    }
    phone.emit('found', { endpointId: 'H1', name: 'Host' })
    expect(requests).toEqual([])
    expect(found).toEqual([])
    phone.emit('request', { endpointId: 'E9', name: '‮evil\u0000', digits: '1234', incoming: true })
    expect(requests).toEqual([{ endpointId: 'E9', name: 'evil', digits: '1234' }])
  })

  it('ends a connection that nobody here asked for or accepted', async () => {
    const { phone } = await rigged('host')
    phone.emit('connected', { endpointId: 'STRANGER' })
    await later(0)
    expect(phone.disconnected).toEqual(['STRANGER'])
  })

  it('takes messages only from accepted, open connections, on a known channel', async () => {
    const { phone, bt, requests } = await rigged('host')
    phone.emit('message', { endpointId: 'E1', channel: 'control', data: 'before anything' })
    phone.emit('request', { endpointId: 'E1', name: 'Bo', digits: '1234', incoming: true })
    phone.answers.set('E1', 'pending')
    const connection = bt.accept(requests[0] as JoinRequest)
    if (!connection) throw new Error('not accepted')
    const got: string[] = []
    connection.control.addEventListener('message', (e) => got.push(`c:${e.data}`))
    connection.fast.addEventListener('message', (e) => got.push(`f:${e.data}`))
    phone.emit('message', { endpointId: 'E1', channel: 'control', data: 'before open' })
    phone.emit('connected', { endpointId: 'E1' })
    phone.emit('message', { endpointId: 'E1', channel: 'control', data: 'one' })
    phone.emit('message', { endpointId: 'E1', channel: 'fast', data: 'two' })
    phone.emit('message', { endpointId: 'E1', channel: 'other', data: 'x' })
    phone.emit('message', { endpointId: 'E1', channel: 'control', data: 7 })
    phone.emit('message', { endpointId: 'E1', channel: 'control', data: 'x'.repeat(20_000) })
    phone.emit('message', { endpointId: 'E2', channel: 'control', data: 'stranger' })
    phone.emit('disconnected', { endpointId: 'E1' })
    phone.emit('message', { endpointId: 'E1', channel: 'control', data: 'after' })
    expect(got).toEqual(['c:one', 'f:two'])
    expect(connection.state).toBe('closed')
  })

  it('cannot accept a request twice, or one that went away', async () => {
    const { phone, bt, requests } = await rigged('host')
    phone.emit('request', { endpointId: 'E1', name: 'Bo', digits: '1234', incoming: true })
    phone.answers.set('E1', 'pending')
    const request = requests[0] as JoinRequest
    expect(bt.accept(request)).not.toBeNull()
    expect(bt.accept(request)).toBeNull()
    phone.emit('request', { endpointId: 'E2', name: 'Cy', digits: '5678', incoming: true })
    const gone = vi.fn()
    bt.onRequestGone = gone
    phone.emit('rejected', { endpointId: 'E2' })
    expect(gone).toHaveBeenCalledWith('E2')
    expect(bt.accept(requests[1] as JoinRequest)).toBeNull()
  })

  it('never throws and never opens a connection it did not make, whatever the native side sends', async () => {
    const events: NearbyEvent[] = [
      'found',
      'lost',
      'request',
      'connected',
      'rejected',
      'disconnected',
      'message',
    ]
    const id = fc.constantFrom('E1', 'E2', 'E3', 'bad id', '', 42, null)
    const value = fc.oneof(
      fc.anything(),
      fc.record({
        endpointId: id,
        name: fc.oneof(fc.string(), fc.anything()),
        digits: fc.oneof(fc.constantFrom('1234', '0000'), fc.anything()),
        incoming: fc.oneof(fc.boolean(), fc.anything()),
        channel: fc.oneof(fc.constantFrom('control', 'fast'), fc.anything()),
        data: fc.oneof(fc.string(), fc.anything()),
      }),
    )
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('host' as const, 'player' as const),
        fc.array(fc.tuple(fc.constantFrom(...events), value, fc.boolean()), { maxLength: 40 }),
        async (role, steps) => {
          const { phone, bt, requests } = await rigged(role)
          const opened: string[] = []
          for (const [event, payload, accept] of steps) {
            phone.emit(event, payload)
            const request = requests.at(-1)
            if (accept && request) {
              phone.answers.set(request.endpointId, 'pending')
              const connection = bt.accept(request)
              connection?.onStateChange(() => {
                if (connection.state === 'open') opened.push(request.endpointId)
              })
            }
          }
          await later(0)
          // Only connections the host accepted ever open.
          for (const endpointId of opened) {
            expect(requests.map((r) => r.endpointId)).toContain(endpointId)
          }
          expect(requests.length).toBeLessThanOrEqual(role === 'host' ? 40 : 0)
        },
      ),
      { numRuns: 300 },
    )
  })
})
