// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionDetails } from '../details.ts'
import type { ConnectionTestRun } from '../room/host.ts'
import { NetLog, type NetReading } from './netlog.ts'
import { type ConnectionRow, type ConnectionViewTexts, connectionView } from './view.ts'

const ROWS: ConnectionRow[] = [
  'ping',
  'pingLoss',
  'stalls',
  'messages',
  'data',
  'transport',
  'local',
  'remote',
  'offered',
  'rtt',
  'available',
  'packets',
  'bytes',
  'security',
  'channels',
  'testPing',
  'testDown',
  'testUp',
]

const texts: ConnectionViewTexts = {
  rows: Object.fromEntries(ROWS.map((row) => [row, `[${row}]`])) as ConnectionViewTexts['rows'],
  transports: { webrtc: 'Wi-Fi' },
  kinds: {
    'ipv4-local': 'local IPv4',
    ipv4: 'IPv4',
    'ipv6-local': 'local IPv6',
    ipv6: 'IPv6',
    mdns: 'mDNS',
    mac: 'MAC',
    loopback: 'loopback',
    other: 'id',
  },
  none: '–',
  lost: 'lost',
  more: 'More',
  reveal: 'Show addresses',
  hide: 'Hide addresses',
  test: 'Test',
  testing: 'Testing…',
  lastTest: 'Last test',
  noAnswer: 'no answer',
  now: 'now',
}

const details: ConnectionDetails = {
  transport: 'webrtc',
  local: { address: '192.168.43.12', port: 5000, protocol: 'udp', type: 'host' },
  remote: { address: '192.168.43.1', protocol: 'udp' },
  candidates: { local: [{ address: '192.168.43.12' }], remote: [{ address: '192.168.43.1' }] },
  rttMs: 12,
  availableKbps: 2400,
  packetsSent: 10,
  packetsReceived: 11,
  bytesSent: 1_500_000,
  bytesReceived: 2500,
  security: 'DTLS 1.2',
  channels: [{ label: 'fast', messagesSent: 9, messagesReceived: 8 }],
}

const reading = (ping: number, n: number): NetReading => ({
  ping,
  traffic: { sent: n, sentChars: n * 100, received: n, receivedChars: n * 100 },
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
})

afterEach(() => {
  vi.useRealTimers()
})

function log(): NetLog {
  const net = new NetLog(0, 0)
  net.sample(1, 0, reading(10, 0))
  net.sample(1, 1000, reading(24, 30))
  return net
}

const flush = () => vi.advanceTimersByTimeAsync(0)

describe('the connection view', () => {
  it('shows what the room measured and what the transport tells, with addresses masked', async () => {
    const view = connectionView({
      texts,
      net: log(),
      connections: () => [{ peer: 1, name: 'Bo', details: async () => details }],
    })
    await flush()
    const text = view.element.textContent ?? ''
    expect(text).toContain('Bo')
    expect(text).toContain('[ping]24 ms')
    expect(text).toContain('[transport]Wi-Fi')
    expect(text).toContain('•••.•••.•••.••• (local IPv4 · udp · host)')
    expect(text).toContain('[bytes]↑ 1.5 MB · ↓ 2.5 kB')
    expect(text).toContain('[offered]1 / 1')
    expect(text).not.toContain('192.168')
    // The transport's details stay unfolded as the view is drawn anew.
    const fold = view.element.querySelector('details') as HTMLDetailsElement
    expect(fold.open).toBe(false)
    fold.open = true
    fold.dispatchEvent(new Event('toggle'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(view.element.querySelector('details')?.open).toBe(true)
    // Revealed on request, and masked again.
    const reveal = view.element.querySelector('button') as HTMLButtonElement
    reveal.click()
    expect(view.element.textContent).toContain('192.168.43.12 : 5000')
    expect(reveal.textContent).toBe('Hide addresses')
    reveal.click()
    expect(view.element.textContent).not.toContain('192.168')
    view.stop()
  })

  it('lets the host test the connections, and shows the last test', async () => {
    let run: ConnectionTestRun | null = null
    let finish = () => {}
    const view = connectionView({
      texts,
      net: log(),
      connections: () => [{ peer: 1, name: 'Bo', details: async () => null }],
      test: () =>
        new Promise((resolve) => {
          finish = () => {
            run = {
              at: 0,
              ms: 5000,
              players: [
                {
                  player: { id: 1, name: 'Bo', ping: 5 },
                  result: {
                    ms: 5000,
                    ping: { min: 10, median: 20, max: 30 },
                    pingLoss: 0,
                    down: { kbPerSecond: 800, loss: 0.1 },
                    up: { kbPerSecond: 700, loss: 0 },
                  },
                },
                { player: { id: 2, name: 'Cy', ping: 5 }, result: null },
              ],
            }
            resolve(run)
          }
        }),
      lastTest: () => run,
    })
    await flush()
    const test = view.element.querySelectorAll('button')[1] as HTMLButtonElement
    expect(view.element.querySelector('.connection-test')?.hasAttribute('hidden')).toBe(true)
    test.click()
    expect(test.textContent).toBe('Testing…')
    expect(test.disabled).toBe(true)
    finish()
    await flush()
    expect(test.textContent).toBe('Test')
    const results = view.element.querySelector('.connection-test')?.textContent ?? ''
    expect(results).toContain('[testDown]800 kB/s (10 % lost)')
    expect(results).toContain('[testPing]20 ms (10–30), 0 % lost')
    expect(results).toContain('Cyno answer')
    view.stop()
  })

  it('reads its connections anew every second, until it stops', async () => {
    const read = vi.fn(async () => null)
    const view = connectionView({
      texts,
      net: new NetLog(1, 0),
      connections: () => [{ peer: 0, name: 'Host', details: read }],
      lastTest: () => ({
        ms: 1000,
        ping: null,
        pingLoss: 1,
        down: { kbPerSecond: 0, loss: 1 },
        up: { kbPerSecond: 0, loss: 1 },
      }),
    })
    await vi.advanceTimersByTimeAsync(3000)
    expect(read).toHaveBeenCalledTimes(4)
    expect(view.element.querySelectorAll('button')).toHaveLength(1)
    expect(view.element.textContent).toContain('[testPing]–')
    view.stop()
    await vi.advanceTimersByTimeAsync(3000)
    expect(read).toHaveBeenCalledTimes(4)
  })
})
