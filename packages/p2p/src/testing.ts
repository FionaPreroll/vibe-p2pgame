import type { Channel } from './channel.ts'
import type { Connection, ConnectionState } from './connection.ts'

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
  /** While true, sent messages are lost on the way, as on a broken Wi-Fi. */
  dropping = false

  send(data: string): void {
    if (this.readyState !== 'open') throw new Error(`send on a ${this.readyState} channel`)
    if (typeof data !== 'string') throw new Error('only strings are sent')
    this.sent.push(data)
    const peer = this.peer
    if (this.dropping || !peer) return
    queueMicrotask(() => {
      if (peer.readyState === 'open')
        peer.events.dispatchEvent(new MessageEvent('message', { data }))
    })
  }

  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void {
    this.events.addEventListener(type, listener as EventListener)
  }
}

/** One side of a connection in memory. */
export class FakeConnection implements Connection {
  state: ConnectionState = 'connecting'
  peer: FakeConnection | undefined
  readonly control = new FakeChannel()
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
 */
export function linkPair(options: { minStateIntervalMs?: number } = {}): {
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
