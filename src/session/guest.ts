import type { Snapshot, Target } from '../game/sim'
import { type Link, onLost, opened } from '../net/link'
import { listen, send, type ToGuest } from '../net/protocol'
import { type Session, SILENCE_MS, TICK_MS } from './session'

const PING_MS = 1000
const WELCOME_TIMEOUT_MS = 10_000

/** A player's phone: it sends where the player steers, and shows what the host sends back. */
export class GuestSession implements Session {
  readonly isHost = false
  /** Called once if the host is gone. */
  onLost: () => void = () => {}
  private state: Snapshot | null = null
  private steer: Target = null
  private ping: number | null = null
  private lastSeen = performance.now()
  private readonly timers: number[] = []
  private lost = false

  private constructor(
    private readonly link: Link,
    private readonly id: number,
  ) {
    listen<ToGuest>(link.fast, (message) => {
      this.lastSeen = performance.now()
      if (message.type === 'state') this.state = message.state
      else if (message.type === 'pong') this.ping = performance.now() - message.sent
    })
    onLost(link, () => this.lose())
    this.timers.push(
      window.setInterval(() => {
        send(link.fast, {
          type: 'input',
          x: this.steer?.x ?? null,
          y: this.steer?.y ?? null,
          ping: this.ping,
        })
        if (performance.now() - this.lastSeen > SILENCE_MS) this.lose()
      }, TICK_MS),
      window.setInterval(() => send(link.fast, { type: 'ping', sent: performance.now() }), PING_MS),
    )
  }

  /** Waits for the connection, says hello and resolves once the host has let the player in. */
  static async join(link: Link, name: string): Promise<GuestSession> {
    await opened(link)
    const id = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), WELCOME_TIMEOUT_MS)
      listen<ToGuest>(link.control, (message) => {
        if (message.type === 'welcome' && typeof message.id === 'number') resolve(message.id)
        else if (message.type === 'full') reject(new Error('full'))
        else return
        clearTimeout(timer)
      })
      send(link.control, { type: 'hello', name })
    })
    return new GuestSession(link, id)
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

  private lose(): void {
    if (this.lost) return
    this.close()
    this.onLost()
  }
}
