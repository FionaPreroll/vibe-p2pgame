import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Conditions, linkPair } from '../testing.ts'
import { GuestRoom } from './guest.ts'
import { HostRoom } from './host.ts'
import { guestParser, hostParser, ROOM_PROTOCOL } from './messages.ts'
import {
  type ConnectionTest,
  MAX_TEST_MS,
  PROBE_CHARS,
  parseConnectionTest,
  TEST_MS,
  testResult,
} from './probe.ts'

/**
 * The connection test: the host starts it, every player takes part by themselves, and both
 * sides learn how much got through each way, and how long a round trip took meanwhile.
 */

type State = { n: number }
const VERSION = 3
const parseInput = (v: unknown) => (v === 0 ? 0 : undefined)
const parseState = (v: unknown) =>
  typeof v === 'object' && v !== null && 'n' in v ? (v as State) : undefined

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
  const room = new HostRoom<number, State>({ name: 'Hosty', version: VERSION, parseInput })
  room.onTick = () => ({ n: 1 })
  return room
}

async function join(room: HostRoom<number, State>, conditions?: Conditions) {
  const pair = linkPair({ conditions })
  const attached = room.attach(pair.host.link)
  pair.open()
  const joining = GuestRoom.join<number, State>(pair.guest.link, {
    name: 'Guesty',
    token: `probe-token-${++tokens}`,
    version: VERSION,
    parseState,
  })
  await later(300)
  await attached.joined
  const guest = await joining
  guest.setInput(0)
  return { pair, guest }
}

describe('a connection test', () => {
  it('measures both ways and the round trip, and tells each player theirs', async () => {
    const room = host()
    const a = await join(room, { delayMs: 25 })
    const b = await join(room, { delayMs: 25, loss: 0.2, seed: 4 })
    const starts: number[] = []
    const results: ConnectionTest[] = []
    a.guest.onTestStart = (ms) => starts.push(ms)
    a.guest.onTestResult = (result) => results.push(result)
    const running = room.testConnections()
    expect(room.testing()).toBe(true)
    await later(TEST_MS + 1000)
    const run = await running
    expect(room.testing()).toBe(false)
    expect(run.ms).toBe(TEST_MS)
    expect(run.players.map((p) => p.player.id)).toEqual([1, 2])
    const [first, second] = run.players.map((p) => p.result)
    // In memory, without a buffer to read, one data message a tick goes each way: 8 kB 30
    // times a second.
    const perTick = (PROBE_CHARS * 30) / 1000
    expect(first?.down.kbPerSecond).toBeGreaterThan(perTick * 0.9)
    expect(first?.down.kbPerSecond).toBeLessThan(perTick * 1.1)
    expect(first?.up.kbPerSecond).toBeGreaterThan(perTick * 0.9)
    expect(first).toMatchObject({ pingLoss: 0, down: { loss: 0 }, up: { loss: 0 } })
    expect(first?.ping).toEqual({ min: 50, median: 50, max: 50 })
    // A fifth lost each way: the data loses a fifth, the pings about a third.
    expect(second?.down.loss).toBeGreaterThan(0.12)
    expect(second?.down.loss).toBeLessThan(0.28)
    expect(second?.pingLoss).toBeGreaterThan(0.2)
    expect(second?.pingLoss).toBeLessThan(0.5)
    await later(500)
    expect(starts).toEqual([TEST_MS])
    expect(results).toEqual([first])
    expect(a.guest.lastTest()).toEqual(first)
    expect(b.guest.lastTest()).toEqual(second)
    expect(room.lastTest()).toEqual(run)
    expect(a.guest.testing()).toBe(false)
    room.close()
  })

  it('runs one test at a time, keeps it short, and ends without players at once', async () => {
    const room = host()
    expect((await room.testConnections()).players).toEqual([])
    const a = await join(room)
    const one = room.testConnections(60_000)
    const two = room.testConnections()
    await later(MAX_TEST_MS + 1000)
    expect(await one).toBe(await two)
    expect((await one).ms).toBe(MAX_TEST_MS)
    expect(a.guest.lastTest()?.ms).toBe(MAX_TEST_MS)
    room.close()
  })

  it('has no result for a player who leaves during the test, or never answers', async () => {
    const room = host()
    const a = await join(room)
    const b = await join(room)
    const running = room.testConnections(2000)
    await later(1000)
    a.guest.close()
    b.pair.guest.control.dropping = true
    await later(6000)
    const run = await running
    expect(run.players.map((p) => p.result)).toEqual([null, null])
    room.close()
  })

  it('is cut short when the host closes the room', async () => {
    const room = host()
    await join(room)
    const running = room.testConnections()
    await later(1000)
    room.close()
    expect((await running).players.map((p) => p.result)).toEqual([null])
  })

  it('keeps the game going meanwhile', async () => {
    const room = host()
    const a = await join(room)
    let inputs = 0
    room.onInput = () => inputs++
    void room.testConnections()
    await later(TEST_MS)
    expect(inputs).toBeGreaterThan(140)
    expect(a.guest.state()).toEqual({ n: 1 })
    room.close()
  })
})

