import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'
import {
  type ChannelName,
  type Connection,
  cleanName,
  type PacketConnection,
  packetConnection,
} from '@fionapreroll/p2p'

/**
 * Bluetooth between phones in the Android app, through NearbyPlugin (Google's Nearby
 * Connections). The host advertises, players discover it, and each accepted player becomes a
 * `Connection` of the library, over which the rooms play as over WebRTC. Only the Android app
 * has it: in a browser, players pair by QR code.
 *
 * The native side is checked like any other phone: every event is read field by field, and
 * messages count only from connections this phone accepted.
 */

/** The native side, as NearbyPlugin.java offers it. */
export interface NearbyPlugin {
  start(options: { role: 'host' | 'player'; name: string }): Promise<void>
  stop(): Promise<void>
  connect(options: { endpointId: string; name: string }): Promise<void>
  accept(options: { endpointId: string }): Promise<void>
  reject(options: { endpointId: string }): Promise<void>
  send(options: { endpointId: string; channel: ChannelName; data: string }): Promise<void>
  disconnect(options: { endpointId: string }): Promise<void>
  reset(): Promise<void>
  addListener(event: NearbyEvent, listener: (event: unknown) => void): Promise<PluginListenerHandle>
}

export type NearbyEvent =
  | 'found'
  | 'lost'
  | 'request'
  | 'connected'
  | 'rejected'
  | 'disconnected'
  | 'message'

export const Nearby = registerPlugin<NearbyPlugin>('Nearby')

/**
 * Bluetooth carries less than a Wi-Fi: a host sends a Bluetooth player 15 states a second,
 * and the dots glide in between as ever.
 */
export const BLUETOOTH_STATE_INTERVAL_MS = 1000 / 15

/** Waiting connection requests shown to a host at once; NearbyPlugin turns down more. */
export const MAX_REQUESTS = 4

/** A game found nearby, or a player who asks to join. */
export interface Peer {
  readonly endpointId: string
  readonly name: string
}

/** A player's request to join, with the code both phones show. */
export interface JoinRequest extends Peer {
  readonly digits: string
}

/** Why Bluetooth could not start, for the player to read. */
export type StartError = 'permission' | 'unavailable' | 'radio'

/** A Bluetooth connection being made: the code to show, then the connection itself. */
export interface Dialing {
  readonly connection: Connection
  /** The code both phones show, once Nearby has it; the host compares it before accepting. */
  readonly digits: Promise<string>
}

interface Link {
  readonly connection: PacketConnection
  /** Set while a player waits for the code of a host they asked. */
  readonly onDigits?: (digits: string) => void
}

export class Bluetooth {
  /** A game found nearby, while looking. */
  onFound: (host: Peer) => void = () => {}
  /** A game no longer found. */
  onLost: (endpointId: string) => void = () => {}
  /** A player asks to join, while advertising. */
  onRequest: (request: JoinRequest) => void = () => {}
  /** A request went away before an answer: the player gave up, or the connection broke. */
  onRequestGone: (endpointId: string) => void = () => {}

  private readonly links = new Map<string, Link>()
  private readonly requests = new Map<string, JoinRequest>()
  private role: 'host' | 'player' | null = null
  private ready: Promise<void> | undefined

  constructor(private readonly plugin: NearbyPlugin = Nearby) {}

  /** Starts advertising this phone's game, under the host's name. */
  host(name: string): Promise<void> {
    return this.start('host', name)
  }

  /** Starts looking for games nearby. */
  look(name: string): Promise<void> {
    return this.start('player', name)
  }

  /** Stops advertising or looking; connections stay. Requests not answered are turned down. */
  async stop(): Promise<void> {
    this.role = null
    for (const endpointId of this.requests.keys())
      void this.plugin.reject({ endpointId }).catch(() => {})
    this.requests.clear()
    await this.plugin.stop().catch(() => {})
  }

  /** The host lets a player in: their connection, to hand to the room. */
  accept(request: JoinRequest): Connection | null {
    if (this.requests.get(request.endpointId) !== request) return null
    this.requests.delete(request.endpointId)
    const connection = this.connection(request.endpointId, BLUETOOTH_STATE_INTERVAL_MS)
    this.plugin
      .accept({ endpointId: request.endpointId })
      .catch(() => this.closed(request.endpointId))
    return connection
  }

  reject(request: JoinRequest): void {
    if (!this.requests.delete(request.endpointId)) return
    void this.plugin.reject({ endpointId: request.endpointId }).catch(() => {})
  }

  /**
   * A player asks a game found nearby to let them in. The connection opens once the host has
   * compared the code and accepted; it closes if the host turns it down.
   */
  dial(host: Peer, name: string): Dialing {
    let digits: (value: string) => void = () => {}
    const promise = new Promise<string>((resolve) => {
      digits = resolve
    })
    this.links.get(host.endpointId)?.connection.close()
    const connection = this.connection(host.endpointId, undefined, digits)
    this.plugin
      .connect({ endpointId: host.endpointId, name })
      .catch(() => this.closed(host.endpointId))
    return { connection, digits: promise }
  }

