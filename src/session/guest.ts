import type { Connection } from '@fionapreroll/p2p'
import { GuestRoom, HOST_ID } from '@fionapreroll/p2p/room'
import type { Snapshot, Target } from '../game/sim'
import { type NetLog, SAMPLE_MS, startNetLog } from '../net/netlog'
import { PROTOCOL, parseSnapshot } from '../net/protocol'
import type { Session } from './session'

/**
 * A player's side of Spark Hunt, on the room of `@fionapreroll/p2p`: it sends where the player
 * steers, and shows the snapshots the host sends back, each checked by `parseSnapshot`.
 */
export class GuestSession implements Session {
  readonly isHost = false
  /** Called once if the host is gone: `ended` if the host ended the game on purpose. */
  onLost: (ended: boolean) => void = () => {}
  readonly net: NetLog
  private steer: Target = null
  private readonly sampler: ReturnType<typeof setInterval>

  private constructor(private readonly room: GuestRoom<Target, Snapshot>) {
    this.net = startNetLog(room.id, performance.now())
    room.onLost = (ended) => {
      clearInterval(this.sampler)
      this.onLost(ended)
    }
    room.onState = () => this.net.arrived(HOST_ID, performance.now())
    room.setInput(null)
    const sample = () =>
      this.net.sample(HOST_ID, performance.now(), { ping: room.ping(), traffic: room.traffic() })
    sample()
    this.sampler = setInterval(sample, SAMPLE_MS)
  }

  /**
   * Waits for the connection, says hello and resolves once the host has let the player in.
   * The token lets the host recognise a player who comes back.
   */
  static async join(link: Connection, name: string, token: string): Promise<GuestSession> {
    const room = await GuestRoom.join<Target, Snapshot>(link, {
      name,
      token,
      version: PROTOCOL,
      parseState: parseSnapshot,
    })
    return new GuestSession(room)
  }

  /** The host's name, to offer rejoining their game. */
  get host(): string {
    return this.room.host
  }

  /** True if the host gave this player back their place and score. */
  get rejoined(): boolean {
    return this.room.rejoined
  }

  selfId(): number {
    return this.room.id
  }

  snapshot(): Snapshot | null {
    return this.room.state()
  }

  setTarget(target: Target): void {
    this.steer = target
    this.room.setInput(target)
  }

  target(): Target {
    return this.steer
  }

  close(): void {
    clearInterval(this.sampler)
    this.room.close()
  }
}
