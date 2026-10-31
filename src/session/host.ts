import type { Connection } from '@fionapreroll/p2p'
import { HOST_ID, HostRoom, type Joined, type Pairing } from '@fionapreroll/p2p/room'
import {
  addPlayer,
  type Catch,
  createWorld,
  MAX_PLAYERS,
  removePlayer,
  type Snapshot,
  startRound,
  step,
  type Target,
  type World,
} from '../game/sim'
import { PROTOCOL, parseInput } from '../net/protocol'
import { forgetHostedGame, type HostedGame, saveHostedGame } from './saved'
import type { Session } from './session'

export type { Joined, Pairing }

/** How often the host saves the game, so a reloaded page can carry on. */
const SAVE_MS = 2000

/**
 * The host's side of Spark Hunt: the room of `@fionapreroll/p2p` lets players in and out and
 * carries the messages; this class runs the rules on every tick and sends the snapshot.
 *
 * Players who drop out keep their place in the room, and their score here, and the host saves
 * the game every few seconds, so that after a reload it can carry on with the same players.
 */
export class HostSession implements Session {
  readonly isHost = true
  readonly world: World = createWorld((Math.random() * 2 ** 31) | 0)
  /** Called when someone's connection is lost, with their name. */
  onLeave: (name: string) => void = () => {}
  /** Called with every spark caught and every mine touched. */
  onCatch: (caught: Catch) => void = () => {}
  private readonly room: HostRoom<Target, Snapshot>
  private readonly targets = new Map<number, Target>()
  /** The scores of players who are away, for when they rejoin. */
  private readonly awayScores = new Map<number, number>()
  private lastSave = 0
  private readonly onPageHide = () => this.save()

  constructor(name: string, saved?: HostedGame | null) {
    addPlayer(this.world, HOST_ID, name).score = saved?.hostScore ?? 0
    for (const p of saved?.players ?? []) this.awayScores.set(p.id, p.score)
    this.room = new HostRoom<Target, Snapshot>({
      name,
      version: PROTOCOL,
      parseInput,
      maxPlayers: MAX_PLAYERS,
      restore: saved
        ? {
            nextId: saved.nextId,
            seats: saved.players.map(({ token, id, name }) => ({ token, id, name })),
          }
        : undefined,
    })
    this.room.onJoin = (player) => {
      addPlayer(this.world, player.id, player.name).score = this.awayScores.get(player.id) ?? 0
      this.awayScores.delete(player.id)
      this.save()
    }
    this.room.onLeave = (player, reason) => {
      this.awayScores.set(player.id, this.scoreOf(player.id))
      this.targets.delete(player.id)
      removePlayer(this.world, player.id)
      this.save()
      if (reason === 'lost') this.onLeave(player.name)
    }
    this.room.onInput = (player, target) => this.targets.set(player.id, target)
    this.room.onTick = (dt) => this.tick(dt)
    globalThis.addEventListener?.('pagehide', this.onPageHide)
    this.save()
  }

  selfId(): number {
    return HOST_ID
  }

  /** The game as this phone draws it: the world, and the players away, without their tokens. */
  snapshot(): Snapshot {
    return { ...this.world, away: this.room.awaySeats().map(({ id, name }) => ({ id, name })) }
  }

  setTarget(target: Target): void {
    this.targets.set(HOST_ID, target)
  }

  target(): Target {
    return this.targets.get(HOST_ID) ?? null
  }

  /** A new round, from nothing for everyone, away or not. */
  start(seconds: number): void {
    startRound(this.world, seconds)
    for (const id of this.awayScores.keys()) this.awayScores.set(id, 0)
  }

  pair(): Promise<Pairing> {
    return this.room.pair()
  }

  /** Takes a connection made elsewhere: Bluetooth, or memory in tests (see `HostRoom.attach`). */
  attach(link: Connection): { joined: Promise<Joined>; cancel(): void } {
    return this.room.attach(link)
  }

  /**
   * Leaves the game. `ended`: the host ends it for everyone, who are told so, and it is not
   * offered to carry on; otherwise, as when the page closes, the game stays saved.
   */
  close(ended = true): void {
    globalThis.removeEventListener?.('pagehide', this.onPageHide)
    this.room.close(ended)
    if (ended) forgetHostedGame()
    else this.save()
  }

  private scoreOf(id: number): number {
    return this.world.players.find((p) => p.id === id)?.score ?? this.awayScores.get(id) ?? 0
  }

  private save(): void {
    this.lastSave = performance.now()
    const { nextId, seats } = this.room.saveSeats()
    saveHostedGame({
      hostScore: this.scoreOf(HOST_ID),
      players: seats.map((seat) => ({ ...seat, score: this.scoreOf(seat.id) })),
      nextId,
    })
  }

  private tick(dt: number): Snapshot {
    for (const caught of step(this.world, this.targets, dt)) this.onCatch(caught)
    for (const { id, ping } of this.room.players()) {
      const player = this.world.players.find((p) => p.id === id)
      if (player) player.ping = ping
    }
    if (performance.now() - this.lastSave > SAVE_MS) this.save()
    return compact(this.snapshot())
  }
}

/** The world as players need it, with positions rounded: a third of the bytes. */
function compact(state: Snapshot): Snapshot {
  return {
    phase: state.phase,
    timeLeft: Math.round(state.timeLeft * 10) / 10,
    players: state.players.map((p) => ({ ...p, x: Math.round(p.x), y: Math.round(p.y) })),
    sparks: state.sparks.map((s) => ({ ...s, x: Math.round(s.x), y: Math.round(s.y) })),
    mines: state.mines.map((m) => ({
      ...m,
      x: Math.round(m.x),
      y: Math.round(m.y),
      armIn: Math.round(m.armIn * 10) / 10,
    })),
    blasts: state.blasts.map((b) => ({
      ...b,
      x: Math.round(b.x),
      y: Math.round(b.y),
      age: Math.round(b.age * 100) / 100,
    })),
    away: state.away,
  }
}
