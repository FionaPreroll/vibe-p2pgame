import { cleanName, listen, type Parse, send } from '../channel.ts'
import { type Connection, onLost, opened } from '../connection.ts'
import { acceptAnswer, createOffer } from '../link.ts'
import type { Signal } from '../signal.ts'
import { hostParser, ROOM_PROTOCOL, type ToGuest, type ToHost } from './messages.ts'
import { type Seat, Seats } from './seats.ts'
import { type Traffic, TrafficCounter } from './traffic.ts'

/** The host's own player id: players who join get 1, 2 and so on. */
export const HOST_ID = 0

/** Events a player may send in a second; more are dropped, so no phone can flood the host. */
export const MAX_EVENTS_PER_SECOND = 30

export interface HostRoomOptions<Input, Event = never> {
  /** The host's name, as players see it. */
  readonly name: string
  /** The game's version of its input and state: only players with the same one get in. */
  readonly version: number
  /** Checks a player's input: anything it turns down is dropped. */
  readonly parseInput: Parse<Input>
  /** Checks a player's events (see `onEvent`); without it, the room takes none. */
  readonly parseEvent?: Parse<Event>
  /** Players at most, the host included. Default 8. */
  readonly maxPlayers?: number
  /** How often `onTick` runs and the state goes out, in milliseconds. Default 1000 / 30. */
  readonly tickMs?: number
  /** A player who sends nothing for this long is dropped. Default 8000. */
  readonly silenceMs?: number
  /** A new connection that is open but says no hello for this long is closed. Default 15 000. */
  readonly helloTimeoutMs?: number
  /** The seats of a game saved before (see `seats()`), so its players can rejoin. */
  readonly restore?: { readonly nextId: number; readonly seats: readonly Seat[] }
}

/** A player in the room, as the host's game sees them. */
export interface RoomPlayer {
  readonly id: number
  readonly name: string
  /** Round trip time in milliseconds, as the player last measured it. */
  readonly ping: number | null
}

export interface Joined {
  readonly player: RoomPlayer
  /** True for a player who had dropped out and is back in their old place. */
  readonly rejoined: boolean
}

/** One pending invitation: the code to show, and what to do with the answer. */
export interface Pairing {
  readonly code: string
  /** Completes the connection; resolves once the player is in. */
  accept(answer: Signal): Promise<Joined>
  /** Drops the invitation, unless the player has already joined. */
  cancel(): void
}

/** Why a player left: their connection was lost, or the same browser came back on a new one. */
export type LeaveReason = 'lost' | 'replaced'

interface Guest {
  readonly connection: Connection
  /** When this player last got a state, for connections that want fewer (minStateIntervalMs). */
  lastState: number
  readonly token: string
  name: string
  ping: number | null
  readonly traffic: TrafficCounter
  lastSeen: number
  /** The events taken in the current second, and when it began. */
  events: number
  eventsSince: number
}

/**
 * The host's side of a game: players connect to it alone, a star, and it decides everything.
 * The room lets players in, checks their versions, keeps the places of players who drop out
 * for when they rejoin, drops players who fall silent, answers pings, and every tick sends the
 * game's state to everyone. The game itself lives in the callbacks.
 *
 * Two ways carry a game: input and state, sent many times a second, where only the newest
 * counts and a lost one is skipped; and events, such as a move or a chat line, which arrive
 * once each, in order. `stateFor` gives each player a state of their own, such as their cards.
 *
 * Every message from a player is checked, the game's input by `parseInput` and its events by
 * `parseEvent`; a player only ever sends for themselves, and player tokens never leave the host.
 */
export class HostRoom<Input, State, Event = never> {
  /** A player came in; `rejoined` if they had a place before. */
  onJoin: (player: RoomPlayer, rejoined: boolean) => void = () => {}
  /** A player left, but keeps their place. */
  onLeave: (player: RoomPlayer, reason: LeaveReason) => void = () => {}
  /** A player's input, checked by `parseInput`. */
  onInput: (player: RoomPlayer, input: Input) => void = () => {}
  /** A player's event, checked by `parseEvent`: each arrives once, in the order sent. */
  onEvent: (player: RoomPlayer, event: Event) => void = () => {}
  /** Runs every tick with the seconds since the last one; returns the state to send, if any. */
  onTick: (dt: number) => State | undefined = () => undefined
  /**
   * What each player gets of the tick's state, such as only their own cards. Without it,
   * everyone gets the same. It runs once a tick for each player who gets a state.
   */
  stateFor: ((player: RoomPlayer, state: State) => State) | null = null

