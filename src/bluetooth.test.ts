import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }))

const { BLUETOOTH_STATE_INTERVAL_MS, Bluetooth, MAX_REQUESTS } = await import('./bluetooth')
const { GuestSession } = await import('./session/guest')
const { HostSession } = await import('./session/host')
type NearbyEvent = import('./bluetooth').NearbyEvent
type NearbyPlugin = import('./bluetooth').NearbyPlugin
type JoinRequest = import('./bluetooth').JoinRequest
type Peer = import('./bluetooth').Peer

/**
 * Bluetooth without phones: each `FakeNearby` plays NearbyPlugin on one phone, and `Air` carries
 * between them what Nearby would: advertising, requests with the same code on both sides,
 * answers, messages and goodbyes, each a moment later. Spark Hunt's real sessions play over it.
 */
class Air {
  readonly phones: FakeNearby[] = []
  private nextDigits = 1000

  phone(id: string): FakeNearby {
    const phone = new FakeNearby(this, id)
    this.phones.push(phone)
    return phone
  }

  find(id: string): FakeNearby | undefined {
    return this.phones.find((p) => p.id === id)
  }

  /** Players looking see every host advertising. */
  announce(): void {
    for (const host of this.phones.filter((p) => p.role === 'host')) {
      for (const player of this.phones.filter((p) => p.role === 'player')) {
        player.later('found', { endpointId: host.id, name: host.name })
      }
    }
  }

  request(player: FakeNearby, hostId: string, name: string): void {
    const host = this.find(hostId)
    if (host?.role !== 'host') {
      throw Object.assign(new Error('not found'), { code: 'nearby-8011' })
    }
    const digits = String(this.nextDigits++)
    player.answers.set(hostId, 'pending')
    host.answers.set(player.id, 'pending')
    host.later('request', { endpointId: player.id, name, digits, incoming: true })
    player.later('request', { endpointId: hostId, name: host.name, digits, incoming: false })
  }

  answered(phone: FakeNearby, otherId: string, yes: boolean): void {
    const other = this.find(otherId)
    if (!other) return
    phone.answers.set(otherId, yes ? 'yes' : 'no')
    const theirs = other.answers.get(phone.id)
    if (!yes) {
      phone.answers.delete(otherId)
      other.answers.delete(phone.id)
      phone.later('rejected', { endpointId: otherId, status: 8004 })
      other.later('rejected', { endpointId: phone.id, status: 8004 })
    } else if (theirs === 'yes') {
      phone.later('connected', { endpointId: otherId })
      other.later('connected', { endpointId: phone.id })
    }
  }

  carry(from: FakeNearby, toId: string, channel: string, data: string): void {
    if (from.answers.get(toId) !== 'yes') throw new Error('Not connected')
    this.find(toId)?.later('message', { endpointId: from.id, channel, data })
  }

  hangUp(from: FakeNearby, toId: string): void {
    from.answers.delete(toId)
    const other = this.find(toId)
    if (other?.answers.delete(from.id)) other.later('disconnected', { endpointId: from.id })
  }
}

class FakeNearby implements NearbyPlugin {
  role: 'host' | 'player' | null = null
  name = ''
  /** Each connection's answer from this side. */
  readonly answers = new Map<string, 'pending' | 'yes' | 'no'>()
  readonly sent: { endpointId: string; channel: string; data: string }[] = []
  readonly rejected: string[] = []
  readonly disconnected: string[] = []
  startError: unknown = null
  private readonly listeners = new Map<NearbyEvent, ((e: unknown) => void)[]>()

  constructor(
    private readonly air: Air,
    readonly id: string,
  ) {}

  later(event: NearbyEvent, value: unknown): void {
    queueMicrotask(() => this.emit(event, value))
  }

  emit(event: NearbyEvent, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value)
  }

  async start({ role, name }: { role: 'host' | 'player'; name: string }) {
    if (this.startError) throw this.startError
    this.role = role
    this.name = name
    this.air.announce()
  }
  async stop() {
    this.role = null
  }
  async connect({ endpointId, name }: { endpointId: string; name: string }) {
    this.air.request(this, endpointId, name)
  }
  async accept({ endpointId }: { endpointId: string }) {
    if (this.answers.get(endpointId) !== 'pending') throw new Error('No such request')
    this.air.answered(this, endpointId, true)
  }
  async reject({ endpointId }: { endpointId: string }) {
    this.rejected.push(endpointId)
    if (this.answers.get(endpointId) === 'pending') this.air.answered(this, endpointId, false)
  }
  async send(message: { endpointId: string; channel: 'control' | 'fast'; data: string }) {
    this.sent.push(message)
    this.air.carry(this, message.endpointId, message.channel, message.data)
  }
  async disconnect({ endpointId }: { endpointId: string }) {
    this.disconnected.push(endpointId)
    this.air.hangUp(this, endpointId)
  }
  async reset() {
    this.answers.clear()
  }
  async addListener(event: NearbyEvent, listener: (e: unknown) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return { remove: async () => {} }
  }
}

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
  const air = new Air()
  const hostPhone = air.phone('HOST1')
  const playerPhone = air.phone('PLAY1')
  const host = new Bluetooth(hostPhone)
  const player = new Bluetooth(playerPhone)
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
    expect(states).toBeGreaterThanOrEqual(Math.floor(1000 / BLUETOOTH_STATE_INTERVAL_MS) - 1)
    expect(states).toBeLessThanOrEqual(Math.ceil(1000 / BLUETOOTH_STATE_INTERVAL_MS) + 1)
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

describe('Bluetooth, starting', () => {
  it('says why it cannot start', async () => {
    for (const [code, expected] of [
      ['permission', 'permission'],
      ['unavailable', 'unavailable'],
      ['nearby-8007', 'radio'],
      [undefined, 'radio'],
    ] as const) {
      const phone = new Air().phone('P1')
      phone.startError = Object.assign(new Error('no'), { code })
      await expect(new Bluetooth(phone).look('Bo')).rejects.toBe(expected)
    }
  })

  it('ends what an earlier page left behind, once', async () => {
    const phone = new Air().phone('P1')
    const reset = vi.spyOn(phone, 'reset')
    const bt = new Bluetooth(phone)
    await bt.look('Bo')
    await bt.look('Bo')
    expect(reset).toHaveBeenCalledOnce()
  })
})

describe('Bluetooth, against a misbehaving native side or neighbour', () => {
  /** A Bluetooth on a phone whose native events the test makes up. */
  async function rigged(role: 'host' | 'player') {
    const phone = new Air().phone('ME')
    const bt = new Bluetooth(phone)
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
