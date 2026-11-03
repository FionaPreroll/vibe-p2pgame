import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Conditions, linkPair } from '../testing.ts'
import { GuestRoom } from './guest.ts'
import { HostRoom, type LeaveReason, type RoomPlayer } from './host.ts'

/**
 * Rooms over a weak connection, as on a hotspot at the edge of its range: `fast` loses, delays
 * and reorders messages, `control` only delays them. Players still get in and keep their seats,
 * see the newest state, are dropped only once really silent, and count lost pings right.
 */

type State = { tick: number; digits: Record<string, number> }
const VERSION = 7
const parseInput = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 9 ? (v as number) : undefined
const parseState = (v: unknown) =>
  typeof v === 'object' && v !== null && 'tick' in v ? (v as State) : undefined
const parseEvent = (v: unknown) => (typeof v === 'string' ? v : undefined)

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const later = (ms: number) => vi.advanceTimersByTimeAsync(ms)
let tokens = 0

function host() {
  const room = new HostRoom<number, State, string>({
    name: 'Hosty',
    version: VERSION,
    parseInput,
    parseEvent,
  })
  let tick = 0
  const digits = new Map<number, number>()
  const leaves: [RoomPlayer, LeaveReason][] = []
  const events: [number, string][] = []
  room.onInput = (player, input) => digits.set(player.id, input)
  room.onLeave = (player, reason) => leaves.push([player, reason])
  room.onEvent = (player, event) => events.push([player.id, event])
  room.onTick = () => ({ tick: ++tick, digits: Object.fromEntries(digits) })
  return { room, leaves, events, tick: () => tick }
}

async function join(room: HostRoom<number, State, string>, conditions: Conditions, token?: string) {
  const pair = linkPair({ conditions })
  const attached = room.attach(pair.host.link)
  pair.open()
  const joining = GuestRoom.join<number, State, string>(pair.guest.link, {
    name: 'Guesty',
    token: token ?? `loss-token-${++tokens}`,
    version: VERSION,
    parseState,
    parseEvent,
  })
  // Hello and welcome take their time on the way.
  await later(500)
  return { pair, guest: await joining, joined: await attached.joined }
}

const weak = (loss: number, seed: number): Conditions => ({ loss, delayMs: [10, 120], seed })

describe('rooms over a weak connection', () => {
  it('let players in, carry every event once and in order, and keep the state fresh', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(0.1, 0.3, 0.5),
        fc.integer({ min: 1, max: 1_000_000 }),
        async (loss, seed) => {
          const h = host()
          const a = await join(h.room, weak(loss, seed))
          const b = await join(h.room, weak(loss, seed + 7))
          expect([a.guest.id, b.guest.id]).toEqual([1, 2])
          a.guest.setInput(4)
          b.guest.setInput(6)
          const sent = Array.from({ length: 20 }, (_, i) => `move ${i}`)
          for (const event of sent) a.guest.send(event)
          for (const event of sent) h.room.send(b.guest.id, event)
          const heard: string[] = []
          b.guest.onEvent = (event) => heard.push(event)
          await later(2000)
          expect(h.events.filter(([id]) => id === 1).map(([, e]) => e)).toEqual(sent)
          expect(heard).toEqual(sent)
          // The newest state got through, a few ticks old at most.
          for (const { guest } of [a, b]) {
            expect(guest.state()?.digits).toEqual({ 1: 4, 2: 6 })
            expect(h.tick() - (guest.state()?.tick ?? 0)).toBeLessThan(15)
          }
          expect(h.leaves).toEqual([])
          h.room.close()
        },
      ),
      { numRuns: 15 },
    )
  })

  it('keeps players whose connection loses half of everything, and drops them once silent', async () => {
    const h = host()
    const { guest, pair } = await join(h.room, weak(0.5, 11))
    guest.setInput(1)
    const lost = vi.fn()
    guest.onLost = lost
    await later(60_000)
    expect(h.leaves).toEqual([])
    expect(lost).not.toHaveBeenCalled()
    pair.guest.fast.dropping = true
    pair.guest.control.dropping = true
    await later(7000)
    expect(h.leaves).toEqual([])
    await later(2000)
    expect(h.leaves.map(([, reason]) => reason)).toEqual(['lost'])
    h.room.close()
  })

  it('gives a player back their seat when they rejoin over a weak connection', async () => {
    const h = host()
    const first = await join(h.room, weak(0.3, 5), 'loss-token-rejoin')
    first.guest.close()
    await later(500)
    const again = await join(h.room, weak(0.3, 6), 'loss-token-rejoin')
    expect(again.joined).toMatchObject({ rejoined: true, player: { id: first.guest.id } })
    h.room.close()
  })

  it('counts lost pings as about the share lost both ways', async () => {
    const h = host()
    const { guest } = await join(h.room, { loss: 0.2, seed: 21 })
    guest.setInput(2)
    await later(300_000)
    const { pings, pongs, lostPings } = guest.traffic()
    // A ping and its answer both have to get through: 1 - 0.8 × 0.8 = 36% are lost.
    expect(lostPings / (pongs + lostPings)).toBeGreaterThan(0.3)
    expect(lostPings / (pongs + lostPings)).toBeLessThan(0.42)
    // At most the last three seconds' pings are still on their way.
    expect(pings - pongs - lostPings).toBeLessThanOrEqual(3)
    const summary = guest.net.summary()[0]
    expect(summary?.loss).toBeCloseTo(lostPings / (pongs + lostPings), 2)
    h.room.close()
  })

  it('measures the round trip with the delay on the way, there and back', async () => {
    const h = host()
    const { guest } = await join(h.room, { delayMs: 40 })
    guest.setInput(2)
    await later(3000)
    expect(guest.ping()).toBe(80)
    expect(h.room.players()[0]?.ping).toBe(80)
    h.room.close()
  })

  it('samples every connection once a second on both sides, and notes stalls', async () => {
    const notes: string[] = []
    const room = new HostRoom<number, State>({
      name: 'Hosty',
      version: VERSION,
      parseInput,
      netNote: (line) => notes.push(line),
    })
    room.onTick = () => ({ tick: 1, digits: {} })
    const pair = linkPair({ conditions: { delayMs: 10 } })
    const attached = room.attach(pair.host.link)
    pair.open()
    const joining = GuestRoom.join<number, State>(pair.guest.link, {
      name: 'Guesty',
      token: 'loss-token-net',
      version: VERSION,
      parseState,
    })
    await later(500)
    const guest = await joining
    await attached.joined
    guest.setInput(1)
    await later(5000)
    expect(room.net.peerIds()).toEqual([1])
    expect(guest.net.peerIds()).toEqual([0])
    expect(guest.net.self).toBe(1)
    expect(guest.net.series(0).at(-1)).toMatchObject({ peer: 0, ping: 20 })
    expect(room.net.series(1).at(-1)?.inRate).toBeGreaterThan(29)
    pair.guest.fast.dropping = true
    await later(2000)
    expect(notes).toEqual([expect.stringMatching(/^player 1: no message for \d+ ms$/)])
    expect(await room.details(1)).toMatchObject({ transport: 'memory' })
    expect(await room.details(9)).toBeNull()
    expect(await guest.details()).toMatchObject({ transport: 'memory' })
    guest.close()
    await later(100)
    // A player who left is forgotten: samples start afresh when they come back.
    const samples = room.net.samples.length
    await later(3000)
    expect(room.net.samples.length).toBe(samples)
    room.close()
  })
})
