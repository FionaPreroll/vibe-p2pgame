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
import { acceptAnswer, createOffer, type Link, onLost, opened } from '../net/link'
import { listen, PROTOCOL, send, type ToGuest, type ToHost } from '../net/protocol'
import type { Signal } from '../net/signal'
import { forgetHostedGame, type HostedGame, saveHostedGame } from './saved'
import { Seats } from './seats'
import { cleanName, type Session, SILENCE_MS, TICK_MS } from './session'

const HOST_ID = 0
/** How often the host saves the game, so a reloaded page can carry on. */
const SAVE_MS = 2000

interface Guest {
  readonly link: Link
  readonly name: string
  readonly token: string
  lastSeen: number
}

export interface Joined {
  readonly name: string
  /** True for a player who had dropped out and is back with their score. */
  readonly rejoined: boolean
}

/** One pending invitation: the code to show, and what to do with the answer. */
export interface Pairing {
  readonly code: string
  /** Completes the connection; resolves once the player is in the game. */
  accept(answer: Signal): Promise<Joined>
  /** Drops the invitation, unless the player has already joined. */
  cancel(): void
}

/**
 * The host runs the game: it keeps the world, steps it 30 times a second with everyone's
 * input, and sends the result to every player. Players connect to the host only, a star, so
 * each new player scans codes with the host and nobody else.
 *
 * Players who drop out keep their place (see `Seats`), and the host saves the game every few
 * seconds, so that after a reload it can carry on with the same players and scores.
 */
export class HostSession implements Session {
  readonly isHost = true
  readonly world: World = createWorld((Math.random() * 2 ** 31) | 0)
  /** Called when someone leaves, with their name. */
  onLeave: (name: string) => void = () => {}
  /** Called with every spark caught. */
  onCatch: (caught: Catch) => void = () => {}
  private readonly guests = new Map<number, Guest>()
  private readonly targets = new Map<number, Target>()
  private readonly seats: Seats
  private last = performance.now()
  private lastSave = 0
  private readonly timer: number
  private readonly onPageHide = () => this.save()

  constructor(
    private readonly name: string,
    saved?: HostedGame | null,
  ) {
    addPlayer(this.world, HOST_ID, name).score = saved?.hostScore ?? 0
    this.seats = new Seats(saved?.nextId ?? HOST_ID + 1, saved?.players)
    this.timer = window.setInterval(() => this.tick(), TICK_MS)
    window.addEventListener('pagehide', this.onPageHide)
    this.save()
  }

  selfId(): number {
    return HOST_ID
  }

  snapshot(): Snapshot {
    return { ...this.world, away: this.seats.awaySeats() }
  }

  setTarget(target: Target): void {
    this.targets.set(HOST_ID, target)
  }

  target(): Target {
    return this.targets.get(HOST_ID) ?? null
  }

  start(seconds: number): void {
    startRound(this.world, seconds)
    this.seats.resetScores()
  }

  async pair(): Promise<Pairing> {
    const { link, code } = await createOffer()
    let joined = false
    // Listening starts now, before the channel opens, so the player's hello cannot slip by.
    const hello = new Promise<Joined>((resolve, reject) => {
      listen<ToHost>(link.control, (message) => {
        if (message.type !== 'hello' || joined) return
        const token = typeof message.token === 'string' ? message.token.slice(0, 64) : ''
        const returning = [...this.guests].find(([, guest]) => guest.token === token)
        // The same browser again, while its old connection has not timed out yet: the old
        // one is dead, as a browser only ever plays from one page.
        if (message.version !== PROTOCOL) {
          send(link.control, { type: 'mismatch', version: PROTOCOL })
          setTimeout(() => link.pc.close(), 500)
          return reject(new Error('version'))
        }
        if (returning && token) this.drop(returning[0], false)
        if (this.world.players.length >= MAX_PLAYERS) {
          send(link.control, { type: 'full' })
          setTimeout(() => link.pc.close(), 500)
          return reject(new Error('full'))
        }
        joined = true
        resolve(this.admit(link, cleanName(message.name, '?'), token))
      })
    })
    return {
      code,
      accept: async (answer) => {
        await acceptAnswer(link, answer)
        await opened(link)
        return hello
      },
      cancel: () => {
        if (!joined) link.pc.close()
      },
    }
  }

  /**
   * Leaves the game. `ended`: the host ends it for everyone, who are told so, and it is not
   * offered to carry on; otherwise, as when the page closes, the game stays saved.
   */
  close(ended = true): void {
    clearInterval(this.timer)
    window.removeEventListener('pagehide', this.onPageHide)
    if (ended) {
      forgetHostedGame()
      for (const guest of this.guests.values()) send(guest.link.control, { type: 'bye' })
    } else {
      this.save()
    }
    const links = [...this.guests.values()].map((guest) => guest.link)
    this.guests.clear()
    // A moment for the goodbyes to leave before the connections close.
    setTimeout(() => {
      for (const link of links) link.pc.close()
    }, 300)
  }

  private admit(link: Link, name: string, token: string): Joined {
    // Without a token, a player cannot come back: a seat of their own that nobody claims.
    const seatToken = token || `anonymous-${Math.random()}`
    const { id, score, rejoined } = this.seats.claim(seatToken)
    const guest: Guest = { link, name, token: seatToken, lastSeen: performance.now() }
    this.guests.set(id, guest)
    addPlayer(this.world, id, name).score = score
    send(link.control, { type: 'welcome', id, host: this.name, rejoined, version: PROTOCOL })
    listen<ToHost>(link.fast, (message) => {
      guest.lastSeen = performance.now()
      if (message.type === 'ping') {
        send(link.fast, { type: 'pong', sent: message.sent })
      } else if (message.type === 'input') {
        const { x, y, ping } = message
        this.targets.set(id, typeof x === 'number' && typeof y === 'number' ? { x, y } : null)
        const player = this.world.players.find((p) => p.id === id)
        if (player) player.ping = typeof ping === 'number' ? Math.round(ping) : null
      }
    })
    onLost(link, () => this.drop(id))
    this.save()
    return { name, rejoined }
  }

  private drop(id: number, notify = true): void {
    const guest = this.guests.get(id)
    if (!guest) return
    this.guests.delete(id)
    this.targets.delete(id)
    const score = this.world.players.find((p) => p.id === id)?.score ?? 0
    this.seats.leave({ token: guest.token, id, name: guest.name, score })
    removePlayer(this.world, id)
    guest.link.pc.close()
    this.save()
    if (notify) this.onLeave(guest.name)
  }

  private save(): void {
    this.lastSave = performance.now()
    const connected = [...this.guests].map(([id, guest]) => ({
      token: guest.token,
      id,
      name: guest.name,
      score: this.world.players.find((p) => p.id === id)?.score ?? 0,
    }))
    saveHostedGame({
      hostScore: this.world.players.find((p) => p.id === HOST_ID)?.score ?? 0,
      players: [...connected, ...this.seats.awaySeats()],
      nextId: this.seats.next,
    })
  }

  private tick(): void {
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    for (const caught of step(this.world, this.targets, dt)) this.onCatch(caught)
    const message: ToGuest = { type: 'state', state: compact(this.snapshot()) }
    for (const [id, guest] of this.guests) {
      if (now - guest.lastSeen > SILENCE_MS) this.drop(id)
      else send(guest.link.fast, message)
    }
    if (now - this.lastSave > SAVE_MS) this.save()
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
    away: state.away?.map(({ id, name }) => ({ id, name })),
  }
}