  private readonly guests = new Map<number, Guest>()
  private readonly seats: Seats
  private readonly parse: Parse<ToHost<Input, Event>>
  private readonly maxPlayers: number
  private readonly silenceMs: number
  private readonly helloTimeoutMs: number
  private last = performance.now()
  private readonly tickMs: number
  private readonly timer: ReturnType<typeof setInterval>
  private closed = false

  constructor(private readonly options: HostRoomOptions<Input, Event>) {
    this.parse = hostParser(options.parseInput, options.parseEvent)
    this.maxPlayers = options.maxPlayers ?? 8
    this.silenceMs = options.silenceMs ?? 8000
    this.helloTimeoutMs = options.helloTimeoutMs ?? 15_000
    this.seats = new Seats(options.restore?.nextId ?? HOST_ID + 1, options.restore?.seats)
    this.tickMs = options.tickMs ?? 1000 / 30
    this.timer = setInterval(() => this.tick(), this.tickMs)
  }

  /** Makes an invitation for one player: an offer code to show, and the answer to take. */
  async pair(): Promise<Pairing> {
    const { link, code } = await createOffer()
    const attached = this.attach(link)
    return {
      code,
      accept: async (answer) => {
        await acceptAnswer(link, answer)
        await opened(link)
        return attached.joined
      },
      cancel: attached.cancel,
    }
  }

  /**
   * Takes a new connection into the room, of any kind (see `Connection`): waits for the
   * player's hello, then lets them in, or tells them why not. Listening starts at once, before the channels open, so the hello
   * cannot slip by. Only the first hello counts. `joined` rejects with `version` or `full`,
   * with `closed` if the connection closes first, and with `timeout` if it opens and says no
   * hello in time.
   */
  attach(link: Connection): { joined: Promise<Joined>; cancel(): void } {
    let said = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const joined = new Promise<Joined>((resolve, reject) => {
      // A connection that closes before its hello, or opens and never says it, is given up:
      // a misbehaving phone cannot hold a connection open without joining.
      const giveUp = (reason: string, close: boolean) => {
        if (said) return
        said = true
        clearTimeout(timer)
        if (close) link.close()
        reject(new Error(reason))
      }
      link.onStateChange(() => {
        if (link.state === 'closed') giveUp('closed', false)
        else if (link.state === 'open' && timer === undefined && !said) {
          timer = setTimeout(() => giveUp('timeout', true), this.helloTimeoutMs)
        }
      })
      if (link.state === 'open')
        timer = setTimeout(() => giveUp('timeout', true), this.helloTimeoutMs)
      listen(link.control, this.parse, (message) => {
        if (message.type !== 'hello' || said || this.closed) return
        said = true
        clearTimeout(timer)
        if (message.room !== ROOM_PROTOCOL || message.version !== this.options.version) {
          this.refuse(link, {
            type: 'mismatch',
            room: ROOM_PROTOCOL,
            version: this.options.version,
          })
          return reject(new Error('version'))
        }
        // The same browser again, while its old connection has not timed out yet: the old
        // one is dead, as a browser only ever plays from one page.
        const returning = [...this.guests].find(([, guest]) => guest.token === message.token)
        if (returning && message.token) this.drop(returning[0], 'replaced')
        if (this.guests.size + 1 >= this.maxPlayers) {
          this.refuse(link, { type: 'full' })
          return reject(new Error('full'))
        }
        resolve(this.admit(link, cleanName(message.name, '?'), message.token))
      })
    })
    // Whoever waits for it hears how it ended; an invitation nobody waits for may end quietly.
    joined.catch(() => {})
    return {
      joined,
      cancel: () => {
        if (!said) link.close()
      },
    }
  }

  /** The players connected now, the host not included. */
  players(): RoomPlayer[] {
    return [...this.guests].map(([id, guest]) => ({ id, name: guest.name, ping: guest.ping }))
  }

  /**
   * Sends one player an event, which arrives once, in order with the others. False if the
   * player is not connected now: a player who rejoins gets the game's state, not what they
   * missed.
   */
  send(id: number, event: Event): boolean {
    const guest = this.guests.get(id)
    if (!guest || this.closed) return false
    return guest.traffic.out(send(guest.connection.control, { type: 'event', data: event })) > 0
  }

  /** Sends every player connected now the same event. */
  broadcast(event: Event): void {
    for (const id of this.guests.keys()) this.send(id, event)
  }

  /** What went to and from a player connected now, since they got in; null for anyone else. */
  traffic(id: number): Traffic | null {
    return this.guests.get(id)?.traffic.read() ?? null
  }

  /** The players who left and may rejoin. */
  awaySeats(): Seat[] {
    return this.seats.awaySeats()
  }

