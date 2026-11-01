import type { Connection } from '@fionapreroll/p2p'
import { GuestRoom, HOST_ID } from '@fionapreroll/p2p/room'
import type { Phase, Snapshot, Target } from '../game/sim'
import { type NetLog, SAMPLE_MS, startNetLog } from '../net/netlog'
import { IDLE_INPUT, type PlayerInput, PROTOCOL, parseSnapshot } from '../net/protocol'
import type { Session } from './session'

/**
 * A player's side of Spark Hunt, on the room of `@fionapreroll/p2p`: it sends where the player
 * steers, whether they are ready for the next round and whether they only watch, and shows the
 * snapshots the host sends back, each checked by `parseSnapshot`. Ready ends as a round starts.
 */
export class GuestSession implements Session {
  readonly isHost = false
  /** Called once if the host is gone: `ended` if the host ended the game on purpose. */
  onLost: (ended: boolean) => void = () => {}
  readonly net: NetLog
  private input: PlayerInput = IDLE_INPUT
  private phase: Phase | null = null
  private readonly sampler: ReturnType<typeof setInterval>

  private constructor(private readonly room: GuestRoom<PlayerInput, Snapshot>) {
    this.net = startNetLog(room.id, performance.now())
    room.onLost = (ended) => {
      clearInterval(this.sampler)
      this.onLost(ended)
    }
    room.onState = (state) => {
      this.net.arrived(HOST_ID, performance.now())
      if (state.phase !== this.phase) {
        this.phase = state.phase
        if (state.phase === 'countdown' || state.phase === 'play') this.send({ ready: false })
      }
    }
    room.setInput(this.input)
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
    const room = await GuestRoom.join<PlayerInput, Snapshot>(link, {
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
    this.send({ target })
  }

  target(): Target {
    return this.input.target
  }

  /** Ready for the next round, or not any more. */
  setReady(ready: boolean): void {
    this.send({ ready })
  }

  ready(): boolean {
    return this.input.ready
  }

  /** Only watch, without a dot, or play again from the next round on. */
  setWatching(watch: boolean): void {
    this.send({ watch, ready: false, target: null })
  }

  watching(): boolean {
    return this.input.watch
  }

  private send(change: Partial<PlayerInput>): void {
    this.input = { ...this.input, ...change }
    this.room.setInput(this.input)
  }

  close(): void {
    clearInterval(this.sampler)
    this.room.close()
  }
}
