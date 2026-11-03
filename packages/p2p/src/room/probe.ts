import { type Channel, inRange, isObject, send } from '../channel.ts'

/**
 * A connection test, which the host starts for every player at once (`HostRoom.testConnections`):
 * for a few seconds, host and players send each other as much data as their connection takes,
 * on the `fast` channel beside the game, and the host pings each player ten times a second. Both
 * sides count what arrived; the host works out how it went and tells each player their part.
 */

/** How long a test runs, unless the host says otherwise. */
export const TEST_MS = 5000
/** The longest test a player takes part in. */
export const MAX_TEST_MS = 10_000
/** How often the host pings a player during a test. */
export const TEST_PING_MS = 100
/** How long the host waits after a test for the players' counts. */
export const TEST_REPORT_MS = 3000
/** The filler of one data message: half the longest message, so it never gets near it. */
export const PROBE_CHARS = 8000
/**
 * Data messages sent per tick at most, while the channel's buffer has room: about 2 MB a second
 * each way at 30 ticks a second. Transports without a buffer to read get one a tick, and drop
 * what they cannot carry.
 */
const MAX_PROBES_PER_TICK = 8
const MAX_BUFFERED = 256 * 1024

const PAD = 'x'.repeat(PROBE_CHARS)

/** How one connection did in a test. */
export interface ConnectionTest {
  /** How long it ran, in milliseconds. */
  readonly ms: number
  /** The round trips of the test's pings, in milliseconds, while data flowed both ways. */
  readonly ping: { readonly min: number; readonly median: number; readonly max: number } | null
  /** The share of the test's pings that never came back, from 0 to 1. */
  readonly pingLoss: number
  /** From the host to the player: what arrived, and the share of data lost or dropped. */
  readonly down: Throughput
  /** From the player to the host. */
  readonly up: Throughput
}

export interface Throughput {
  /** Kilobytes a second that arrived. */
  readonly kbPerSecond: number
  /**
   * The share of data messages that never arrived, from 0 to 1. A test fills the connection on
   * purpose, so some loss is expected: the fuller the connection, the more.
   */
  readonly loss: number
}

const KB_MAX = 1_000_000

function parseThroughput(value: unknown): Throughput | undefined {
  if (!isObject(value) || !inRange(value.kbPerSecond, 0, KB_MAX) || !inRange(value.loss, 0, 1))
    return undefined
  return { kbPerSecond: value.kbPerSecond, loss: value.loss }
}

/** Checks a test's result as it comes from the host. */
export function parseConnectionTest(value: unknown): ConnectionTest | undefined {
  if (!isObject(value) || !inRange(value.ms, 0, MAX_TEST_MS) || !inRange(value.pingLoss, 0, 1))
    return undefined
  let ping: ConnectionTest['ping'] = null
  if (value.ping !== null) {
    const p = value.ping
    if (!isObject(p) || !inRange(p.min, 0, 60_000) || !inRange(p.max, 0, 60_000)) return undefined
    if (!inRange(p.median, p.min, p.max)) return undefined
    ping = { min: p.min, median: p.median, max: p.max }
  }
  const down = parseThroughput(value.down)
  const up = parseThroughput(value.up)
  if (!down || !up) return undefined
  return { ms: value.ms, ping, pingLoss: value.pingLoss, down, up }
}

/** Counts of one direction of a test. */
export interface ProbeCounts {
  sent: number
  sentChars: number
  received: number
  receivedChars: number
}

export function noCounts(): ProbeCounts {
  return { sent: 0, sentChars: 0, received: 0, receivedChars: 0 }
}

/**
 * Sends a tick's worth of data messages, as many as the channel's buffer takes, and counts them;
 * `out` gets each message's length, for the connection's traffic.
 */
export function sendProbes(
  channel: Channel & { readonly bufferedAmount?: number },
  message: (pad: string) => unknown,
  counts: ProbeCounts,
  out: (chars: number) => void,
): void {
  const buffered = () => channel.bufferedAmount
  const most = typeof buffered() === 'number' ? MAX_PROBES_PER_TICK : 1
  for (let i = 0; i < most; i++) {
    if ((buffered() ?? 0) > MAX_BUFFERED) return
    const chars = send(channel, message(PAD))
    if (chars === 0) return
    out(chars)
    counts.sent++
    counts.sentChars += PAD.length
  }
}

/** A test's result, from both sides' counts and the round trips of its pings. */
export function testResult(
  ms: number,
  pings: number,
  rtts: readonly number[],
  down: ProbeCounts,
  up: ProbeCounts,
): ConnectionTest {
  const seconds = Math.max(0.001, ms / 1000)
  const sorted = [...rtts].sort((a, b) => a - b)
  const throughput = (c: ProbeCounts): Throughput => ({
    kbPerSecond: Math.min(KB_MAX, Math.round(c.receivedChars / seconds / 100) / 10),
    loss: c.sent === 0 ? 0 : round3(Math.max(0, 1 - c.received / c.sent)),
  })
  return {
    ms,
    ping:
      sorted.length === 0
        ? null
        : {
            min: Math.min(60_000, Math.round(sorted[0] ?? 0)),
            median: Math.min(60_000, Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0)),
            max: Math.min(60_000, Math.round(sorted.at(-1) ?? 0)),
          },
    pingLoss: pings === 0 ? 0 : round3(Math.max(0, 1 - rtts.length / pings)),
    down: throughput(down),
    up: throughput(up),
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}