  /**
   * Every place, of players connected and away, to save: given back as `restore`, it lets the
   * same players rejoin a game whose host page was closed. Tokens are in here: keep it local.
   */
  saveSeats(): { nextId: number; seats: Seat[] } {
    const connected = [...this.guests].map(([id, guest]) => ({
      token: guest.token,
      id,
      name: guest.name,
    }))
    return { nextId: this.seats.next, seats: [...connected, ...this.seats.awaySeats()] }
  }

  /**
   * Closes the room. `ended`: the host ends the game for everyone, who are told so, and there
   * is nothing to rejoin; otherwise, as when the page closes, players may rejoin later.
   */
  close(ended = true): void {
    if (this.closed) return
    this.closed = true
    clearInterval(this.timer)
    if (ended)
      for (const guest of this.guests.values()) send(guest.connection.control, { type: 'bye' })
    const links = [...this.guests.values()].map((guest) => guest.connection)
    this.guests.clear()
    // A moment for the goodbyes to leave before the connections close.
    setTimeout(() => {
      for (const link of links) link.close()
    }, 300)
  }

  private refuse(link: Connection, message: ToGuest<State, Event>): void {
    send(link.control, message)
    setTimeout(() => link.close(), 500)
  }

  private admit(link: Connection, name: string, token: string): Joined {
    // Without a token, a player cannot come back: a seat of their own that nobody claims.
    const seatToken = token || `anonymous-${Math.random()}`
    const { id, rejoined } = this.seats.claim(seatToken)
    const guest: Guest = {
      connection: link,
      name,
      token: seatToken,
      ping: null,
      traffic: new TrafficCounter(),
      lastSeen: performance.now(),
      lastState: Number.NEGATIVE_INFINITY,
      events: 0,
      eventsSince: Number.NEGATIVE_INFINITY,
    }
    this.guests.set(id, guest)
    guest.traffic.watch(link.control, link.fast)
    guest.traffic.out(
      send(link.control, {
        type: 'welcome',
        id,
        host: this.options.name,
        rejoined,
        room: ROOM_PROTOCOL,
        version: this.options.version,
      } satisfies ToGuest<State, Event>),
    )
    // After the hello, `control` carries only events, a few a second at most.
    listen(link.control, this.parse, (message) => {
      if (this.guests.get(id) !== guest || message.type !== 'event') return
      const now = performance.now()
      guest.lastSeen = now
      if (now - guest.eventsSince >= 1000) {
        guest.eventsSince = now
        guest.events = 0
      }
      if (++guest.events > MAX_EVENTS_PER_SECOND) return
      this.onEvent({ id, name, ping: guest.ping }, message.data)
    })
    // `fast` carries input and pings; whatever else arrives is dropped.
    listen(link.fast, this.parse, (message) => {
      if (this.guests.get(id) !== guest) return
      guest.lastSeen = performance.now()
      if (message.type === 'ping') {
        guest.traffic.out(
          send(link.fast, { type: 'pong', sent: message.sent } satisfies ToGuest<State, Event>),
        )
      } else if (message.type === 'input') {
        guest.ping = message.ping === null ? null : Math.round(message.ping)
        this.onInput({ id, name, ping: guest.ping }, message.data)
      }
    })
    onLost(link, () => this.drop(id, 'lost'))
    const player = { id, name, ping: null }
    this.onJoin(player, rejoined)
    return { player, rejoined }
  }

  private drop(id: number, reason: LeaveReason): void {
    const guest = this.guests.get(id)
    if (!guest) return
    this.guests.delete(id)
    this.seats.leave({ token: guest.token, id, name: guest.name })
    guest.connection.close()
    this.onLeave({ id, name: guest.name, ping: guest.ping }, reason)
  }

  private tick(): void {
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    for (const [id, guest] of this.guests) {
      if (now - guest.lastSeen > this.silenceMs) this.drop(id, 'lost')
    }
    const state = this.onTick(dt)
    if (state === undefined) return
    const shared = this.stateFor ? null : stateMessage(state)
    for (const [id, guest] of this.guests) {
      const { fast, minStateIntervalMs = 0 } = guest.connection
      // Half a tick of leeway: ticks do not fall exactly on the interval.
      if (
        fast.readyState !== 'open' ||
        now - guest.lastState < minStateIntervalMs - this.tickMs / 2
      ) {
        continue
      }
      guest.lastState = now
      const message =
        shared ??
        stateMessage(this.stateFor?.({ id, name: guest.name, ping: guest.ping }, state) ?? state)
      fast.send(message)
      guest.traffic.out(message.length)
    }
  }
}

function stateMessage<State>(state: State): string {
  return JSON.stringify({ type: 'state', data: state } satisfies ToGuest<State>)
}
