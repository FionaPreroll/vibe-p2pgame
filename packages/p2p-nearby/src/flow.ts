import type { Connection } from '@fionapreroll/p2p'
import type { JoinRequest, Nearby, Peer } from './index.ts'

/**
 * The Bluetooth flow every game has, without its screens: a host who advertises and lets players
 * in, one by one, after comparing the code; a player who looks for games nearby and asks one.
 * The game draws what these say and calls them back; they hold the order of things, such as
 * stopping to look before asking, closing a connection that did not make it, and telling a host
 * who said no from a join that failed.
 *
 * Each runs on one `Nearby` and takes over its callbacks until closed.
 */

/**
 * How long, in milliseconds, a player the host accepted has for their connection to open, as
 * `opened` waits by default. One that never connects, such as a phone gone out of reach or one
 * that never completes Nearby's handshake, is then given up, and fails with `Connection timed
 * out`, instead of staying on its way for good. Once open, the room's hello timeout takes over.
 */
const JOIN_TIMEOUT_MS = 30_000

/** A request as the host sees it: still to decide, being let in, or let in but failed. */
export interface HostRequest {
  readonly request: JoinRequest
  readonly status: 'waiting' | 'joining' | 'failed'
  /**
   * Why it failed, for the game to say: such as the room's `version` or `full`, or `Connection
   * timed out` if the connection never opened.
   */
  readonly error?: unknown
}

/**
 * The host's side: advertises the game under the host's name, shows each player who asks with
 * the code both phones show, and lets in those the host accepts, through `attach`, such as
 * `(connection) => room.attach(connection).joined`.
 */
export class NearbyHosting<T> {
  /** The requests or their status changed. */
  onChange: () => void = () => {}
  /** A player got in: what `attach` gave. */
  onJoined: (value: T, request: JoinRequest) => void = () => {}
  /** Resolves once the game is advertised; rejects as `Nearby.host` does, with a `NearbyStartError`. */
  readonly started: Promise<void>

  private readonly list = new Map<string, HostRequest>()
  private ended = false

  constructor(
    private readonly nearby: Nearby,
    name: string,
    private readonly attach: (connection: Connection) => Promise<T>,
  ) {
    nearby.onRequest = (request) => {
      if (this.ended) return
      this.list.set(request.endpointId, { request, status: 'waiting' })
      this.onChange()
    }
    nearby.onRequestGone = (endpointId) => {
      if (this.list.get(endpointId)?.status !== 'waiting') return
      this.list.delete(endpointId)
      this.onChange()
    }
    this.started = nearby.host(name)
    // Whoever waits for it hears how it went; nobody waiting is no error.
    this.started.catch(() => {})
  }

  /** The requests, oldest first. */
  requests(): readonly HostRequest[] {
    return [...this.list.values()]
  }

  /** Whether the host closed this; what was started still comes, but nothing new. */
  get closed(): boolean {
    return this.ended
  }

  /** Lets a player in, once the host saw the same code on both phones. */
  accept(endpointId: string): void {
    const entry = this.list.get(endpointId)
    if (this.ended || entry?.status !== 'waiting') return
    const connection = this.nearby.accept(entry.request)
    if (!connection) {
      this.list.delete(endpointId)
      this.onChange()
      return
    }
    this.list.set(endpointId, { request: entry.request, status: 'joining' })
    this.onChange()
    let timedOut = false
    const timer = setTimeout(() => {
      if (connection.state === 'open') return
      timedOut = true
      connection.close()
    }, JOIN_TIMEOUT_MS)
    this.attach(connection).then(
      (value) => {
        clearTimeout(timer)
        this.list.delete(endpointId)
        this.onChange()
        this.onJoined(value, entry.request)
      },
      (error: unknown) => {
        clearTimeout(timer)
        connection.close()
        const reason = timedOut ? new Error('Connection timed out') : error
        this.list.set(endpointId, { request: entry.request, status: 'failed', error: reason })
        this.onChange()
      },
    )
  }

  /** Turns a player down; their phone hears so. */
  reject(endpointId: string): void {
    const entry = this.list.get(endpointId)
    if (!entry) return
    if (entry.status === 'waiting') this.nearby.reject(entry.request)
    this.list.delete(endpointId)
    this.onChange()
  }

  /** Stops advertising: requests not answered are turned down, players let in stay. */
  async close(): Promise<void> {
    if (this.ended) return
    this.ended = true
    this.nearby.onRequest = () => {}
    this.nearby.onRequestGone = () => {}
    await this.nearby.stop()
  }
}

