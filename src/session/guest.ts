import type { Snapshot, Target } from '../game/sim'
import { type Link, onLost, opened } from '../net/link'
import { listen, PROTOCOL, parseToGuest, send, type ToGuest } from '../net/protocol'
import { type Session, SILENCE_MS, TICK_MS } from './session'

const PING_MS = 1000
const WELCOME_TIMEOUT_MS = 10_000

/** A player's phone: it sends where the player steers, and shows what the host sends back. */
export class GuestSession implements Session {
  readonly isHost = false
  /** Called once if the host is gone: `ended` if the host ended the game on purpose. */
  onLost: (ended: boolean) => void = () => {}
  private state: Snapshot | null = null
  private steer: Target = null
  private ping: number | null = null
  private lastSeen = performance.now()
  private readonly timers: ReturnType<typeof setInterval>[] = []
  private lost = false

  private constructor(
    private readonly link: Link,
    private readonly id: number,
    /** The host's name, to offer rejoining their game. */
    readonly host: string,
    /** True if the host gave this player back their place and score. */
    readonly rejoined: boolean,
  ) {
    listen(link.control, parseToGuest, (message) => {
      if (message.type === 'bye') this.lose(true)
    })
    // Snapshots are checked whole by the parser: a bad one is dropped, the next one drawn.
    listen(link.fast, parseToGuest, (message) => {
      this.lastSeen = performance.now()
      if (message.type === 'state') this.state = message.state
      else if (message.type === 'pong') this.ping = performance.now() - message.sent
    })
    onLost(link, () => this.lose(false))
    this.timers.push(
      setInterval(() => {
        send(link.fast, {
          type: 'input',
          x: this.steer?.x ?? null,
          y: this.steer?.y ?? null,
          ping: this.ping,
        })
        if (performance.now() - this.lastSeen > SILENCE_MS) this.lose(false)
      }, TICK_MS),
      setInterval(() => send(link.fast, { type: 'ping', sent: performance.now() }), PING_MS),
    )
  }

  /**
   * Waits for the connection, says hello and resolves once the host has let the player in.
   * The token lets the host recognise a player who comes back.
   */
  static async join(link: Link, name: string, token: string): Promise<GuestSession> {
    await opened(link)
    const welcome = await new Promise<Extract<ToGuest, { type: 'welcome' }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), WELCOME_TIMEOUT_MS)
      listen(link.control, parseToGuest, (message) => {
        if (message.type === 'welcome') {
          // A host without a version, or another one, sends snapshots this phone misreads.
          if (message.version === PROTOCOL) resolve(message)
          else reject(new Error('version'))
        } else if (message.type === 'mismatch') reject(new Error('version'))
        else if (message.type === 'full') reject(new Error('full'))
        else return
        clearTimeout(timer)
      })
      send(link.control, { type: 'hello', name, token, version: PROTOCOL })
    })
    return new GuestSession(link, welcome.id, welcome.host, welcome.rejoined)
  }

  selfId(): number {
    return this.id
  }

  snapshot(): Snapshot | null {
    return this.state
  }

  setTarget(target: Target): void {
    this.steer = target
  }

  target(): Target {
    return this.steer
  }

  close(): void {
    this.lost = true
    for (const timer of this.timers) clearInterval(timer)
    this.link.pc.close()
  }

  private lose(ended: boolean): void {
    if (this.lost) return
    this.close()
    this.onLost(ended)
  }
}
