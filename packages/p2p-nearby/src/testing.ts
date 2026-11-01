import type { NearbyEvent, NearbyNative } from './index.ts'

/**
 * Nearby without phones, for tests of games: each `FakeNearby` plays NearbyPlugin on one phone,
 * and `NearbyAir` carries between them what Nearby would: advertising, requests with the same
 * code on both sides, answers, messages and goodbyes, each a moment later (a microtask). Give a
 * fake to `new Nearby(options, fake)`. `emit` makes up native events, as a misbehaving native
 * side or neighbour would.
 */
export class NearbyAir {
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
        if (player.service === host.service)
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

export class FakeNearby implements NearbyNative {
  role: 'host' | 'player' | null = null
  name = ''
  /** Each connection's answer from this side. */
  readonly answers = new Map<string, 'pending' | 'yes' | 'no'>()
  readonly sent: { endpointId: string; channel: string; data: string }[] = []
  readonly rejected: string[] = []
  /** The service of the last start. */
  service = ''
  readonly disconnected: string[] = []
  startError: unknown = null
  private readonly listeners = new Map<NearbyEvent, ((e: unknown) => void)[]>()

  constructor(
    private readonly air: NearbyAir,
    readonly id: string,
  ) {}

  later(event: NearbyEvent, value: unknown): void {
    queueMicrotask(() => this.emit(event, value))
  }

  emit(event: NearbyEvent, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value)
  }

  async start({ role, name, service }: { role: 'host' | 'player'; name: string; service: string }) {
    if (this.startError) throw this.startError
    this.role = role
    this.name = name
    this.service = service
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
  async diagnostics() {
    return { sdk: 34, bluetooth: 'on', log: ['+0s start player'] }
  }
  async addListener(event: NearbyEvent, listener: (e: unknown) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return { remove: async () => {} }
  }
}
