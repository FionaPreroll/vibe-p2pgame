import type { Traffic } from '@fionapreroll/p2p/room'

/**
 * How well the connections of a game keep up, sampled once a second: the round trip, the
 * messages and data per second each way, pings lost, and the longest wait for a message. A
 * player's phone has one connection, to the host; the host has one to every player.
 *
 * Players see it as a small graph while they play, and after a game as a report to copy and
 * send (see `netReport`). Players appear by their ids only, never by name.
 */

/**
 * What a connection's room says at a moment; pings answered and lost only on a player's phone
 * (see `GuestRoom.traffic`).
 */
export interface NetReading {
  readonly ping: number | null
  readonly traffic: Traffic & { readonly pongs?: number; readonly lostPings?: number }
}

export interface NetSample {
  /** Seconds since the log began. */
  readonly t: number
  /** The other phone's player id: on a player's phone always the host, 0. */
  readonly peer: number
  /** The round trip in milliseconds, as last measured. */
  readonly ping: number | null
  /** Messages per second. */
  readonly inRate: number
  readonly outRate: number
  /** Kilobytes per second. */
  readonly kbIn: number
  readonly kbOut: number
  /**
   * The share of pings lost, from 0 to 1, of those answered or lost in this second; null where
   * none were, or nobody pings.
   */
  readonly loss: number | null
  /** The longest time without a message from the other phone, in milliseconds. */
  readonly gap: number
}

export interface PeerSummary {
  readonly peer: number
  readonly seconds: number
  readonly ping: {
    readonly min: number
    readonly median: number
    readonly p95: number
    readonly max: number
  } | null
  readonly inRate: number
  readonly outRate: number
  readonly loss: number | null
  /** Seconds in which no message came for half a second or longer. */
  readonly stalls: number
  readonly longestGap: number
  readonly kbIn: number
  readonly kbOut: number
}

/** How often the sessions take a sample of every connection. */
export const SAMPLE_MS = 1000
/** A wait this long for a message counts as a stall: players see the game stutter. */
export const STALL_MS = 500
/** Samples kept, the oldest go first: an hour with one player, ten minutes with six. */
const MAX_SAMPLES = 3600

interface Peer {
  last: { at: number; reading: NetReading } | null
  lastArrival: number | null
  longestGap: number
  pongs: number
  lost: number
}

export class NetLog {
  readonly samples: NetSample[] = []
  private readonly peers = new Map<number, Peer>()

  constructor(
    /** Whose log this is: the host's, or the player's with this id. */
    readonly self: number,
    /** When it began, as `performance.now()` and as a date. */
    readonly startedAt: number,
    readonly startedOn: Date = new Date(),
  ) {}

  /** A message from another phone arrived. */
  arrived(peer: number, now: number): void {
    const p = this.peer(peer)
    if (p.lastArrival !== null) p.longestGap = Math.max(p.longestGap, now - p.lastArrival)
    p.lastArrival = now
  }