describe('the test’s messages', () => {
  const toHost = hostParser(parseInput)
  const toGuest = guestParser(parseState)

  it('are checked field by field on both sides', () => {
    expect(toHost({ type: 'probe', test: 1, pad: 'xx' })).toEqual({
      type: 'probe',
      test: 1,
      pad: 'xx',
    })
    expect(toHost({ type: 'probe', test: -1, pad: '' })).toBeUndefined()
    expect(toHost({ type: 'probe', test: 1, pad: 'x'.repeat(20_000) })).toBeUndefined()
    expect(toHost({ type: 'echo', test: 1, seq: 2.5 })).toBeUndefined()
    expect(
      toHost({ type: 'tested', test: 1, sent: 1, sentChars: 2, received: 3, receivedChars: -4 }),
    ).toBeUndefined()
    expect(toGuest({ type: 'test', test: 1, ms: MAX_TEST_MS + 1 })).toBeUndefined()
    expect(toGuest({ type: 'probe', test: 1, seq: 'a', pad: '' })).toBeUndefined()
    expect(toGuest({ type: 'probe', test: 1, seq: null, pad: '' })).toEqual({
      type: 'probe',
      test: 1,
      seq: null,
      pad: '',
    })
    expect(toGuest({ type: 'tested', test: 1, result: { ms: 5 } })).toBeUndefined()
  })

  it('carry only results that make sense', () => {
    const result = testResult(
      5000,
      50,
      [30, 10, 20],
      { sent: 10, sentChars: 80_000, received: 8, receivedChars: 64_000 },
      { sent: 0, sentChars: 0, received: 0, receivedChars: 0 },
    )
    expect(result).toEqual({
      ms: 5000,
      ping: { min: 10, median: 20, max: 30 },
      pingLoss: 0.94,
      down: { kbPerSecond: 12.8, loss: 0.2 },
      up: { kbPerSecond: 0, loss: 0 },
    })
    expect(parseConnectionTest(JSON.parse(JSON.stringify(result)))).toEqual(result)
    expect(parseConnectionTest({ ...result, ping: null })).toEqual({ ...result, ping: null })
    expect(parseConnectionTest({ ...result, pingLoss: 2 })).toBeUndefined()
    expect(parseConnectionTest({ ...result, ping: { min: 5, median: 50, max: 9 } })).toBeUndefined()
    expect(parseConnectionTest({ ...result, up: { kbPerSecond: -1, loss: 0 } })).toBeUndefined()
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const parsed = parseConnectionTest(value)
        if (parsed) expect(parseConnectionTest(parsed)).toEqual(parsed)
      }),
    )
  })

  it('belong to room protocol 3: phones of the rooms before cannot join', () => {
    expect(ROOM_PROTOCOL).toBe(3)
  })
})
