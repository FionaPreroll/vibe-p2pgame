import { GuestRoom, HostRoom } from '@fionapreroll/p2p/room'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NearbyHosting, NearbySearch } from './flow.ts'
import { Nearby, NearbyStartError, type Peer } from './index.ts'
import { NearbyAir } from './testing.ts'

/**
 * The Bluetooth flow without screens: a host who lets players in and a player who looks and
 * asks, on fake phones (`NearbyAir`), with the rooms of `@fionapreroll/p2p` and a game without
 * input or state.
 */

const SERVICE = 'com.example.flowgame'
const VERSION = 1
const parseInput = (v: unknown) => (v === null ? null : undefined)
const parseState = (v: unknown) => (v === null ? null : undefined)
type Guest = GuestRoom<null, null>

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
let rooms: { close(): void }[] = []

afterEach(() => {
  for (const room of rooms) room.close()
  rooms = []
})

/** A host phone whose game is a room, advertised through `NearbyHosting`. */
function hostPhone(air: NearbyAir, id = 'HOST1', name = 'Hosty') {
  const fake = air.phone(id)
  const nearby = new Nearby({ serviceId: SERVICE }, fake)
  const room = new HostRoom<null, null>({ name, version: VERSION, parseInput })
  rooms.push(room)
  const hosting = new NearbyHosting(nearby, name, (connection) => room.attach(connection).joined)
  const joined: string[] = []
  hosting.onJoined = ({ player }) => joined.push(player.name)
  return { fake, nearby, room, hosting, joined }
}

/** A player phone that looks for games through `NearbySearch`. */
function playerPhone(air: NearbyAir, id = 'PLAY1', name = 'Bo', version = VERSION) {
  const fake = air.phone(id)
  const nearby = new Nearby({ serviceId: SERVICE }, fake)
  const discarded: Guest[] = []
  const search = new NearbySearch<Guest>(
    nearby,
    name,
    (connection) =>
      GuestRoom.join<null, null>(connection, {
        name,
        token: `token-flow-${++tokens}`,
        version,
        parseState,
      }),
    {
      discard: (guest) => {
        discarded.push(guest)
        guest.close()
      },
    },
  )
  const guests: Guest[] = []
  search.onJoined = (guest) => {
    guests.push(guest)
    rooms.push(guest)
  }
  return { fake, nearby, search, guests, discarded }
}

