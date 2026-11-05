import { describe, expect, it } from 'vitest'
import {
  NetLog,
  type NetReading,
  networkLines,
  REPORT_SAMPLES,
  STALL_MS,
  samplesCsv,
} from './netlog.ts'

const reading = (
  ping: number | null,
  sent: number,
  received: number,
  pongs?: number,
  lostPings?: number,
): NetReading => ({
  ping,
  traffic: {
    sent,
    sentChars: sent * 50,
    received,
    receivedChars: received * 400,
    ...(pongs === undefined ? {} : { pongs, lostPings }),
  },
})

describe('NetLog', () => {
  it('turns readings into rates per second, from the second reading on', () => {
    const log = new NetLog(2, 0)
    expect(log.sample(0, 1000, reading(null, 0, 0, 0, 0))).toBeNull()
    const sample = log.sample(0, 2000, reading(12.4, 30, 29, 1, 0))
    expect(sample).toEqual({
      t: 2,
      peer: 0,
      ping: 12,
      inRate: 29,
      outRate: 30,
      kbIn: 11.6,
      kbOut: 1.5,
      loss: 0,
      gap: 0,
      stalled: false,
    })
  })

  it('measures the longest wait between messages, also one still going on', () => {
    const log = new NetLog(0, 0)
    log.sample(1, 0, reading(null, 0, 0))
    log.arrived(1, 100)
    log.arrived(1, 130)
    log.arrived(1, 730)
    expect(log.sample(1, 1000, reading(5, 30, 3))?.gap).toBe(600)
    // Nothing since 730: the wait goes on at the next sample.
    expect(log.sample(1, 2000, reading(5, 60, 3))?.gap).toBe(1270)
  })

  it('counts pings lost, of those settled, and none where nobody pings', () => {
    const log = new NetLog(1, 0)
    log.sample(0, 0, reading(null, 0, 0, 0, 0))
    expect(log.sample(0, 1000, reading(10, 30, 30, 3, 1))?.loss).toBe(0.25)
    expect(log.sample(0, 2000, reading(10, 60, 60, 3, 1))?.loss).toBeNull()
    const host = new NetLog(0, 0)
    host.sample(1, 0, reading(null, 0, 0))
    expect(host.sample(1, 1000, reading(10, 30, 30))?.loss).toBeNull()
  })

  it('sums up every connection', () => {
    const log = new NetLog(0, 0)
    for (const peer of [1, 2]) log.sample(peer, 0, reading(null, 0, 0))
    for (let second = 1; second <= 20; second++) {
      log.sample(1, second * 1000, reading(second, second * 30, second * 30))
      if (second <= 5) log.sample(2, second * 1000, reading(50, second * 15, second * 15))
    }
    log.arrived(2, 5000)
    log.sample(2, 6000, reading(50, 75, 75))
    const [one, two] = log.summary()
    expect(one).toMatchObject({
      peer: 1,
      seconds: 20,
      ping: { min: 1, median: 11, p95: 20, max: 20 },
      inRate: 30,
      loss: null,
      stalls: 0,
      kbIn: 240,
      kbOut: 30,
    })
    expect(two).toMatchObject({ peer: 2, seconds: 6, stalls: 1, longestGap: 1000 })
    expect(STALL_MS).toBeLessThan(1000)
  })

  it('starts a connection afresh after it ended', () => {
    const log = new NetLog(0, 0)
    log.sample(1, 0, reading(null, 0, 0))
    log.sample(1, 1000, reading(5, 30, 30))
    log.forget(1)
    // A new connection counts from 0 again: no negative rates, no sample at first.
    expect(log.sample(1, 5000, reading(5, 2, 2))).toBeNull()
    expect(log.sample(1, 6000, reading(5, 32, 32))?.inRate).toBe(30)
  })

  it('keeps the newest samples only', () => {
    const log = new NetLog(0, 0)
    log.sample(1, 0, reading(null, 0, 0))
    for (let second = 1; second <= 4000; second++) log.sample(1, second * 1000, reading(5, 0, 0))
    expect(log.samples).toHaveLength(3600)
    expect(log.samples[0]?.t).toBe(401)
  })

  it('gives the debug report its lines, with ids, never names', () => {
    const log = new NetLog(3, 0, new Date('2026-11-01T10:00:00Z'))
    log.sample(0, 0, reading(null, 0, 0, 0, 0))
    log.sample(0, 1000, reading(20, 30, 30, 1, 0))
    const report = networkLines(log).join('\n')
    expect(report).toContain('- Phone: player 3, game started 2026-11-01T10:00:00.000Z')
    expect(report).toContain('median 20 ms')
    expect(report).toContain('Pings lost: 0%')
    expect(report).toContain('```csv')
    expect(samplesCsv(log).split('\n')).toEqual([
      't_s,peer,ping_ms,in_per_s,out_per_s,kb_in_per_s,kb_out_per_s,loss_pct,gap_ms',
      '1,0,20,30,30,12,1.5,0,0',
    ])
    expect(networkLines(new NetLog(0, 0)).join('\n')).toContain('No samples')
  })

  it('keeps the newest samples only in the report', () => {
    const log = new NetLog(0, 0)
    log.sample(1, 0, reading(null, 0, 0))
    for (let second = 1; second <= REPORT_SAMPLES + 50; second++)
      log.sample(1, second * 1000, reading(5, 0, 0))
    const lines = networkLines(log)
    expect(lines.join('\n')).toContain(`the last ${REPORT_SAMPLES}`)
    const rows = lines
      .join('\n')
      .split('\n')
      .filter((line) => /^\d/.test(line))
    expect(rows).toHaveLength(REPORT_SAMPLES)
  })

  it('takes no stall for the second between pings of a player who sends no input', () => {
    // Between games, a player sends only a ping a second: the host waits about a second for
    // each, which is usual there. In a game, input comes 30 times a second: the same wait is a
    // stall. A player gone quiet for good stalls either way.
    const notes: string[] = []
    const log = new NetLog(0, 0, new Date(), (line) => notes.push(line))
    log.sample(1, 0, reading(null, 0, 0))
    for (let second = 1; second <= 5; second++) {
      log.arrived(1, second * 1000 - 950)
      log.sample(1, second * 1000, reading(50, second, second))
    }
    expect(log.series(1).map((s) => [s.gap, s.stalled])).toEqual([
      [950, false],
      [1000, false],
      [1000, false],
      [1000, false],
      [1000, false],
    ])
    // The game starts: 30 messages a second, then a wait of 700 ms.
    for (let at = 5000; at < 6000; at += 33) log.arrived(1, at)
    log.sample(1, 6000, reading(50, 35, 35))
    for (let at = 6000; at < 6300; at += 33) log.arrived(1, at)
    log.sample(1, 7000, reading(50, 45, 45))
    // Nothing at all for three seconds.
    log.sample(1, 10_000, reading(50, 45, 45))
    expect(
      log
        .series(1)
        .slice(5)
        .map((s) => s.stalled),
    ).toEqual([false, true, true])
    expect(log.summary()[0]?.stalls).toBe(2)
    expect(notes).toEqual(['player 1: no message for 703 ms'])
  })

  it('takes no stall when a player who sends no input joins between two samples', () => {
    // A sample falls between attaching the connection and the player's hello: a second with no
    // message tells nothing yet, and the player's pings come a second apart from then on.
    const notes: string[] = []
    const log = new NetLog(0, 0, new Date(), (line) => notes.push(line))
    log.sample(1, 0, reading(null, 0, 0))
    log.sample(1, 1000, reading(null, 0, 0))
    log.arrived(1, 1100)
    log.sample(1, 2000, reading(null, 1, 1))
    for (let second = 3; second <= 6; second++) {
      log.arrived(1, second * 1000 - 900)
      log.sample(1, second * 1000, reading(50, second - 1, second - 1))
    }
    expect(log.series(1).map((s) => s.stalled)).toEqual([false, false, false, false, false, false])
    expect(notes).toEqual([])
    // Gone quiet once it had spoken: a stall, as ever.
    log.sample(1, 9000, reading(50, 5, 5))
    expect(log.series(1).at(-1)?.stalled).toBe(true)
  })

  it('notes for the log when a connection stalls and when it recovers, once each', () => {
    const notes: string[] = []
    const log = new NetLog(0, 0, new Date(), (line) => notes.push(line))
    log.sample(2, 0, reading(null, 0, 0))
    log.arrived(2, 100)
    log.sample(2, 1000, reading(5, 30, 30))
    log.sample(2, 2000, reading(5, 30, 30))
    // Messages again from 3.1 s on: the second they came back in still had the long wait.
    for (const at of [3100, 3400, 3700]) log.arrived(2, at)
    log.sample(2, 4000, reading(5, 60, 60))
    for (const at of [4000, 4300, 4600, 4900]) log.arrived(2, at)
    log.sample(2, 5000, reading(5, 90, 90))
    expect(notes).toEqual(['player 2: no message for 900 ms', 'player 2: messages again'])
  })
})