  private async start(role: 'host' | 'player', name: string): Promise<void> {
    await this.listen()
    this.role = role
    try {
      await this.plugin.start({ role, name: cleanName(name, '?') })
    } catch (error) {
      this.role = null
      throw startError(error)
    }
  }

  /** Listens to the native side, once; leftovers of an earlier page are ended first. */
  private listen(): Promise<void> {
    this.ready ??= (async () => {
      await this.plugin.reset().catch(() => {})
      const on = (event: NearbyEvent, handle: (fields: Record<string, unknown>) => void) =>
        this.plugin.addListener(event, (value) => {
          if (typeof value === 'object' && value !== null) handle(value as Record<string, unknown>)
        })
      await Promise.all([
        on('found', (e) => this.found(e)),
        on(
          'lost',
          (e) => isEndpoint(e.endpointId) && this.role === 'player' && this.onLost(e.endpointId),
        ),
        on('request', (e) => this.request(e)),
        on('connected', (e) => this.connected(e.endpointId)),
        on('rejected', (e) => this.closed(e.endpointId)),
        on('disconnected', (e) => this.closed(e.endpointId)),
        on('message', (e) => this.message(e)),
      ])
    })()
    return this.ready
  }

  private found(e: Record<string, unknown>): void {
    if (this.role !== 'player' || !isEndpoint(e.endpointId)) return
    this.onFound({ endpointId: e.endpointId, name: cleanName(e.name, '?') })
  }

  private request(e: Record<string, unknown>): void {
    const { endpointId } = e
    if (
      !isEndpoint(endpointId) ||
      typeof e.digits !== 'string' ||
      !/^[0-9A-Za-z]{1,8}$/.test(e.digits)
    ) {
      return
    }
    if (e.incoming === true) {
      // Someone asks to join: only a host who advertises hears it, and only a few at once.
      if (this.role !== 'host' || this.requests.has(endpointId) || this.links.has(endpointId))
        return
      if (this.requests.size >= MAX_REQUESTS) {
        void this.plugin.reject({ endpointId }).catch(() => {})
        return
      }
      const request: JoinRequest = { endpointId, name: cleanName(e.name, '?'), digits: e.digits }
      this.requests.set(endpointId, request)
      this.onRequest(request)
    } else {
      // The answer to this phone's own request: show the code, and say yes from this side.
      const link = this.links.get(endpointId)
      if (!link?.onDigits || link.connection.state !== 'connecting') {
        void this.plugin.reject({ endpointId }).catch(() => {})
        return
      }
      link.onDigits(e.digits)
      this.plugin.accept({ endpointId }).catch(() => this.closed(endpointId))
    }
  }

  private connected(endpointId: unknown): void {
    if (!isEndpoint(endpointId)) return
    const link = this.links.get(endpointId)
    if (link) link.connection.markOpen()
    // A connection nobody here asked for or accepted is ended at once.
    else void this.plugin.disconnect({ endpointId }).catch(() => {})
  }

  private closed(endpointId: unknown): void {
    if (!isEndpoint(endpointId)) return
    if (this.requests.delete(endpointId)) this.onRequestGone(endpointId)
    const link = this.links.get(endpointId)
    if (!link) return
    this.links.delete(endpointId)
    link.connection.markClosed()
  }

  private message(e: Record<string, unknown>): void {
    if (!isEndpoint(e.endpointId)) return
    // The connection checks the rest: open, a known channel, short text.
    this.links.get(e.endpointId)?.connection.receive(e.channel, e.data)
  }

  private connection(
    endpointId: string,
    minStateIntervalMs?: number,
    onDigits?: (digits: string) => void,
  ): PacketConnection {
    const connection = packetConnection(
      {
        send: (channel, data) => {
          this.plugin.send({ endpointId, channel, data }).catch(() => {})
        },
        close: () => {
          this.links.delete(endpointId)
          void this.plugin.disconnect({ endpointId }).catch(() => {})
        },
      },
      { minStateIntervalMs },
    )
    this.links.set(endpointId, { connection, onDigits })
    return connection
  }
}

let shared: Bluetooth | undefined

/** The app's one Bluetooth, made when first needed. */
export function bluetooth(): Bluetooth {
  shared ??= new Bluetooth()
  return shared
}

/** Nearby's endpoint ids are short tokens of letters and digits. */
function isEndpoint(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-Za-z]{1,32}$/.test(value)
}

function startError(error: unknown): StartError {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'permission' ? 'permission' : code === 'unavailable' ? 'unavailable' : 'radio'
}
