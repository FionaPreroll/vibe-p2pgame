import type { Connection, ConnectionDetails } from '@fionapreroll/p2p'
import { type NetLog, SAMPLE_MS } from '@fionapreroll/p2p/debug'
import {
  type ConnectionTestRun,
  HOST_ID,
  HostRoom,
  type Joined,
  type Pairing,
} from '@fionapreroll/p2p/room'
import {
  addPlayer,
  allReady,
  type Catch,
  createWorld,
  MAX_PLAYERS,
  ROUND_SECONDS,
  removePlayer,
  type Snapshot,
  startRound,
  step,
  type Target,
  type World,
} from '../game/sim'
import { log } from '../log'
import { rememberNet } from '../net/netlog'
import { type PlayerInput, PROTOCOL, parseInput } from '../net/protocol'
import { forgetHostedGame, type HostedGame, saveHostedGame } from './saved'
import type { Session } from './session'

export type { Joined, Pairing }

/** How often the host saves the game, so a reloaded page can carry on. */
const SAVE_MS = 2000
/** A player whose connection stalled this often in the last ten seconds keeps stalling. */
export const STALLS_TO_WARN = 3
/** The host hears about the same player's stalls at most this often. */
const STALL_WARNING_MS = 60_000

/**
 * The host's side of Spark Hunt: the room of `@fionapreroll/p2p` lets players in and out and
 * carries the messages; this class runs the rules on every tick and sends the snapshot.
 *
 * Players who drop out keep their place in the room, and their score here, and the host saves
 * the game every few seconds, so that after a reload it can carry on with the same players.
 *
 * Players may only watch: they leave the field, keeping their score, and come back between
 * rounds. After a round, once every player is ready, the next one starts by itself.
 */
export class HostSession implements Session {
  readonly isHost = true
  readonly world: World = createWorld((Math.random() * 2 ** 31) | 0)
  /** Called when someone's connection is lost, with their name. */
  onLeave: (name: string) => void = () => {}
  /** Called with every spark caught and every mine touched. */
  onCatch: (caught: Catch) => void = () => {}
  /** Called when a player's connection keeps stalling, with their name, now and then. */
  onStalling: (name: string) => void = () => {}
  /** The length of a round the next one gets when it starts by itself. */
  roundSeconds = ROUND_SECONDS
  private readonly room: HostRoom<PlayerInput, Snapshot>
  private readonly targets = new Map<number, Target>()
  /** The scores of players who are away, for when they rejoin. */
  private readonly awayScores = new Map<number, number>()
  /** Players who only watch, with their names and scores, for when they play again. */
  private readonly watchers = new Map<number, { name: string; score: number }>()
  private readonly stallWarnings = new Map<number, number>()
  private lastSave = 0
  private lastSample = performance.now()
  private readonly onPageHide = () => this.save()

  constructor(name: string, saved?: HostedGame | null) {
    addPlayer(this.world, HOST_ID, name).score = saved?.hostScore ?? 0
    for (const p of saved?.players ?? []) this.awayScores.set(p.id, p.score)
    this.room = new HostRoom<PlayerInput, Snapshot>({
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
      netNote: (line) => log('net', line),
    })
    rememberNet(this)
    this.room.onJoin = (player) => {
      addPlayer(this.world, player.id, player.name).score = this.awayScores.get(player.id) ?? 0
      this.awayScores.delete(player.id)
      this.save()
    }
    this.room.onLeave = (player, reason) => {
      this.awayScores.set(player.id, this.scoreOf(player.id))
      this.watchers.delete(player.id)
      this.targets.delete(player.id)
      removePlayer(this.world, player.id)
      this.save()
      if (reason === 'lost') this.onLeave(player.name)
    }
    this.room.onInput = (player, input) => this.input(player.id, player.name, input)
    this.room.onTick = (dt) => this.tick(dt)
    globalThis.addEventListener?.('pagehide', this.onPageHide)
    this.save()
  }

  selfId(): number {
    return HOST_ID
  }

