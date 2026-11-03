import { type Connection, type ConnectionDetails, opened } from '@fionapreroll/p2p'
import type { NetLog } from '@fionapreroll/p2p/debug'
import { type ConnectionTest, GuestRoom, HOST_ID } from '@fionapreroll/p2p/room'
import type { Phase, Snapshot, Target } from '../game/sim'
import { log } from '../log'
import { rememberNet } from '../net/netlog'
import { IDLE_INPUT, type PlayerInput, PROTOCOL, parseSnapshot } from '../net/protocol'
import type { Session } from './session'

/**
 * How long a player's phone waits for its connection to the host to open: for the host to take
 * its answer, or over Bluetooth to accept. Scanning takes seconds, but a code copied, sent over a
 * messenger and pasted on the other phone can take minutes. The Spielekiste waits as long.
 */
export const ANSWER_WAIT_MS = 10 * 60_000

/**
 * A player's side of Spark Hunt, on the room of `@fionapreroll/p2p`: it sends where the player
 * steers, whether they are ready for the next round and whether they only watch, and shows the
 * snapshots the host sends back, each checked by `parseSnapshot`. Ready ends as a round starts.
 */
export class GuestSession implements Session {
  readonly isHost = false
  /** Called once if the host is gone: `ended` if the host ended the game on purpose. */
  onLost: (ended: boolean) => void = () => {}
  /** The host started a connection test; the room takes part by itself. */
  onTestStart: () => void = () => {}
  /** A connection test is over: how this player's connection did. */
  onTestResult: (result: ConnectionTest) => void = () => {}
  private input: PlayerInput = IDLE_INPUT
  private phase: Phase | null = null

  private constructor(private readonly room: GuestRoom<PlayerInput, Snapshot>) {
    rememberNet(this)
    room.onLost = (ended) => this.onLost(ended)
    room.onTestStart = () => {
      log('net', 'the host tests the connection')
      this.onTestStart()
    }
    room.onTestResult = (result) => this.onTestResult(result)
    room.onState = (state) => {
      if (state.phase !== this.phase) {
        this.phase = state.phase
        if (state.phase === 'countdown' || state.phase === 'play') this.send({ ready: false })
      }
    }
    room.setInput(this.input)
  }

  /**
   * Waits for the connection, up to `ANSWER_WAIT_MS`, says hello and resolves once the host has
   * let the player in. The token lets the host recognise a player who comes back.
   */
  static async join(link: Connection, name: string, token: string): Promise<GuestSession> {
    await opened(link, ANSWER_WAIT_MS)
    const room = await GuestRoom.join<PlayerInput, Snapshot>(link, {
      name,
      token,
      version: PROTOCOL,
      parseState: parseSnapshot,
      netNote: (line) => log('net', line),
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

  /** How well the connection to the host keeps up, as the room samples it. */
  get net(): NetLog {
    return this.room.net
  }

  peers(): number[] {
    return [HOST_ID]
  }

  details(): Promise<ConnectionDetails | null> {
    return this.room.details()
  }

  lastTest(): ConnectionTest | null {
    return this.room.lastTest()
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
    this.room.close()
  }
}
