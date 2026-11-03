import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { linkPair } from '../testing.ts'
import { GuestRoom } from './guest.ts'
import { HostRoom, MAX_EVENTS_PER_SECOND, type RoomPlayer } from './host.ts'

/**
 * Events and states of their own for each player, with a tiny card game in memory: players
 * play a card as an event, the host answers with events, and each player sees only their own
 * hand in the state.
 */

type Input = null
type Event = { play: number } | { say: string }
type State = { table: number[]; hand: number[] }
const VERSION = 3
const parseInput = (v: unknown): Input | undefined => (v === null ? null : undefined)
const parseEvent = (v: unknown): Event | undefined => {
  if (typeof v !== 'object' || v === null) return undefined
  if ('play' in v && Number.isInteger(v.play)) return { play: v.play as number }
  if ('say' in v && typeof v.say === 'string' && v.say.length <= 40) return { say: v.say }
  return undefined
}
const parseState = (v: unknown): State | undefined =>
  typeof v === 'object' && v !== null && 'table' in v && 'hand' in v ? (v as State) : undefined

let tokens = 0
const token = () => `token-ev-${String(++tokens).padStart(4, '0')}`

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const later = (ms: number) => vi.advanceTimersByTimeAsync(ms)

function host(options: { events?: boolean } = {}) {
  const room = new HostRoom<Input, State, Event>({
    name: 'Hosty',
    version: VERSION,
    parseInput,
    ...(options.events === false ? {} : { parseEvent }),
  })
  const events: [number, Event][] = []
  const table: number[] = []
  const hands = new Map<number, number[]>()
  room.onEvent = (player, event) => {
    events.push([player.id, event])
    if ('play' in event) table.push(event.play)
  }
  room.onTick = () => ({ table: [...table], hand: [] })
  return { room, events, table, hands }
}

async function join(
  room: HostRoom<Input, State, Event>,
  options: { events?: boolean; listen?: boolean } = {},
) {
  const pair = linkPair()
  const attached = room.attach(pair.host.link)
  pair.open()
  const guest = await GuestRoom.join<Input, State, Event>(pair.guest.link, {
    name: 'Bo',
    token: token(),
    version: VERSION,
    parseState,
    ...(options.events === false ? {} : { parseEvent }),
  })
  const heard: Event[] = []
  if (options.listen !== false) guest.onEvent = (event) => heard.push(event)
  const { player } = await attached.joined
  return { pair, guest, heard, player }
}

describe('events', () => {
  it('carry a player’s moves to the host once each, in order, and drop what does not fit', async () => {
    const h = host()
    const { guest, pair, player } = await join(h.room)
    expect(guest.send({ play: 4 })).toBe(true)
    guest.send({ play: 7 })
    // Not an event of this game: dropped on the host's side.
    pair.guest.control.send(JSON.stringify({ type: 'event', data: { play: 'seven' } }))
    guest.send({ say: 'hi' })
    await later(0)
    expect(h.events).toEqual([
      [player.id, { play: 4 }],
      [player.id, { play: 7 }],
      [player.id, { say: 'hi' }],
    ])
    // Over the reliable channel: never the fast one.
    expect(pair.guest.fast.sent.some((m) => m.includes('"event"'))).toBe(false)
    h.room.close()
  })

  it('carry the host’s events to one player or to all', async () => {
    const h = host()
    const a = await join(h.room)
    const b = await join(h.room)
    expect(h.room.send(a.player.id, { say: 'your turn' })).toBe(true)
    h.room.broadcast({ say: 'round 2' })
    await later(0)
    expect(a.heard).toEqual([{ say: 'your turn' }, { say: 'round 2' }])
    expect(b.heard).toEqual([{ say: 'round 2' }])
    h.room.close()
  })

  it('keep what the host sent on joining for the player’s first listener', async () => {
    const h = host()
    h.room.onJoin = (player) => h.room.send(player.id, { say: 'welcome' })
    const { guest } = await join(h.room, { listen: false })
    await later(0)
    const heard: Event[] = []
    guest.onEvent = (event) => heard.push(event)
    expect(heard).toEqual([{ say: 'welcome' }])
    h.room.close()
  })

  it('cannot go to a player who is not there, nor after the room closed', async () => {
    const h = host()
    const { guest, pair, player } = await join(h.room)
    expect(h.room.send(99, { say: 'nobody' })).toBe(false)
    pair.host.connection.close()
    pair.guest.connection.close()
    await later(0)
    expect(h.room.send(player.id, { say: 'gone' })).toBe(false)
    expect(guest.send({ play: 1 })).toBe(false)
    h.room.close()
    expect(h.room.send(player.id, { say: 'closed' })).toBe(false)
  })

  it('are limited to a few a second from each player', async () => {
    const h = host()
    const { guest } = await join(h.room)
    for (let i = 0; i < MAX_EVENTS_PER_SECOND + 10; i++) guest.send({ play: i })
    await later(0)
    expect(h.events).toHaveLength(MAX_EVENTS_PER_SECOND)
    // The next second, the player is heard again.
    await later(1000)
    guest.send({ play: 99 })
    await later(0)
    expect(h.events.at(-1)?.[1]).toEqual({ play: 99 })
    h.room.close()
  })

  it('count only once a player is in, and are dropped by a game that takes none', async () => {
    const h = host()
    // Before any hello: nothing reaches the game.
    const pair = linkPair()
    h.room.attach(pair.host.link).joined.catch(() => {})
    pair.open()
    pair.guest.control.send(JSON.stringify({ type: 'event', data: { play: 1 } }))
    await later(0)
    expect(h.events).toEqual([])

    const quiet = host({ events: false })
    const { guest } = await join(quiet.room, { events: false })
    guest.send({ play: 2 } as never)
    await later(0)
    expect(quiet.events).toEqual([])
    h.room.close()
    quiet.room.close()
  })
})

describe('a state for each player', () => {
  it('gives each player their own part, and the rest to all', async () => {
    const h = host()
    const hands: Record<number, number[]> = { 1: [3, 5], 2: [8] }
    const asked: RoomPlayer[] = []
    h.room.stateFor = (player, state) => {
      asked.push(player)
      return { ...state, hand: hands[player.id] ?? [] }
    }
    const a = await join(h.room)
    const b = await join(h.room)
    a.guest.send({ play: 5 })
    await later(200)
    expect(a.guest.state()).toEqual({ table: [5], hand: [3, 5] })
    expect(b.guest.state()).toEqual({ table: [5], hand: [8] })
    // Nobody's message holds another player's hand.
    expect(b.pair.host.fast.sent.some((m) => m.includes('[3,5]'))).toBe(false)
    expect(asked.map((p) => p.name)).toContain('Bo')
    h.room.close()
  })

  it('is the same for everyone without stateFor', async () => {
    const h = host()
    const a = await join(h.room)
    const b = await join(h.room)
    await later(200)
    expect(a.guest.state()).toEqual(b.guest.state())
    h.room.close()
  })
})
