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
import { listen, send, type ToGuest, type ToHost } from '../net/protocol'
import type { Signal } from '../net/signal'
import { cleanName, type Session, SILENCE_MS, TICK_MS } from './session'

const HOST_ID = 0

interface Guest {
  readonly link: Link
  readonly name: string
  lastSeen: number
}

/** One pending invitation: the code to show, and what to do with the answer. */
export interface Pairing {
  readonly code: string
  /** Completes the connection; resolves with the new player's name once they are in the game. */
  accept(answer: Signal): Promise<string>
  /** Drops the invitation, unless the player has already joined. */
  cancel(): void
}

/**
 * The host runs the game: it keeps the world, steps it 30 times a second with everyone's
 * input, and sends the result to every player. Players connect to the host only, a star, so
 * each new player scans codes with the host and nobody else.
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
  private nextId = HOST_ID + 1
  private last = performance.now()
  private readonly timer: number

  constructor(name: string) {
    addPlayer(this.world, HOST_ID, name)
    this.timer = window.setInterval(() => this.tick(), TICK_MS)
  }

  selfId(): number {
    return HOST_ID
  }

  snapshot(): Snapshot {
    return this.world
  }

  setTarget(target: Target): void {
    this.targets.set(HOST_ID, target)
  }

  target(): Target {
    return this.targets.get(HOST_ID) ?? null
  }

  playerCount(): number {
    return this.world.players.length
  }

  start(): void {
    startRound(this.world)
  }

  async pair(): Promise<Pairing> {
    const { link, code } = await createOffer()
    let joined = false
    // Listening starts now, before the channel opens, so the player's hello cannot slip by.
    const hello = new Promise<string>((resolve, reject) => {
      listen<ToHost>(link.control, (message) => {
        if (message.type !== 'hello' || joined) return
        if (this.world.players.length >= MAX_PLAYERS) {
          send(link.control, { type: 'full' })
          setTimeout(() => link.pc.close(), 500)
          return reject(new Error('full'))
        }
        joined = true
        resolve(this.admit(link, cleanName(message.name, '?')))
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

  close(): void {
    clearInterval(this.timer)
    for (const guest of this.guests.values()) guest.link.pc.close()
    this.guests.clear()
  }

  private admit(link: Link, name: string): string {
    const id = this.nextId++
    const guest: Guest = { link, name, lastSeen: performance.now() }
    this.guests.set(id, guest)
    addPlayer(this.world, id, name)
    send(link.control, { type: 'welcome', id })
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
    return name
  }

  private drop(id: number): void {
    const guest = this.guests.get(id)
    if (!guest) return
    this.guests.delete(id)
    this.targets.delete(id)
    removePlayer(this.world, id)
    guest.link.pc.close()
    this.onLeave(guest.name)
  }

  private tick(): void {
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    for (const caught of step(this.world, this.targets, dt)) this.onCatch(caught)
    const message: ToGuest = { type: 'state', state: compact(this.world) }
    for (const [id, guest] of this.guests) {
      if (now - guest.lastSeen > SILENCE_MS) this.drop(id)
      else send(guest.link.fast, message)
    }
  }
}

/** The world as players need it, with positions rounded: a third of the bytes. */
function compact(world: World): Snapshot {
  return {
    phase: world.phase,
    timeLeft: Math.round(world.timeLeft * 10) / 10,
    players: world.players.map((p) => ({ ...p, x: Math.round(p.x), y: Math.round(p.y) })),
    sparks: world.sparks.map((s) => ({ ...s, x: Math.round(s.x), y: Math.round(s.y) })),
  }
}
