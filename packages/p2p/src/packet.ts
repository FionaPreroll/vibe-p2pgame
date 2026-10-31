import { type Channel, MAX_MESSAGE_LENGTH } from './channel.ts'
import type { Connection, ConnectionState } from './connection.ts'

/**
 * A connection over any transport that carries text messages, such as Bluetooth: the transport
 * sends each message tagged with its channel, and hands what arrives to `receive`. Where the
 * transport is busy, it may drop `fast` messages, as WebRTC's unreliable channel would.
 */
export type ChannelName = 'control' | 'fast'

export interface PacketTransport {
  send(channel: ChannelName, data: string): void
  /** Ends the transport's connection. `markClosed` follows, or is called here. */
  close(): void
}

export interface PacketConnection extends Connection {
  /**
   * A message that arrived. Whatever the other side or the transport hands over is checked:
   * only text no longer than `MAX_MESSAGE_LENGTH`, on one of the two channels, while the
   * connection is open, reaches the channel's listeners.
   */
  receive(channel: unknown, data: unknown): void
  /** The transport is connected: the channels open. */
  markOpen(): void
  /** The transport is gone: the channels close, for good. */
  markClosed(): void
}

export interface PacketOptions {
  /** See `Connection.minStateIntervalMs`. */
  readonly minStateIntervalMs?: number
}

class PacketChannel implements Channel {
  private readonly events = new EventTarget()

  constructor(
    private readonly owner: PacketConnectionImpl,
    private readonly name: ChannelName,
  ) {}

  get readyState(): RTCDataChannelState {
    const state = this.owner.state
    return state === 'open' ? 'open' : state === 'closed' ? 'closed' : 'connecting'
  }

  send(data: string): void {
    if (this.owner.state !== 'open') throw new Error(`send on a ${this.readyState} channel`)
    this.owner.transport.send(this.name, data)
  }

  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void {
    this.events.addEventListener(type, listener as EventListener)
  }

  deliver(data: string): void {
    this.events.dispatchEvent(new MessageEvent('message', { data }))
  }
}

class PacketConnectionImpl implements PacketConnection {
  state: ConnectionState = 'connecting'
  readonly control: PacketChannel
  readonly fast: PacketChannel
  readonly minStateIntervalMs: number | undefined
  private readonly listeners: (() => void)[] = []

  constructor(
    readonly transport: PacketTransport,
    options: PacketOptions,
  ) {
    this.control = new PacketChannel(this, 'control')
    this.fast = new PacketChannel(this, 'fast')
    this.minStateIntervalMs = options.minStateIntervalMs
  }

  onStateChange(listener: () => void): void {
    this.listeners.push(listener)
  }

  receive(channel: unknown, data: unknown): void {
    if (this.state !== 'open' || typeof data !== 'string' || data.length > MAX_MESSAGE_LENGTH)
      return
    const target = channel === 'control' ? this.control : channel === 'fast' ? this.fast : null
    target?.deliver(data)
  }

  markOpen(): void {
    if (this.state !== 'connecting') return
    this.state = 'open'
    this.changed()
  }

  markClosed(): void {
    if (this.state === 'closed') return
    this.state = 'closed'
    this.changed()
  }

  close(): void {
    if (this.state === 'closed') return
    this.markClosed()
    this.transport.close()
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

export function packetConnection(
  transport: PacketTransport,
  options: PacketOptions = {},
): PacketConnection {
  return new PacketConnectionImpl(transport, options)
}