  /**
   * Adds a sample for a connection, from what its room says now and said at the last sample.
   * The first reading of a connection only sets the start.
   */
  sample(peer: number, now: number, reading: NetReading): NetSample | null {
    const p = this.peer(peer)
    const last = p.last
    p.last = { at: now, reading }
    const gap = Math.max(p.longestGap, p.lastArrival === null ? 0 : now - p.lastArrival)
    p.longestGap = 0
    if (last === null || now <= last.at) return null
    const seconds = (now - last.at) / 1000
    const before = last.reading.traffic
    const after = reading.traffic
    const rate = (a: number, b: number) => Math.max(0, a - b) / seconds
    const pongs = Math.max(0, (after.pongs ?? 0) - (before.pongs ?? 0))
    const lost = Math.max(0, (after.lostPings ?? 0) - (before.lostPings ?? 0))
    p.pongs += pongs
    p.lost += lost
    const sample: NetSample = {
      t: round((now - this.startedAt) / 1000, 1),
      peer,
      ping: reading.ping === null ? null : Math.round(reading.ping),
      inRate: round(rate(after.received, before.received), 1),
      outRate: round(rate(after.sent, before.sent), 1),
      kbIn: round(rate(after.receivedChars, before.receivedChars) / 1000, 2),
      kbOut: round(rate(after.sentChars, before.sentChars) / 1000, 2),
      loss: pongs + lost === 0 ? null : lost / (pongs + lost),
      gap: Math.round(gap),
    }
    this.samples.push(sample)
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES)
    return sample
  }

  /** A connection ended: if the player comes back, their samples start afresh. */
  forget(peer: number): void {
    const p = this.peers.get(peer)
    if (p) {
      p.last = null
      p.lastArrival = null
      p.longestGap = 0
    }
  }

  /** The samples of one connection, oldest first. */
  series(peer: number): NetSample[] {
    return this.samples.filter((s) => s.peer === peer)
  }

  /** The seconds of a connection with a stall, from second `t` of the log on. */
  stallsSince(peer: number, t: number): number {
    return this.samples.filter((s) => s.peer === peer && s.t >= t && s.gap >= STALL_MS).length
  }

  /** Every connection with samples, by id. */
  peerIds(): number[] {
    return [...new Set(this.samples.map((s) => s.peer))].sort((a, b) => a - b)
  }

  summary(): PeerSummary[] {
    return this.peerIds().map((peer) => {
      const series = this.series(peer)
      const pings = series
        .map((s) => s.ping)
        .filter((ping) => ping !== null)
        .sort((a, b) => a - b)
      const p = this.peers.get(peer)
      const sum = (pick: (s: NetSample) => number) =>
        series.reduce((total, s) => total + pick(s), 0)
      return {
        peer,
        seconds: series.length,
        ping:
          pings.length === 0
            ? null
            : {
                min: pings[0] ?? 0,
                median: quantile(pings, 0.5),
                p95: quantile(pings, 0.95),
                max: pings[pings.length - 1] ?? 0,
              },
        inRate: round(sum((s) => s.inRate) / series.length, 1),
        outRate: round(sum((s) => s.outRate) / series.length, 1),
        loss: p && p.pongs + p.lost > 0 ? p.lost / (p.pongs + p.lost) : null,
        stalls: series.filter((s) => s.gap >= STALL_MS).length,
        longestGap: Math.max(0, ...series.map((s) => s.gap)),
        kbIn: round(
          sum((s) => s.kbIn),
          1,
        ),
        kbOut: round(
          sum((s) => s.kbOut),
          1,
        ),
      }
    })
  }

  private peer(id: number): Peer {
    let peer = this.peers.get(id)
    if (!peer) {
      peer = { last: null, lastArrival: null, longestGap: 0, pongs: 0, lost: 0 }
      this.peers.set(id, peer)
    }
    return peer
  }
}

let latest: NetLog | null = null

/** Begins the log of a new game; the one before is dropped. */
export function startNetLog(self: number, now: number): NetLog {
  latest = new NetLog(self, now)
  return latest
}

/** The log of the game played last, or now, on this phone; null before the first. */
export function latestNetLog(): NetLog | null {
  return latest
}

/** Whom a connection leads to, for the report. */
export function peerLabel(peer: number): string {
  return peer === 0 ? 'host' : `player ${peer}`
}

/** A connection's summary as lines of Markdown. */
export function summaryLines(log: NetLog, s: PeerSummary): string[] {
  const host = log.self === 0
  return [
    `- ${host ? `To ${peerLabel(s.peer)}` : 'To the host'}, ${s.seconds} s`,
    `  - Ping: ${
      s.ping
        ? `median ${s.ping.median} ms, 95% under ${s.ping.p95} ms, from ${s.ping.min} to ${s.ping.max} ms`
        : 'not measured'
    }`,
    `  - ${host ? 'Inputs received' : 'States received'}: ${s.inRate} per second, sent: ${s.outRate} per second`,
    `  - Pings lost: ${s.loss === null ? 'not measured' : `${round(s.loss * 100, 1)}%`}`,
    `  - Stalls of ${STALL_MS} ms or more: ${s.stalls}, longest wait ${s.longestGap} ms`,
    `  - Data: ${s.kbIn} kB received, ${s.kbOut} kB sent`,
  ]
}

/** The samples as CSV, oldest first. */
export function samplesCsv(log: NetLog): string {
  const rows = log.samples.map((s) =>
    [
      s.t,
      s.peer,
      s.ping ?? '',
      s.inRate,
      s.outRate,
      s.kbIn,
      s.kbOut,
      s.loss === null ? '' : round(s.loss * 100, 1),
      s.gap,
    ].join(','),
  )
  return [
    't_s,peer,ping_ms,in_per_s,out_per_s,kb_in_per_s,kb_out_per_s,loss_pct,gap_ms',
    ...rows,
  ].join('\n')
}

/**
 * The network report players copy after a game, in English for the developer: how long, a
 * summary for every connection, and every sample as CSV.
 */
export function netReport(log: NetLog, build: string): string {
  const lines = [
    '## Spark Hunt network report',
    '',
    `- Phone: ${log.self === 0 ? 'host' : peerLabel(log.self)}`,
    `- Started: ${log.startedOn.toISOString()}`,
    `- Web build: ${build}`,
    '',
    ...(log.peerIds().length === 0
      ? ['No samples yet.']
      : log.summary().flatMap((s) => summaryLines(log, s))),
    '',
    '### Samples, one a second',
    '',
    '```csv',
    samplesCsv(log),
    '```',
    '',
  ]
  return lines.join('\n')
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
