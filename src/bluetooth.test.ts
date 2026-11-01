import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }))

const { Nearby, STATE_INTERVAL_MS } = await import('@fionapreroll/p2p-nearby')
const { NearbyAir } = await import('@fionapreroll/p2p-nearby/testing')
const { SERVICE_ID } = await import('./bluetooth')
const { GuestSession } = await import('./session/guest')
const { HostSession } = await import('./session/host')
type JoinRequest = import('@fionapreroll/p2p-nearby').JoinRequest
type Peer = import('@fionapreroll/p2p-nearby').Peer

/**
 * Spark Hunt over Bluetooth, without phones: the fake Nearby of `@fionapreroll/p2p-nearby`
 * carries between phones what Nearby would, and the game's real sessions play over it. Nearby
 * itself, and how it stands up to a misbehaving native side, is tested in the package.
 */

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const later = (ms: number) => vi.advanceTimersByTimeAsync(ms)
let tokens = 0
const token = () => `token-bt-${++tokens}`

/** A host phone and a player phone, the host advertising and the player looking. */
async function phones() {
  const air = new NearbyAir()
  const hostPhone = air.phone('HOST1')
  const playerPhone = air.phone('PLAY1')
  const host = new Nearby({ serviceId: SERVICE_ID }, hostPhone)
  const player = new Nearby({ serviceId: SERVICE_ID }, playerPhone)
  const requests: JoinRequest[] = []
  const found: Peer[] = []
  host.onRequest = (request) => requests.push(request)
  player.onFound = (peer) => found.push(peer)
  await host.host('Hosty')
  await player.look('Bo')
  await later(0)
  return { air, hostPhone, playerPhone, host, player, requests, found }
}

/** A Spark Hunt game whose player joined over Bluetooth. */
async function game(playerToken = token()) {
  const p = await phones()
  const session = new HostSession('Hosty')
  const host = p.found[0]
  if (!host) throw new Error('no host found')
  const dialing = p.player.dial(host, 'Bo')
  const joining = GuestSession.join(dialing.connection, 'Bo', playerToken)
  await later(0)
  const request = p.requests[0]
  if (!request) throw new Error('no request')
  const connection = p.host.accept(request)
  if (!connection) throw new Error('not accepted')
  const joined = session.attach(connection).joined
  const guest = await joining
  await joined
  return { ...p, session, guest, dialing, request, token: playerToken }
}

describe('Bluetooth between two phones', () => {
  it('finds the host, shows the same code on both phones, and plays once the host accepts', async () => {
    const { found, requests, session, guest, dialing, request } = await game()
    expect(found).toEqual([{ endpointId: 'HOST1', name: 'Hosty' }])
    expect(request).toMatchObject({ endpointId: 'PLAY1', name: 'Bo' })
    expect(await dialing.digits).toBe(request.digits)
    expect(requests).toHaveLength(1)
    guest.setTarget({ x: 500, y: 200 })
    await later(3000)
    expect(session.world.players.find((p) => p.id === 1)).toMatchObject({ x: 500, y: 200 })
    expect(guest.snapshot()?.players).toHaveLength(2)
    session.close()
  })

  it('sends a Bluetooth player fewer states than a Wi-Fi one', async () => {
    const { hostPhone, session } = await game()
    const before = hostPhone.sent.filter((m) => m.data.includes('"state"')).length
    await later(1000)
    const states = hostPhone.sent.filter((m) => m.data.includes('"state"')).length - before
    expect(states).toBeGreaterThanOrEqual(Math.floor(1000 / STATE_INTERVAL_MS) - 1)
    expect(states).toBeLessThanOrEqual(Math.ceil(1000 / STATE_INTERVAL_MS) + 1)
    session.close()
  })

  it('lets nobody in whom the host turns down', async () => {
    const { player, host, found, requests } = await phones()
    const session = new HostSession('Hosty')
    const dialing = player.dial(found[0] as Peer, 'Bo')
    const joining = GuestSession.join(dialing.connection, 'Bo', token())
    joining.catch(() => {})
    await later(0)
    host.reject(requests[0] as JoinRequest)
    await expect(joining).rejects.toThrow()
    expect(dialing.connection.state).toBe('closed')
    expect(session.world.players).toHaveLength(1)
    session.close()
  })

  it('drops a player whose Bluetooth goes, and gives their score back when they rejoin', async () => {
    const first = await game()
    const left: string[] = []
    first.session.onLeave = (name) => left.push(name)
    const player = first.session.world.players.find((p) => p.id === 1)
    if (!player) throw new Error('no player')
    player.score = 4
    first.guest.close()
    await later(100)
    expect(left).toEqual(['Bo'])
    // The same phone looks again and asks again.
    await first.player.look('Bo')
    await later(0)
    const dialing = first.player.dial({ endpointId: 'HOST1', name: 'Hosty' }, 'Bo')
    const joining = GuestSession.join(dialing.connection, 'Bo', first.token)
    await later(0)
    const request = first.requests.at(-1) as JoinRequest
    const connection = first.host.accept(request)
    if (!connection) throw new Error('not accepted')
    void first.session.attach(connection).joined
    const again = await joining
    expect(again.rejoined).toBe(true)
    expect(first.session.world.players.find((p) => p.id === 1)?.score).toBe(4)
    first.session.close()
  })

  it('plays with Bluetooth players besides Wi-Fi ones, through the same room', async () => {
    const { session, guest } = await game()
    const { linkPair } = await import('@fionapreroll/p2p/testing')
    const pair = linkPair()
    const attached = session.attach(pair.host.link)
    pair.open()
    const wifi = await GuestSession.join(pair.guest.link, 'Wifi', token())
    await attached.joined
    await later(500)
    expect(session.world.players.map((p) => p.name).sort()).toEqual(['Bo', 'Hosty', 'Wifi'])
    expect(guest.snapshot()?.players).toHaveLength(3)
    expect(wifi.snapshot()?.players).toHaveLength(3)
    session.close()
  })
})
