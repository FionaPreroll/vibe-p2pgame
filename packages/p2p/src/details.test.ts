import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { addressKind, maskAddress, rtcDetails } from './details.ts'
import { packetConnection } from './packet.ts'

/** What Chrome's getStats() says about a connection over a hotspot, trimmed to what is read. */
const chrome = [
  {
    id: 'T01',
    type: 'transport',
    selectedCandidatePairId: 'CP1',
    dtlsState: 'connected',
    tlsVersion: 'FEFD',
    dtlsCipher: 'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
    bytesSent: 52_000,
    bytesReceived: 61_000,
    packetsSent: 400,
    packetsReceived: 420,
  },
  {
    id: 'CP0',
    type: 'candidate-pair',
    state: 'failed',
    localCandidateId: 'L2',
    remoteCandidateId: 'R1',
  },
  {
    id: 'CP1',
    type: 'candidate-pair',
    state: 'succeeded',
    nominated: true,
    localCandidateId: 'L1',
    remoteCandidateId: 'R1',
    currentRoundTripTime: 0.012,
    availableOutgoingBitrate: 2_400_000,
  },
  {
    id: 'L1',
    type: 'local-candidate',
    address: '192.168.43.12',
    port: 50_123,
    protocol: 'udp',
    candidateType: 'host',
    networkType: 'wifi',
  },
  { id: 'L2', type: 'local-candidate', address: 'fe80::1', port: 50_124, protocol: 'udp' },
  {
    id: 'R1',
    type: 'remote-candidate',
    ip: '192.168.43.1',
    port: 40_000,
    protocol: 'udp',
    candidateType: 'host',
  },
  {
    id: 'D1',
    type: 'data-channel',
    label: 'control',
    state: 'open',
    messagesSent: 3,
    messagesReceived: 4,
    bytesSent: 300,
    bytesReceived: 400,
  },
  { id: 'D2', type: 'data-channel', label: 'fast', state: 'open', messagesSent: 900 },
  { id: 'X', type: 'codec', mimeType: 'whatever' },
]

describe('rtcDetails', () => {
  it('reads the pair in use, both ends, every address offered and every channel', () => {
    expect(rtcDetails(chrome)).toEqual({
      transport: 'webrtc',
      local: {
        address: '192.168.43.12',
        port: 50_123,
        protocol: 'udp',
        type: 'host',
        network: 'wifi',
      },
      remote: { address: '192.168.43.1', port: 40_000, protocol: 'udp', type: 'host' },
      candidates: {
        local: [
          {
            address: '192.168.43.12',
            port: 50_123,
            protocol: 'udp',
            type: 'host',
            network: 'wifi',
          },
          { address: 'fe80::1', port: 50_124, protocol: 'udp' },
        ],
        remote: [{ address: '192.168.43.1', port: 40_000, protocol: 'udp', type: 'host' }],
      },
      rttMs: 12,
      availableKbps: 2400,
      bytesSent: 52_000,
      bytesReceived: 61_000,
      packetsSent: 400,
      packetsReceived: 420,
      security: 'DTLS 1.2, TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
      state: 'connected',
      channels: [
        {
          label: 'control',
          state: 'open',
          messagesSent: 3,
          messagesReceived: 4,
          bytesSent: 300,
          bytesReceived: 400,
        },
        { label: 'fast', state: 'open', messagesSent: 900 },
      ],
    })
  })

  it('finds the pair in use without a transport entry, as Firefox reports it', () => {
    const firefox = chrome
      .filter((s) => s.type !== 'transport')
      .map((s) => (s.id === 'CP1' ? { ...s, nominated: false, selected: true } : s))
    const details = rtcDetails(firefox)
    expect(details.local?.address).toBe('192.168.43.12')
    expect(details.security).toBeUndefined()
    expect(details.state).toBe('succeeded')
  })

  it('makes do with nothing, and with nonsense', () => {
    expect(rtcDetails([])).toEqual({
      transport: 'webrtc',
      candidates: { local: [], remote: [] },
      channels: [],
    })
    fc.assert(
      fc.property(
        fc.array(fc.dictionary(fc.constantFrom('id', 'type', 'address', 'port'), fc.anything())),
        (entries) => {
          expect(() => rtcDetails(entries)).not.toThrow()
        },
      ),
    )
  })
})

describe('addresses', () => {
  it('tell their kind without telling which', () => {
    expect(addressKind('192.168.43.1')).toBe('ipv4-local')
    expect(addressKind('10.0.0.2')).toBe('ipv4-local')
    expect(addressKind('172.20.1.1')).toBe('ipv4-local')
    expect(addressKind('172.32.1.1')).toBe('ipv4')
    expect(addressKind('100.70.1.1')).toBe('ipv4-local')
    expect(addressKind('8.8.8.8')).toBe('ipv4')
    expect(addressKind('127.0.0.1')).toBe('loopback')
    expect(addressKind('::1')).toBe('loopback')
    expect(addressKind('fe80::1c2b:3a')).toBe('ipv6-local')
    expect(addressKind('fd00::1')).toBe('ipv6-local')
    expect(addressKind('2a02:810d:4ac0::1')).toBe('ipv6')
    expect(addressKind('0a:1b:2c:3d:4e:5f')).toBe('mac')
    expect(addressKind('7f2c3a1e-1111-4b2b-9c3d-0e1f2a3b4c5d.local')).toBe('mdns')
    expect(addressKind('AB12')).toBe('other')
  })

  it('are masked whole, leaving only their shape', () => {
    for (const [address, masked] of <[string, string][]>[
      ['192.168.43.1', '•••.•••.•••.•••'],
      ['2a02:810d:4ac0::1', '••••:••••:••••::••••'],
      ['0a:1b:2c:3d:4e:5f', '••:••:••:••:••:••'],
      ['7f2c3a1e-1111-4b2b-9c3d-0e1f2a3b4c5d.local', '••••••••.local'],
      ['AB12', '••••••'],
    ])
      expect(maskAddress(address)).toBe(masked)
    fc.assert(
      fc.property(fc.oneof(fc.ipV4(), fc.ipV6(), fc.string()), (address) => {
        expect(maskAddress(address)).toMatch(/^[•.:]+(local)?$/)
      }),
    )
  })
})

describe('a packet connection’s details', () => {
  it('count both channels, beside what the transport tells', async () => {
    const connection = packetConnection({
      send() {},
      close() {},
      details: () => ({ transport: 'bluetooth', remote: { address: 'AB12' } }),
    })
    connection.markOpen()
    connection.fast.send('hello')
    connection.receive('control', 'hi')
    expect(await connection.details()).toEqual({
      transport: 'bluetooth',
      remote: { address: 'AB12' },
      channels: [
        {
          label: 'control',
          state: 'open',
          messagesSent: 0,
          messagesReceived: 1,
          bytesSent: 0,
          bytesReceived: 2,
        },
        {
          label: 'fast',
          state: 'open',
          messagesSent: 1,
          messagesReceived: 0,
          bytesSent: 5,
          bytesReceived: 0,
        },
      ],
    })
    expect((await packetConnection({ send() {}, close() {} }).details()).transport).toBe('packets')
  })
})
