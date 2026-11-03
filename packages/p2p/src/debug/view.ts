import {
  type AddressKind,
  addressKind,
  type ConnectionDetails,
  type Endpoint,
  maskAddress,
} from '../details.ts'
import type { ConnectionTestRun } from '../room/host.ts'
import type { ConnectionTest } from '../room/probe.ts'
import { drawNetGraph } from './graph.ts'
import { type NetLog, STALL_MS } from './netlog.ts'

/** The lines of the connection view, by what they show. */
export type ConnectionRow =
  | 'ping'
  | 'pingLoss'
  | 'stalls'
  | 'messages'
  | 'data'
  | 'transport'
  | 'local'
  | 'remote'
  | 'offered'
  | 'rtt'
  | 'available'
  | 'packets'
  | 'bytes'
  | 'security'
  | 'channels'
  | 'testPing'
  | 'testDown'
  | 'testUp'

/** The texts of the connection view, in the game's language. */
export interface ConnectionViewTexts {
  /** The name of each line. */
  readonly rows: Readonly<Record<ConnectionRow, string>>
  /** What carries a connection, by `ConnectionDetails.transport`; others show as they are. */
  readonly transports: Readonly<Record<string, string>>
  /** What an address is, shown beside it, masked or not. */
  readonly kinds: Readonly<Record<AddressKind, string>>
  /** For a value not measured, or not known. */
  readonly none: string
  /** After a share of pings or data that did not arrive, such as "lost". */
  readonly lost: string
  /** The summary of a connection's transport details, folded away until opened. */
  readonly more: string
  /** The button that shows the addresses, and the one that masks them again. */
  readonly reveal: string
  readonly hide: string
  /** The host's button that tests every connection, and its text while a test runs. */
  readonly test: string
  readonly testing: string
  /** Above the results of the last test. */
  readonly lastTest: string
  /** For a player who did not answer a test. */
  readonly noAnswer: string
  /** The time axis' end of the graph, such as "now". */
  readonly now: string
}

/** One connection the view shows: to whom, and how to read what its transport tells. */
export interface ShownConnection {
  /** The other phone's player id, as in the `NetLog`. */
  readonly peer: number
  /** How the game names the other phone, such as the player's name. */
  readonly name: string
  readonly details: () => Promise<ConnectionDetails | null>
}

export interface ConnectionViewOptions {
  readonly texts: ConnectionViewTexts
  /** The room's samples (`HostRoom.net`, `GuestRoom.net`). */
  readonly net: NetLog
  /** The connections to show now; asked again every second. */
  readonly connections: () => readonly ShownConnection[]
  /** The line of each connection in the graph, by player id. */
  readonly color?: (peer: number) => string
  /** On the host's phone: runs a connection test (`HostRoom.testConnections`). */
  readonly test?: () => Promise<ConnectionTestRun>
  /**
   * The last test: on the host's phone the run (`HostRoom.lastTest`), on a player's their own
   * result (`GuestRoom.lastTest`).
   */
  readonly lastTest?: () => ConnectionTestRun | ConnectionTest | null
}

export interface ConnectionView {
  readonly element: HTMLElement
  /** Reads everything anew; the view does so by itself every second. */
  refresh(): Promise<void>
  /** Stops refreshing, once the view is gone. */
  stop(): void
}

/** How often the view reads its connections anew. */
const REFRESH_MS = 1000

/**
 * How the connections of a game are doing, for a game's dialog: a graph of the last minute's
 * pings, and for each connection what the room measured (ping, pings lost, stalls, messages
 * and data each way), what its transport tells (what carries it, the addresses and protocols
 * on both ends, the transport's own round trip, packets and bytes, encryption, channels) and
 * the last connection test, which the host can start from here.
 *
 * Addresses show masked, with what kind they are, until the player taps `reveal`: what is on a
 * screen ends up in screenshots. The game brings the texts and the look, by these classes:
 * `.connection-view`, `canvas.net-graph.large`, `section.connection` with an `h3` and a
 * `dl.connection-stats`, `.address` (`.masked` while masked), `.connection-buttons`, and
 * `.connection-test` for the last test's results.
 */
