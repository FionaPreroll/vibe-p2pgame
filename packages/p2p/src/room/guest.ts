import { listen, type Parse, send } from '../channel.ts'
import { type Connection, onLost, opened } from '../connection.ts'
import { guestParser, ROOM_PROTOCOL, type ToGuest, type ToHost } from './messages.ts'
import { type GuestTraffic, TrafficCounter } from './traffic.ts'

/** A ping unanswered this long, in milliseconds, is taken for lost. */
export const PING_LOST_MS = 3000

export interface GuestRoomOptions<State, Event = never> {
  /** The player's name, as everyone sees it (the host shortens and cleans it). */
  readonly name: string
  /** The browser's own token, kept between visits, so the host knows a returning player. */
  readonly token: string
  /** The game's version of its input and state: it must match the host's. */
  readonly version: number
  /** Checks the host's state: a state it turns down is dropped, and the next one comes soon. */
  readonly parseState: Parse<State>
  /** Checks the host's events (see `onEvent`); without it, the player takes none. */
  readonly parseEvent?: Parse<Event>
  /** How often the input goes out, in milliseconds. Default 1000 / 30. */
  readonly tickMs?: number
  /** How often the round trip is measured. Default 1000. */
  readonly pingMs?: number
  /** A host that sends nothing for this long is taken for gone. Default 8000. */
  readonly silenceMs?: number
  /** How long to wait for the host's welcome. Default 10 000. */
  readonly welcomeTimeoutMs?: number
}

/**
 * A player's side of a game: it sends the game's input to the host many times a second, and
 * keeps the newest state the host sends back. Events, such as a move, go both ways and arrive
 * once each, in order. Everything from the host is checked, the game's state by `parseState`
 * and its events by `parseEvent`.
 */
export class GuestRoom<Input, State, Event = never> {
  /** A new state from the host, checked. */
  onState: (state: State) => void = () => {}
  /** Called once if the host is gone: `ended` if the host ended the game on purpose. */
  onLost: (ended: boolean) => void = () => {}
  private latest: State | null = null
  private input: { value: Input } | null = null
  private measured: number | null = null
  private lastSeen = performance.now()
  private readonly timers: ReturnType<typeof setInterval>[] = []
  private lost = false
  private readonly counter = new TrafficCounter()
  private pings = 0
  private pongs = 0
  private lostPings = 0
  /** When the pings still unanswered went out, oldest first. */
  private readonly waiting: number[] = []
  private eventListener: ((event: Event) => void) | null = null
  /** Events that came before anyone listened, such as one the host sent on joining. */
  private readonly early: Event[] = []

  private constructor(
    private readonly link: Connection,
    /** This player's id, as the host's game knows them. */
    readonly id: number,
    /** The host's name. */
    readonly host: string,
    /** True if the host gave this player back their old place. */
    readonly rejoined: boolean,
    parse: Parse<ToGuest<State, Event>>,
    options: GuestRoomOptions<State, Event>,
  ) {
    this.counter.watch(link.control, link.fast)
    listen(link.control, parse, (message) => this.control(message))
    listen(link.fast, parse, (message) => {
      this.lastSeen = performance.now()
      if (message.type === 'state') {
        this.latest = message.data
        this.onState(message.data)
      } else if (message.type === 'pong') {
        // Only the answer to a ping still waiting counts: not one given up on, nor one made up.
        const index = this.waiting.indexOf(message.sent)
        if (index < 0) return
        this.waiting.splice(index, 1)
        this.measured = Math.max(0, performance.now() - message.sent)
        this.pongs++
      }
    })
    onLost(link, () => this.lose(false))
    const silenceMs = options.silenceMs ?? 8000
    this.timers.push(
      setInterval(
        () => {
          if (this.input !== null) {
            this.counter.out(
              send(link.fast, {
                type: 'input',
                data: this.input.value,
                ping: this.measured,
              } satisfies ToHost<Input, Event>),
            )
          }
          if (performance.now() - this.lastSeen > silenceMs) this.lose(false)
        },
        options.tickMs ?? 1000 / 30,
      ),
      setInterval(() => {
        const now = performance.now()
        while (this.waiting.length > 0 && now - (this.waiting[0] ?? now) >= PING_LOST_MS) {
          this.waiting.shift()
          this.lostPings++
        }
        const ping = { type: 'ping', sent: now } satisfies ToHost<Input, Event>
        if (this.counter.out(send(link.fast, ping)) > 0) {
          this.pings++
          this.waiting.push(now)
        }
      }, options.pingMs ?? 1000),
    )
  }

