import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'
import {
  type ChannelName,
  type Connection,
  cleanName,
  type PacketConnection,
  packetConnection,
} from '@fionapreroll/p2p'

/**
 * Bluetooth between phones for `@fionapreroll/p2p`, in Android apps made with Capacitor,
 * through NearbyPlugin (Google's Nearby Connections, android/). The host advertises, players
 * discover it, and each accepted player becomes a `Connection` of the library, over which the
 * rooms play as over WebRTC. In a browser there is no native side: starting fails.
 *
 * The native side is checked like any other phone: every event is read field by field, and
 * messages count only from connections this phone accepted.
 */

/** The native side, as NearbyPlugin.java offers it. */
export interface NearbyNative {
  /** `service`: the game's own Nearby service, so that only its phones find each other. */
  start(options: { role: 'host' | 'player'; name: string; service: string }): Promise<void>
  stop(): Promise<void>
  connect(options: { endpointId: string; name: string }): Promise<void>
  accept(options: { endpointId: string }): Promise<void>
  reject(options: { endpointId: string }): Promise<void>
  send(options: { endpointId: string; channel: ChannelName; data: string }): Promise<void>
  disconnect(options: { endpointId: string }): Promise<void>
  reset(): Promise<void>
  /**
   * The phone, Google Play services, Bluetooth, Location, every permission and the native log,
   * for a debug report (see NearbyPlugin.diagnostics). The log says what happened: endpoint ids
   * and statuses, never names or messages.
   */
  diagnostics(): Promise<Record<string, unknown>>
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

let native: NearbyNative | undefined

/** The native plugin, registered with Capacitor when first needed. */
export function nearbyNative(): NearbyNative {
  native ??= registerPlugin<NearbyNative>('Nearby')
  return native
}

/**
 * Bluetooth carries less than a Wi-Fi: by default, a host sends a Bluetooth player 15 states a
 * second (`minStateIntervalMs` of its connection), and games smooth in between.
 */
export const STATE_INTERVAL_MS = 1000 / 15

export interface NearbyOptions {
  /**
   * The game's own Nearby service, such as `com.example.mygame`: 3 to 64 letters, digits,
   * dots, dashes or underscores. Phones find only games of the same service.
   */
  readonly serviceId: string
  /** The least time between two states to one player; default `STATE_INTERVAL_MS`. */
  readonly stateIntervalMs?: number
  /**
   * Takes a line for the game's log, about what happens: endpoint ids, roles and native codes,
   * never names or messages.
   */
  readonly log?: (line: string) => void
}

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
export type StartErrorKind =
  | 'permission'
  | 'unavailable'
  | 'bluetooth-off'
  | 'location-off'
  | 'radio'

/** Nearby could not start: the kind, for the player, and the native code and message, for a report. */
export class NearbyStartError extends Error {
  constructor(
    readonly kind: StartErrorKind,
    /** NearbyPlugin's code, such as `nearby-8007`, or `failed`. */
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'NearbyStartError'
  }
}

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

/**
 * Nearby on this phone, for a host or a player. The game shows what happens (games found,
 * players asking with their code) and decides; each connection made is a `Connection` to hand
 * to `HostRoom.attach` or `GuestRoom.join`.
 */
export class Nearby {
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
  private readonly log: (line: string) => void

  constructor(
    private readonly options: NearbyOptions,
    private readonly plugin: NearbyNative = nearbyNative(),
  ) {
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(options.serviceId)) throw new Error('Bad serviceId')
    this.log = options.log ?? (() => {})
  }

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
    const connection = this.connection(
      request.endpointId,
      this.options.stateIntervalMs ?? STATE_INTERVAL_MS,
    )
    this.plugin
      .accept({ endpointId: request.endpointId })
      .catch(() => this.closed(request.endpointId))
    return connection
  }

  reject(request: JoinRequest): void {
    if (!this.requests.delete(request.endpointId)) return
    this.log(`rejecting ${request.endpointId}`)
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
    this.log(`asking ${host.endpointId} to join`)
    this.plugin.connect({ endpointId: host.endpointId, name }).catch((error: unknown) => {
      this.log(`could not ask ${host.endpointId}: ${describeError(error)}`)
      this.closed(host.endpointId)
    })
    return { connection, digits: promise }
  }

  private async start(role: 'host' | 'player', name: string): Promise<void> {
    await this.listen()
    this.role = role
    this.log(`start as ${role}`)
    try {
      await this.plugin.start({ role, name: cleanName(name, '?'), service: this.options.serviceId })
      this.log(`started as ${role}`)
    } catch (error) {
      this.role = null
      const failure = startError(error)
      this.log(`could not start as ${role}: ${failure.kind} (${failure.code}: ${failure.message})`)
      throw failure
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

  /** What the native side says about this phone, for a debug report. */
  diagnostics(): Promise<Record<string, unknown>> {
    return this.plugin.diagnostics()
  }

  private found(e: Record<string, unknown>): void {
    if (this.role !== 'player' || !isEndpoint(e.endpointId)) return
    this.log(`found game ${e.endpointId}`)
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
      this.log(`request from ${endpointId}`)
      const request: JoinRequest = { endpointId, name: cleanName(e.name, '?'), digits: e.digits }
      this.requests.set(endpointId, request)
      this.onRequest(request)
    } else {
      // The answer to this phone's own request: show the code, and say yes from this side.
      const link = this.links.get(endpointId)
      if (!link?.onDigits || link.connection.state !== 'connecting') {
        this.log(`turned down an answer nobody asked for, from ${endpointId}`)
        void this.plugin.reject({ endpointId }).catch(() => {})
        return
      }
      this.log(`answer from ${endpointId}`)
      link.onDigits(e.digits)
      this.plugin.accept({ endpointId }).catch(() => this.closed(endpointId))
    }
  }

  private connected(endpointId: unknown): void {
    if (!isEndpoint(endpointId)) return
    const link = this.links.get(endpointId)
    this.log(`connected to ${endpointId}${link ? '' : ', which nobody asked for: ending it'}`)
    if (link) link.connection.markOpen()
    // A connection nobody here asked for or accepted is ended at once.
    else void this.plugin.disconnect({ endpointId }).catch(() => {})
  }

  private closed(endpointId: unknown): void {
    if (!isEndpoint(endpointId)) return
    if (this.links.has(endpointId) || this.requests.has(endpointId))
      this.log(`closed ${endpointId}`)
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

/** Nearby's endpoint ids are short tokens of letters and digits. */
function isEndpoint(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-Za-z]{1,32}$/.test(value)
}

const KINDS: readonly StartErrorKind[] = [
  'permission',
  'unavailable',
  'bluetooth-off',
  'location-off',
]

function startError(error: unknown): NearbyStartError {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown }
  const text = typeof code === 'string' ? code : 'failed'
  const kind = (KINDS as readonly unknown[]).includes(code) ? (code as StartErrorKind) : 'radio'
  return new NearbyStartError(kind, text, typeof message === 'string' ? message.slice(0, 300) : '')
}

/** An error as a short line for the log: its code and message. */
function describeError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error).slice(0, 300)
  const { code, message } = error as { code?: unknown; message?: unknown }
  return [code, message]
    .filter((part) => part !== undefined && part !== '')
    .map(String)
    .join(': ')
    .slice(0, 300)
}
