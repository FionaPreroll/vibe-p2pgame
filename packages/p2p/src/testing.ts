import type { Channel } from './channel.ts'
import type { Connection, ConnectionState } from './connection.ts'
import type { ConnectionDetails } from './details.ts'

/**
 * How a channel in memory carries messages, as a weak Wi-Fi or a hotspot at the edge of its
 * range would: some are lost, each takes a while, and on an unordered channel a later one may
 * overtake an earlier one. The same seed loses the same messages and delays them alike, so a
 * test that fails once fails every time.
 */
export interface Conditions {
  /** The share of messages lost on the way, from 0 to 1. Default 0. */
  readonly loss?: number
  /**
   * How long a message takes, in milliseconds: always the same, or for each message anything
   * from the first to the second. Default 0, a moment later.
   */
  readonly delayMs?: number | readonly [number, number]
  /** Which messages are lost, and how late each one is. Default 1. */
  readonly seed?: number
}

/** Numbers from 0 up to, not including, 1, the same for the same seed (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Two phones connected in memory, for tests: what one side sends on a channel arrives on the
 * other side's channel of the same name, a moment later, as over a real connection. No browser
 * needed, so a game's host and players can be tested in Node, with fake timers.
 */
export class FakeChannel implements Channel {
  private readonly events = new EventTarget()
  readyState: RTCDataChannelState = 'connecting'
  peer: FakeChannel | undefined
  /** Every message this side sent, as the other side received it. */
  readonly sent: string[] = []
  /** Messages lost on the way, by `dropping` or by `conditions`. */
  lost = 0
  /** While true, sent messages are lost on the way, as on a broken Wi-Fi. */
  dropping = false
  private current: Conditions = {}
  private random: () => number = seededRandom(1)
  /** When the last message is due on an ordered channel, as `performance.now()`. */
  private lastDue = Number.NEGATIVE_INFINITY

  constructor(
    /**
     * Whether messages arrive in the order sent, as on a reliable channel: a message that
     * takes less time than the one before it waits for it.
     */
    readonly ordered = false,
  ) {}

  /** How this side's messages travel from now on (see `Conditions`). */
  get conditions(): Conditions {
    return this.current
  }

  set conditions(conditions: Conditions) {
    this.current = conditions
    this.random = seededRandom(conditions.seed ?? 1)
  }

  send(data: string): void {
    if (this.readyState !== 'open') throw new Error(`send on a ${this.readyState} channel`)
    if (typeof data !== 'string') throw new Error('only strings are sent')
    this.sent.push(data)
    const peer = this.peer
    const { loss = 0, delayMs = 0 } = this.current
    if (this.dropping || !peer || (loss > 0 && this.random() < loss)) {
      this.lost++
      return
    }
    const deliver = () => {
      if (peer.readyState === 'open')
        peer.events.dispatchEvent(new MessageEvent('message', { data }))
    }
    let delay =
      typeof delayMs === 'number'
        ? delayMs
        : delayMs[0] + this.random() * Math.max(0, delayMs[1] - delayMs[0])
    if (delay <= 0 && this.lastDue === Number.NEGATIVE_INFINITY) {
      queueMicrotask(deliver)
      return
    }
    if (this.ordered) {
      const now = performance.now()
      delay = Math.max(delay, this.lastDue - now)
      this.lastDue = now + delay
    }
    setTimeout(deliver, delay)
  }

  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void {
    this.events.addEventListener(type, listener as EventListener)
  }
}

/** One side of a connection in memory. */
export class FakeConnection implements Connection {
  state: ConnectionState = 'connecting'
  peer: FakeConnection | undefined
  readonly control = new FakeChannel(true)
  readonly fast = new FakeChannel()
  private readonly listeners: (() => void)[] = []

  constructor(readonly minStateIntervalMs?: number) {}

  onStateChange(listener: () => void): void {
    this.listeners.push(listener)
  }

  /** Both sides are connected, as when the codes have been scanned. */
  connect(): void {
    if (this.state !== 'connecting') return
    for (const channel of [this.control, this.fast]) channel.readyState = 'open'
    this.change('open')
  }

  /** The channels' counts, as a transport in memory has no addresses. */
  async details(): Promise<ConnectionDetails> {
    const channels = (['control', 'fast'] as const).map((label) => {
      const own = this[label]
      const other = this.peer?.[label]
      return {
        label,
        state: own.readyState,
        messagesSent: own.sent.length,
        messagesReceived: other ? other.sent.length - other.lost : 0,
      }
    })
    return { transport: 'memory', channels }
  }

  /** This side hangs up; the other side notices, as WebRTC does after a while. */
  close(): void {
    if (this.state === 'closed') return
    this.change('closed')
    this.peer?.fail()
  }

  /** The other side is gone, or the line broke. */
  fail(): void {
    this.change('closed')
  }

  private change(state: ConnectionState): void {
    if (this.state === state) return
    this.state = state
    if (state === 'closed')
      for (const channel of [this.control, this.fast]) channel.readyState = 'closed'
    for (const listener of [...this.listeners]) listener()
  }
}

export interface FakeSide {
  /** The side as a `Connection`, to hand to a room. */
  readonly link: Connection
  readonly connection: FakeConnection
  readonly control: FakeChannel
  readonly fast: FakeChannel
}

/**
 * A connection between a host and a player; `open` connects it, as scanning both codes does.
 * `minStateIntervalMs` makes the host's side a slow connection (see `Connection`).
 *
 * `conditions` make it a weak one, both ways: `fast` loses, delays and reorders messages, as
 * WebRTC's unreliable channel does, while `control` only delays them and keeps their order, as
 * a reliable channel would resend what was lost. The two directions draw from different seeds.
 * Each channel's `conditions` can also be set on its own, at any time.
 */
export function linkPair(options: { minStateIntervalMs?: number; conditions?: Conditions } = {}): {
  host: FakeSide
  guest: FakeSide
  open(): void
} {
  const host = new FakeConnection(options.minStateIntervalMs)
  const guest = new FakeConnection()
  host.peer = guest
  guest.peer = host
  host.control.peer = guest.control
  guest.control.peer = host.control
  host.fast.peer = guest.fast
  guest.fast.peer = host.fast
  const conditions = options.conditions
  if (conditions) {
    const seed = conditions.seed ?? 1
    host.fast.conditions = { ...conditions, seed }
    guest.fast.conditions = { ...conditions, seed: seed + 1 }
    const delayed = { delayMs: conditions.delayMs }
    host.control.conditions = { ...delayed, seed: seed + 2 }
    guest.control.conditions = { ...delayed, seed: seed + 3 }
  }
  const side = (connection: FakeConnection): FakeSide => ({
    link: connection,
    connection,
    control: connection.control,
    fast: connection.fast,
  })
  return {
    host: side(host),
    guest: side(guest),
    open() {
      host.connect()
      guest.connect()
    },
  }
}
