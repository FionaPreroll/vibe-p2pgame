import { describe, expect, it } from 'vitest'
import type { ConnectionTestRun } from '../room/host.ts'
import { detailsLines, testLine, testLines } from './details.ts'

describe('a debug report’s lines about connections', () => {
  it('tell what carries a connection and the kind of each end, never the address', () => {
    const lines = detailsLines(2, {
      transport: 'webrtc',
      state: 'connected',
      local: { address: '192.168.43.12', protocol: 'udp', type: 'host', network: 'wifi' },
      remote: { address: '7f2c3a1e-1111-4b2b-9c3d-0e1f2a3b4c5d.local', type: 'host' },
      candidates: {
        local: [
          { address: '192.168.43.12', protocol: 'udp' },
          { address: '10.0.0.2', protocol: 'udp' },
          { address: 'fe80::1', protocol: 'tcp' },
        ],
        remote: [],
      },
      rttMs: 12,
      availableKbps: 2400,
      bytesSent: 100,
      packetsSent: 3,
      security: 'DTLS 1.2',
      channels: [{ label: 'fast', state: 'open', messagesSent: 9, messagesReceived: 8 }],
    }).join('\n')
    expect(lines).toBe(
      [
        '- To player 2, over webrtc, connected',
        '  - This phone: ipv4-local host udp wifi; the other: mdns host',
        '  - Addresses offered: 2 ipv4-local/udp, 1 ipv6-local/tcp here, none there',
        '  - Round trip of the transport: 12 ms, can send 2400 kbit/s',
        '  - Transport sent 3 packets, 100 bytes; received ? packets, ? bytes',
        '  - Encryption: DTLS 1.2',
        '  - Channel fast (open): 9 messages sent, 8 received',
      ].join('\n'),
    )
    expect(lines).not.toMatch(/192\.168|10\.0|fe80|7f2c/)
    expect(detailsLines(0, null)).toEqual(['- To host: no details from this kind of connection'])
    expect(detailsLines(0, { transport: 'memory' })).toEqual([
      '- To host, over memory',
      '  - This phone: unknown; the other: unknown',
    ])
  })

  it('tell how a connection test went, for every player or for one', () => {
    const result = {
      ms: 5000,
      ping: { min: 10, median: 20, max: 90 },
      pingLoss: 0.02,
      down: { kbPerSecond: 812.5, loss: 0.1 },
      up: { kbPerSecond: 640, loss: 0 },
    }
    expect(testLine(result)).toBe(
      'ping 20 ms (10–90), 2% lost; down 812.5 kB/s (10% dropped), up 640 kB/s (0% dropped)',
    )
    expect(testLine({ ...result, ping: null })).toMatch(/^no ping came back;/)
    const run: ConnectionTestRun = {
      at: Date.UTC(2026, 10, 3, 12),
      ms: 5000,
      players: [
        { player: { id: 1, name: 'Ada', ping: 5 }, result },
        { player: { id: 2, name: 'Bo', ping: null }, result: null },
      ],
    }
    expect(testLines(run)).toEqual([
      '- 2026-11-03T12:00:00.000Z, over 5 s',
      `  - player 1: ${testLine(result)}`,
      '  - player 2: no answer',
    ])
    expect(testLines(run).join()).not.toMatch(/Ada|Bo/)
    expect(testLines(result)).toEqual([`- Over 5 s: ${testLine(result)}`])
    expect(testLines(null)).toEqual(['- No connection test was run.'])
  })
})