export function connectionView(options: ConnectionViewOptions): ConnectionView {
  const { texts, net } = options
  let revealed = false
  let testing = false
  let stopped = false
  const graph = el('canvas', { className: 'net-graph large' })
  const list = el('div', { className: 'connections' })
  const tested = el('div', { className: 'connection-test' })
  const reveal = el('button', { type: 'button', textContent: texts.reveal })
  const test = options.test
    ? el('button', { type: 'button', className: 'primary', textContent: texts.test })
    : null
  const element = el(
    'div',
    { className: 'connection-view' },
    graph,
    tested,
    list,
    el('div', { className: 'connection-buttons' }, reveal, test),
  )
  let details = new Map<number, ConnectionDetails | null>()
  /** The connections whose transport details are unfolded, kept as the view is drawn anew. */
  const unfolded = new Set<number>()

  reveal.onclick = () => {
    revealed = !revealed
    reveal.textContent = revealed ? texts.hide : texts.reveal
    draw()
  }
  if (test && options.test) {
    const run = options.test
    test.onclick = async () => {
      if (testing) return
      testing = true
      test.disabled = true
      test.textContent = texts.testing
      try {
        await run()
      } finally {
        testing = false
        test.disabled = false
        test.textContent = texts.test
        draw()
      }
    }
  }

  const address = (endpoint: Endpoint | undefined): Node => {
    if (!endpoint) return document.createTextNode(texts.none)
    const kind = addressKind(endpoint.address)
    const shown = revealed
      ? `${endpoint.address}${endpoint.port === undefined ? '' : ` : ${endpoint.port}`}`
      : maskAddress(endpoint.address)
    const extra = [texts.kinds[kind], endpoint.protocol, endpoint.type, endpoint.network]
      .filter(Boolean)
      .join(' · ')
    return el(
      'span',
      {},
      el('span', { className: revealed ? 'address' : 'address masked', textContent: shown }),
      ` (${extra})`,
    )
  }

  const stats = (rows: readonly [ConnectionRow, Node | string][]) =>
    el(
      'dl',
      { className: 'connection-stats' },
      ...rows.flatMap(([row, value]) => [
        el('dt', { textContent: texts.rows[row] }),
        el('dd', {}, value),
      ]),
    )

  const draw = () => {
    if (stopped) return
    const now = performance.now()
    drawNetGraph(graph, net, now, 60, { axes: true, color: options.color, nowLabel: texts.now })
    const summaries = new Map(net.summary().map((s) => [s.peer, s]))
    const latest = new Map(net.samples.map((s) => [s.peer, s]))
    list.replaceChildren(
      ...options.connections().map(({ peer, name }) => {
        const rows: [ConnectionRow, Node | string][] = []
        const s = summaries.get(peer)
        const last = latest.get(peer)
        if (s) {
          rows.push(
            [
              'ping',
              last?.ping == null
                ? texts.none
                : `${last.ping} ms${s.ping ? ` (Ø ${s.ping.median}, 95 % < ${s.ping.p95})` : ''}`,
            ],
            ['pingLoss', s.loss === null ? texts.none : percent(s.loss)],
            ['stalls', `${s.stalls} × ≥ ${STALL_MS} ms (max ${s.longestGap} ms)`],
            ['messages', `↓ ${last?.inRate ?? 0}/s · ↑ ${last?.outRate ?? 0}/s`],
            ['data', `↓ ${kb(s.kbIn * 1000)} · ↑ ${kb(s.kbOut * 1000)}`],
          )
        }
        const d = details.get(peer)
        const more: [ConnectionRow, Node | string][] = []
        if (d) {
          rows.push(['transport', texts.transports[d.transport] ?? d.transport])
          more.push(['local', address(d.local)], ['remote', address(d.remote)])
          if (d.candidates) {
            const offered = (list: readonly Endpoint[]) =>
              revealed ? list.map((e) => e.address).join(', ') || texts.none : String(list.length)
            more.push([
              'offered',
              `${offered(d.candidates.local)} / ${offered(d.candidates.remote)}`,
            ])
          }
          if (d.rttMs !== undefined) more.push(['rtt', `${d.rttMs} ms`])
          if (d.availableKbps !== undefined) more.push(['available', `${d.availableKbps} kbit/s`])
          if (d.packetsSent !== undefined || d.packetsReceived !== undefined)
            more.push(['packets', `↑ ${d.packetsSent ?? '?'} · ↓ ${d.packetsReceived ?? '?'}`])
          if (d.bytesSent !== undefined || d.bytesReceived !== undefined)
            more.push(['bytes', `↑ ${kb(d.bytesSent)} · ↓ ${kb(d.bytesReceived)}`])
          if (d.security) more.push(['security', d.security])
          if (d.channels && d.channels.length > 0)
            more.push([
              'channels',
              d.channels
                .map(
                  (c) => `${c.label}: ↑ ${c.messagesSent ?? '?'} · ↓ ${c.messagesReceived ?? '?'}`,
                )
                .join('; '),
            ])
        }
        const fold =
          more.length === 0
            ? null
            : el(
                'details',
                { className: 'connection-transport', open: unfolded.has(peer) },
                el('summary', { textContent: texts.more }),
                stats(more),
              )
        fold?.addEventListener('toggle', () => {
          if (fold.open) unfolded.add(peer)
          else unfolded.delete(peer)
        })
        return el(
          'section',
          { className: 'connection' },
          el('h3', { textContent: name }),
          stats(rows),
          fold,
        )
      }),
    )
    drawTest()
  }

  const drawTest = () => {
    const last = options.lastTest?.() ?? null
    tested.hidden = last === null
    if (!last) return tested.replaceChildren()
    const runs: [string | null, ConnectionTest | null][] =
      'players' in last
        ? last.players.map(({ player, result }) => [
            options.connections().find((c) => c.peer === player.id)?.name ?? player.name,
            result,
          ])
        : [[null, last]]
    tested.replaceChildren(
      el('h3', { textContent: texts.lastTest }),
      ...runs.map(([name, result]) =>
        el(
          'dl',
          { className: 'connection-stats' },
          name ? el('dt', { className: 'name', textContent: name }) : null,
          name ? el('dd', { textContent: result ? '' : texts.noAnswer }) : null,
          ...(result
            ? [
                el('dt', { textContent: texts.rows.testPing }),
                el('dd', {
                  textContent: result.ping
                    ? `${result.ping.median} ms (${result.ping.min}–${result.ping.max}), ${percent(result.pingLoss)} ${texts.lost}`
                    : texts.none,
                }),
                el('dt', { textContent: texts.rows.testDown }),
                el('dd', { textContent: throughput(result.down, texts.lost) }),
                el('dt', { textContent: texts.rows.testUp }),
                el('dd', { textContent: throughput(result.up, texts.lost) }),
              ]
            : []),
        ),
      ),
    )
  }

  const refresh = async () => {
    const shown = options.connections()
    const read = await Promise.all(
      shown.map(async (c) => [c.peer, await c.details().catch(() => null)] as const),
    )
    details = new Map(read)
    draw()
  }

  draw()
  void refresh()
  const timer = setInterval(() => void refresh(), REFRESH_MS)
  return {
    element,
    refresh,
    stop() {
      stopped = true
      clearInterval(timer)
    },
  }
}

function percent(share: number): string {
  return `${Math.round(share * 1000) / 10} %`
}

function kb(bytes: number | undefined): string {
  if (bytes === undefined) return '?'
  return bytes >= 1_000_000
    ? `${Math.round(bytes / 100_000) / 10} MB`
    : `${Math.round(bytes / 100) / 10} kB`
}

function throughput(t: ConnectionTest['down'], lost: string): string {
  return `${t.kbPerSecond} kB/s (${percent(t.loss)} ${lost})`
}

/** A small element maker, as the library has no DOM helpers of its own elsewhere. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props)
  for (const child of children) if (child !== null) element.append(child)
  return element
}
