import type { Link } from '@fionapreroll/p2p'
import { GuestRoom } from '@fionapreroll/p2p/room'
import type { Snapshot, Target } from '../game/sim'
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
  private steer: Target = null

  private constructor(private readonly room: GuestRoom<Target, Snapshot>) {
    room.onLost = (ended) => this.onLost(ended)
    room.setInput(null)
  }

  /**
   * Waits for the connection, says hello and resolves once the host has let the player in.
   * The token lets the host recognise a player who comes back.
   */
  static async join(link: Link, name: string, token: string): Promise<GuestSession> {
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
    this.room.close()
  }
}