  /**
   * Waits for the connection, says hello and resolves once the host has let the player in.
   * Rejects with `version` if the host runs another version, `full` if there is no room, and
   * `timeout` if the host does not answer.
   */
  static async join<Input, State, Event = never>(
    link: Connection,
    options: GuestRoomOptions<State, Event>,
  ): Promise<GuestRoom<Input, State, Event>> {
    const parse = guestParser(options.parseState, options.parseEvent)
    await opened(link)
    // What the host says right after its welcome, such as an event on joining, waits here
    // until the room listens itself.
    let welcomed = false
    let room: GuestRoom<Input, State, Event> | null = null
    const queued: ToGuest<State, Event>[] = []
    const welcome = await new Promise<Extract<ToGuest<State, Event>, { type: 'welcome' }>>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('timeout')),
          options.welcomeTimeoutMs ?? 10_000,
        )
        listen(link.control, parse, (message) => {
          if (room) return
          if (welcomed) {
            if (queued.length < 100) queued.push(message)
            return
          }
          if (message.type === 'welcome') {
            // A host of another version sends states this phone would misread.
            if (message.room === ROOM_PROTOCOL && message.version === options.version) {
              welcomed = true
              resolve(message)
            } else reject(new Error('version'))
          } else if (message.type === 'mismatch') reject(new Error('version'))
          else if (message.type === 'full') reject(new Error('full'))
          else return
          clearTimeout(timer)
        })
        send(link.control, {
          type: 'hello',
          name: options.name,
          token: options.token,
          room: ROOM_PROTOCOL,
          version: options.version,
        } satisfies ToHost<Input, Event>)
      },
    )
    room = new GuestRoom<Input, State, Event>(
      link,
      welcome.id,
      welcome.host,
      welcome.rejoined,
      parse,
      options,
    )
    for (const message of queued) room.control(message)
    return room
  }

  /**
   * The host's events, checked by `parseEvent`, each once and in order. Events that came before
   * a listener was set are handed to the first one.
   */
  get onEvent(): (event: Event) => void {
    return this.eventListener ?? (() => {})
  }

  set onEvent(listener: (event: Event) => void) {
    this.eventListener = listener
    for (const event of this.early.splice(0)) listener(event)
  }

  /** Sends the host an event, which arrives once, in order with the others. False once lost. */
  send(event: Event): boolean {
    if (this.lost) return false
    return this.counter.out(send(this.link.control, { type: 'event', data: event })) > 0
  }

  /** The newest state from the host, or null before the first. */
  state(): State | null {
    return this.latest
  }

  /** Sets the input the player sends from now on, many times a second. */
  setInput(input: Input): void {
    this.input = { value: input }
  }

  /** The last measured round trip to the host, in milliseconds. */
  ping(): number | null {
    return this.measured
  }

  /**
   * What went to and from the host since the player got in, and the pings: sent, answered, and
   * lost on the way there or back, as they stayed unanswered for `PING_LOST_MS`.
   */
  traffic(): GuestTraffic {
    return {
      ...this.counter.read(),
      pings: this.pings,
      pongs: this.pongs,
      lostPings: this.lostPings,
    }
  }

  private control(message: ToGuest<State, Event>): void {
    if (message.type === 'bye') this.lose(true)
    else if (message.type === 'event' && !this.lost) {
      this.lastSeen = performance.now()
      if (this.eventListener) this.eventListener(message.data)
      else if (this.early.length < 100) this.early.push(message.data)
    }
  }

  close(): void {
    this.lost = true
    for (const timer of this.timers) clearInterval(timer)
    this.link.close()
  }

  private lose(ended: boolean): void {
    if (this.lost) return
    this.close()
    this.onLost(ended)
  }
}