describe('NearbySearch and NearbyHosting', () => {
  it('find the game, show the same code on both phones, and let the player in', async () => {
    const air = new NearbyAir()
    const host = hostPhone(air)
    await later()
    const player = playerPhone(air)
    expect(player.search.state()).toEqual({ phase: 'starting' })
    await later()
    expect(player.search.state()).toEqual({ phase: 'looking' })
    expect(player.search.hosts()).toEqual([{ endpointId: 'HOST1', name: 'Hosty' }])

    void player.search.choose(player.search.hosts()[0] as Peer)
    await later()
    // Looking stopped; the code is on both phones.
    expect(player.fake.role).toBeNull()
    const [request] = host.hosting.requests()
    expect(request).toMatchObject({ status: 'waiting', request: { name: 'Bo' } })
    const state = player.search.state()
    expect(state).toMatchObject({ phase: 'asking', host: { name: 'Hosty' } })
    expect(state.phase === 'asking' && state.digits).toBe(request?.request.digits)

    host.hosting.accept(request?.request.endpointId ?? '')
    expect(host.hosting.requests()[0]?.status).toBe('joining')
    await later(100)
    expect(host.joined).toEqual(['Bo'])
    expect(host.hosting.requests()).toEqual([])
    expect(player.search.state()).toMatchObject({ phase: 'joined', host: { name: 'Hosty' } })
    expect(player.guests[0]?.host).toBe('Hosty')
  })

  it('tell a host’s no from a join that failed, and look again', async () => {
    const air = new NearbyAir()
    const host = hostPhone(air)
    await later()
    const player = playerPhone(air)
    await later()
    void player.search.choose(player.search.hosts()[0] as Peer)
    await later()
    host.hosting.reject(host.hosting.requests()[0]?.request.endpointId ?? '')
    await later()
    expect(player.search.state()).toMatchObject({ phase: 'refused', host: { name: 'Hosty' } })
    expect(host.hosting.requests()).toEqual([])

    player.search.again()
    await later()
    expect(player.search.state()).toEqual({ phase: 'looking' })
    expect(player.fake.role).toBe('player')
    expect(player.search.hosts()).toHaveLength(1)

    // Another version: the connection opens, then joining fails, on both phones.
    const other = playerPhone(air, 'PLAY2', 'Cy', VERSION + 1)
    await later()
    void other.search.choose(other.search.hosts()[0] as Peer)
    await later()
    const request = host.hosting.requests().find((r) => r.request.name === 'Cy')
    host.hosting.accept(request?.request.endpointId ?? '')
    await later(1000)
    expect(other.search.state()).toMatchObject({ phase: 'failed', error: new Error('version') })
    expect(host.hosting.requests()[0]).toMatchObject({
      status: 'failed',
      error: new Error('version'),
    })
    // The host clears the failed request.
    host.hosting.reject(request?.request.endpointId ?? '')
    expect(host.hosting.requests()).toEqual([])
  })

  it('drop a request the player took back, and games no longer found', async () => {
    const air = new NearbyAir()
    const host = hostPhone(air)
    await later()
    const player = playerPhone(air)
    await later()
    player.fake.emit('lost', { endpointId: 'HOST1' })
    expect(player.search.hosts()).toEqual([])
    player.fake.emit('found', { endpointId: 'HOST1', name: 'Hosty' })
    player.fake.emit('found', { endpointId: 'HOST1', name: 'Hosty' })
    expect(player.search.hosts()).toHaveLength(1)

    void player.search.choose(player.search.hosts()[0] as Peer)
    await later()
    expect(host.hosting.requests()).toHaveLength(1)
    await player.search.leave()
    await later()
    expect(player.search.state()).toEqual({ phase: 'left' })
    expect(host.hosting.requests()).toEqual([])
  })

  it('hand a join that comes after the player left to discard', async () => {
    const air = new NearbyAir()
    hostPhone(air)
    await later()
    let finish: (value: string) => void = () => {}
    const discarded: string[] = []
    const search = new NearbySearch<string>(
      new Nearby({ serviceId: SERVICE }, air.phone('PLAY1')),
      'Bo',
      () => new Promise((resolve) => (finish = resolve)),
      { discard: (value) => discarded.push(value) },
    )
    const joined = vi.fn()
    search.onJoined = joined
    await later()
    void search.choose(search.hosts()[0] as Peer)
    await later()
    await search.leave()
    finish('a room')
    await later()
    expect(discarded).toEqual(['a room'])
    expect(joined).not.toHaveBeenCalled()
  })

  it('say why Bluetooth did not start, on both sides', async () => {
    const air = new NearbyAir()
    const fake = air.phone('HOST1')
    fake.startError = Object.assign(new Error('off'), { code: 'bluetooth-off' })
    const hosting = new NearbyHosting(new Nearby({ serviceId: SERVICE }, fake), 'Hosty', () =>
      Promise.resolve(null),
    )
    await expect(hosting.started).rejects.toBeInstanceOf(NearbyStartError)

    const other = air.phone('PLAY2')
    other.startError = Object.assign(new Error('off'), { code: 'location-off' })
    const search = new NearbySearch(new Nearby({ serviceId: SERVICE }, other), 'Cy', () =>
      Promise.resolve(null),
    )
    await later()
    const state = search.state()
    expect(state.phase).toBe('unavailable')
    expect(state.phase === 'unavailable' && (state.error as NearbyStartError).kind).toBe(
      'location-off',
    )
  })

  it('give up a player the host accepted whose connection never opens', async () => {
    const air = new NearbyAir()
    const host = hostPhone(air)
    await later()
    // A stranger asks, as Nearby would report it, and the host accepts; its link never opens.
    host.fake.answers.set('E9', 'pending')
    host.fake.emit('request', { endpointId: 'E9', name: 'Gone', digits: '4321', incoming: true })
    host.hosting.accept('E9')
    await later(29_999)
    expect(host.hosting.requests()[0]?.status).toBe('joining')
    await later(1)
    expect(host.hosting.requests()[0]).toMatchObject({
      status: 'failed',
      error: new Error('Connection timed out'),
    })
    expect(host.fake.disconnected).toContain('E9')
    // The host clears it, and the next player still gets in.
    host.hosting.reject('E9')
    expect(host.hosting.requests()).toEqual([])
    const player = playerPhone(air)
    await later()
    void player.search.choose(player.search.hosts()[0] as Peer)
    await later()
    host.hosting.accept(host.hosting.requests()[0]?.request.endpointId ?? '')
    await later(100)
    expect(host.joined).toEqual(['Bo'])
  })

  it('leave a connection that opened in time to the room, however long joining takes', async () => {
    const air = new NearbyAir()
    const host = hostPhone(air)
    await later()
    const player = playerPhone(air)
    await later()
    void player.search.choose(player.search.hosts()[0] as Peer)
    await later()
    host.hosting.accept(host.hosting.requests()[0]?.request.endpointId ?? '')
    await later(100)
    expect(host.joined).toEqual(['Bo'])
    // Long after: the player stays in.
    await later(60_000)
    expect(host.room.players().map((p) => p.name)).toEqual(['Bo'])
  })

  it('stop advertising when the host closes, and take no request after', async () => {
    const air = new NearbyAir()
    const host = hostPhone(air)
    await later()
    expect(host.fake.role).toBe('host')
    await host.hosting.close()
    expect(host.hosting.closed).toBe(true)
    expect(host.fake.role).toBeNull()
    host.fake.emit('request', { endpointId: 'LATE1', name: 'Late', digits: '1234', incoming: true })
    expect(host.hosting.requests()).toEqual([])
    host.hosting.accept('LATE1')
    expect(host.joined).toEqual([])
  })
})