/** Where a player's search stands. */
export type SearchState =
  /** Starting to look. */
  | { readonly phase: 'starting' }
  /** Looking: `hosts()` lists the games found. */
  | { readonly phase: 'looking' }
  /** Looking did not start: `error` says why, mostly a `NearbyStartError`. */
  | { readonly phase: 'unavailable'; readonly error: unknown }
  /** Asked `host`: the code, once both phones have it, which the host compares. */
  | { readonly phase: 'asking'; readonly host: Peer; readonly digits: string | null }
  /** In the game. */
  | { readonly phase: 'joined'; readonly host: Peer }
  /** The host said no, or the connection broke before it opened. */
  | { readonly phase: 'refused'; readonly host: Peer }
  /** The connection opened, but joining failed: `error` says why, such as `version` or `full`. */
  | { readonly phase: 'failed'; readonly host: Peer; readonly error: unknown }
  /** The player left. */
  | { readonly phase: 'left' }

export interface NearbySearchOptions<T> {
  /** What to do with a join that comes after the player left, such as closing it. */
  readonly discard?: (value: T) => void
}

/**
 * The player's side: looks for games nearby at once, lists them, and asks the one the player
 * chooses; once the host accepts, joins through `join`, such as
 * `(connection) => GuestRoom.join(connection, options)`.
 */
export class NearbySearch<T> {
  /** The state or the games found changed. */
  onChange: () => void = () => {}
  /** In the game: what `join` gave. */
  onJoined: (value: T, host: Peer) => void = () => {}

  private current: SearchState = { phase: 'starting' }
  private readonly found = new Map<string, Peer>()
  /** The connection to the host asked, until the player is in or it failed. */
  private dialing: Connection | null = null

  constructor(
    private readonly nearby: Nearby,
    private readonly name: string,
    private readonly join: (connection: Connection) => Promise<T>,
    private readonly options: NearbySearchOptions<T> = {},
  ) {
    nearby.onFound = (host) => {
      if (this.current.phase !== 'looking' && this.current.phase !== 'starting') return
      if (this.found.has(host.endpointId)) return
      this.found.set(host.endpointId, host)
      this.onChange()
    }
    nearby.onLost = (endpointId) => {
      if (this.found.delete(endpointId)) this.onChange()
    }
    this.look()
  }

  state(): SearchState {
    return this.current
  }

  /** The games found, in the order found. */
  hosts(): readonly Peer[] {
    return [...this.found.values()]
  }

  /** Asks a game found to let the player in; looking stops. Only while looking. */
  async choose(host: Peer): Promise<void> {
    if (this.current.phase !== 'looking') return
    this.set({ phase: 'asking', host, digits: null })
    // Asking this host still, after each wait: the player may have left, or looked again.
    const asking = () => {
      const now = this.state()
      return now.phase === 'asking' && now.host === host
    }
    await this.nearby.stop()
    if (!asking()) return
    const { connection, digits } = this.nearby.dial(host, this.name)
    this.dialing = connection
    let open = false
    connection.onStateChange(() => {
      if (connection.state === 'open') open = true
    })
    void digits.then((code) => {
      if (asking()) this.set({ phase: 'asking', host, digits: code })
    })
    try {
      const value = await this.join(connection)
      this.dialing = null
      if (!asking()) {
        this.options.discard?.(value)
        return
      }
      this.set({ phase: 'joined', host })
      this.onJoined(value, host)
    } catch (error) {
      this.dialing = null
      connection.close()
      if (!asking()) return
      this.set(open ? { phase: 'failed', host, error } : { phase: 'refused', host })
    }
  }

  /** Looks again, after a game said no, joining failed, or looking did not start. */
  again(): void {
    const { phase } = this.current
    if (phase !== 'refused' && phase !== 'failed' && phase !== 'unavailable') return
    this.found.clear()
    this.look()
  }

  /**
   * Stops looking, or asking: the host's phone no longer shows the request. A join that still
   * comes is handed to `discard`.
   */
  async leave(): Promise<void> {
    if (this.current.phase === 'left') return
    this.set({ phase: 'left' })
    this.dialing?.close()
    this.dialing = null
    this.nearby.onFound = () => {}
    this.nearby.onLost = () => {}
    await this.nearby.stop()
  }

  private look(): void {
    this.set({ phase: 'starting' })
    this.nearby.look(this.name).then(
      () => {
        if (this.current.phase === 'starting') this.set({ phase: 'looking' })
      },
      (error: unknown) => {
        if (this.current.phase === 'starting') this.set({ phase: 'unavailable', error })
      },
    )
  }

  private set(state: SearchState): void {
    this.current = state
    this.onChange()
  }
}
