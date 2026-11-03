import { addressKind, type ConnectionDetails, type Endpoint } from '../details.ts'
import type { ConnectionTestRun } from '../room/host.ts'
import type { ConnectionTest } from '../room/probe.ts'
import { peerLabel } from './netlog.ts'

/**
 * A connection's details as lines of Markdown for a debug report: what carries it, the kind of
 * each end (never the address itself), and what went over it. `peer` is the other phone's
 * player id.
 */
export function detailsLines(peer: number, details: ConnectionDetails | null): string[] {
  if (!details) return [`- To ${peerLabel(peer)}: no details from this kind of connection`]
  const end = (e: Endpoint | undefined) =>
    e
      ? [addressKind(e.address), e.type, e.protocol, e.network].filter(Boolean).join(' ')
      : 'unknown'
  const n = (value: number | undefined) => (value === undefined ? '?' : String(value))
  const lines = [
    `- To ${peerLabel(peer)}, over ${details.transport}${details.state ? `, ${details.state}` : ''}`,
    `  - This phone: ${end(details.local)}; the other: ${end(details.remote)}`,
  ]
  if (details.candidates)
    lines.push(
      `  - Addresses offered: ${kinds(details.candidates.local)} here, ${kinds(details.candidates.remote)} there`,
    )
  if (details.rttMs !== undefined || details.availableKbps !== undefined)
    lines.push(
      `  - Round trip of the transport: ${n(details.rttMs)} ms, can send ${n(details.availableKbps)} kbit/s`,
    )
  if (details.bytesSent !== undefined || details.packetsSent !== undefined)
    lines.push(
      `  - Transport sent ${n(details.packetsSent)} packets, ${n(details.bytesSent)} bytes; received ${n(details.packetsReceived)} packets, ${n(details.bytesReceived)} bytes`,
    )
  if (details.security) lines.push(`  - Encryption: ${details.security}`)
  for (const c of details.channels ?? [])
    lines.push(
      `  - Channel ${c.label}${c.state ? ` (${c.state})` : ''}: ${n(c.messagesSent)} messages sent, ${n(c.messagesReceived)} received${c.bytesSent === undefined ? '' : `, ${c.bytesSent} bytes sent, ${n(c.bytesReceived)} received`}`,
    )
  return lines
}

/** How many addresses of each kind, such as `2 ipv4-local, 1 mdns`. */
function kinds(endpoints: readonly Endpoint[]): string {
  if (endpoints.length === 0) return 'none'
  const counts = new Map<string, number>()
  for (const e of endpoints) {
    const kind = `${addressKind(e.address)}${e.protocol ? `/${e.protocol}` : ''}`
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts].map(([kind, count]) => `${count} ${kind}`).join(', ')
}

/** One connection's test result in a line. */
export function testLine(result: ConnectionTest): string {
  const pct = (share: number) => `${Math.round(share * 1000) / 10}%`
  const ping = result.ping
    ? `ping ${result.ping.median} ms (${result.ping.min}–${result.ping.max}), ${pct(result.pingLoss)} lost`
    : 'no ping came back'
  return `${ping}; down ${result.down.kbPerSecond} kB/s (${pct(result.down.loss)} dropped), up ${result.up.kbPerSecond} kB/s (${pct(result.up.loss)} dropped)`
}

/**
 * A connection test as lines of Markdown: on the host's phone a run for every player, on a
 * player's phone their own result.
 */
export function testLines(test: ConnectionTestRun | ConnectionTest | null): string[] {
  if (!test) return ['- No connection test was run.']
  if (!('players' in test)) return [`- Over ${test.ms / 1000} s: ${testLine(test)}`]
  return [
    `- ${new Date(test.at).toISOString()}, over ${test.ms / 1000} s`,
    ...test.players.map(
      ({ player, result }) =>
        `  - ${peerLabel(player.id)}: ${result ? testLine(result) : 'no answer'}`,
    ),
  ]
}
