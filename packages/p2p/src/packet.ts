import { type Channel, MAX_MESSAGE_LENGTH } from './channel.ts'
import type { Connection, ConnectionState } from './connection.ts'
import type { ConnectionDetails } from './details.ts'

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
  /**
   * What the transport tells about the connection, such as what it is (`bluetooth`) and the
   * other end's id, for `Connection.details`; the channels' counts are added.
   */
  details?(): Partial<ConnectionDetails> | Promise<Partial<ConnectionDetails>>
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
  /** The channels' counts, beside what the transport tells (`PacketTransport.details`). */
  details(): Promise<ConnectionDetails>
}

export interface PacketOptions {
  /** See `Connection.minStateIntervalMs`. */
  readonly minStateIntervalMs?: number
}

class PacketChannel implements Channel {
  private readonly events = new EventTarget()
  messagesSent = 0
  messagesReceived = 0
  charsSent = 0
  charsReceived = 0

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
    this.messagesSent++
    this.charsSent += data.length
    this.owner.transport.send(this.name, data)
  }

  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void {
    this.events.addEventListener(type, listener as EventListener)
  }

  deliver(data: string): void {
    this.messagesReceived++
    this.charsReceived += data.length
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

  async details(): Promise<ConnectionDetails> {
    const own = (await this.transport.details?.()) ?? {}
    const channels = [this.control, this.fast].map((channel, i) => ({
      label: i === 0 ? 'control' : 'fast',
      state: channel.readyState,
      messagesSent: channel.messagesSent,
      messagesReceived: channel.messagesReceived,
      bytesSent: channel.charsSent,
      bytesReceived: channel.charsReceived,
    }))
    return { transport: 'packets', ...own, channels: [...channels, ...(own.channels ?? [])] }
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