  /** How well the connection to every player keeps up, as the room samples it. */
  get net(): NetLog {
    return this.room.net
  }

  peers(): number[] {
    return this.room.players().map((p) => p.id)
  }

  details(peer: number): Promise<ConnectionDetails | null> {
    return this.room.details(peer)
  }

  /** Tests every player's connection for five seconds, beside the game. */
  testConnections(): Promise<ConnectionTestRun> {
    log('net', 'connection test started')
    return this.room.testConnections().then((run) => {
      log(
        'net',
        `connection test over: ${run.players.filter((p) => p.result).length} of ${run.players.length} answered`,
      )
      return run
    })
  }

  lastTest(): ConnectionTestRun | null {
    return this.room.lastTest()
  }

  /**
   * The game as this phone draws it: the world, the players away, without their tokens, and
   * those who watch.
   */
  snapshot(): Snapshot {
    return {
      ...this.world,
      away: this.room.awaySeats().map(({ id, name }) => ({ id, name })),
      watching: [...this.watchers].map(([id, { name }]) => ({ id, name })),
    }
  }

  setTarget(target: Target): void {
    this.targets.set(HOST_ID, target)
  }

  target(): Target {
    return this.targets.get(HOST_ID) ?? null
  }

  /** A new round, from nothing for everyone, away, watching or not. */
  start(seconds: number): void {
    this.roundSeconds = seconds
    startRound(this.world, seconds)
    for (const id of this.awayScores.keys()) this.awayScores.set(id, 0)
    for (const watcher of this.watchers.values()) watcher.score = 0
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
    return (
      this.world.players.find((p) => p.id === id)?.score ??
      this.watchers.get(id)?.score ??
      this.awayScores.get(id) ??
      0
    )
  }

  /**
   * A player's input: where they steer, ready or not between rounds, and whether they only
   * watch. Watching starts at any time; playing again only between rounds, so nobody drops into
   * a round half-way.
   */
  private input(id: number, name: string, input: PlayerInput): void {
    const between = this.world.phase === 'lobby' || this.world.phase === 'over'
    const watcher = this.watchers.get(id)
    if (watcher && !input.watch && between) {
      this.watchers.delete(id)
      addPlayer(this.world, id, name).score = watcher.score
    } else if (!watcher && input.watch) {
      this.watchers.set(id, { name, score: this.scoreOf(id) })
      this.targets.delete(id)
      removePlayer(this.world, id)
    }
    const player = this.world.players.find((p) => p.id === id)
    if (!player) return
    this.targets.set(id, input.target)
    if (between) player.ready = input.ready
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

  /** Tells the host, now and then, when a player's connection keeps stalling. */
  private warnOfStalls(id: number, now: number): void {
    const t = (now - this.net.startedAt) / 1000
    if (this.net.stallsSince(id, t - 10) < STALLS_TO_WARN) return
    if (now - (this.stallWarnings.get(id) ?? Number.NEGATIVE_INFINITY) < STALL_WARNING_MS) return
    this.stallWarnings.set(id, now)
    log('net', `player ${id}'s connection keeps stalling`)
    const player = this.world.players.find((p) => p.id === id) ?? this.watchers.get(id)
    if (player) this.onStalling(player.name)
  }

  private tick(dt: number): Snapshot {
    for (const caught of step(this.world, this.targets, dt)) this.onCatch(caught)
    // A rematch: once everyone is ready after a round, the next one starts.
    if (this.world.phase === 'over' && allReady(this.world, HOST_ID)) {
      log('game', 'everyone is ready: the next round starts')
      this.start(this.roundSeconds)
    }
    for (const { id, ping } of this.room.players()) {
      const player = this.world.players.find((p) => p.id === id)
      if (player) player.ping = ping
    }
    const now = performance.now()
    if (now - this.lastSave > SAVE_MS) this.save()
    if (now - this.lastSample >= SAMPLE_MS) {
      this.lastSample = now
      for (const { id } of this.room.players()) this.warnOfStalls(id, now)
    }
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
    watching: state.watching,
  }
}
