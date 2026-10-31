import { describe, expect, it } from 'vitest'
import { fromSdp, pack, toSdp, unpack } from './signal.ts'

/** An offer as Chrome writes it for a data channel, shortened to the lines that matter. */
const CHROME_OFFER = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1467250027 1 udp 2122260223 192.168.43.1 54321 typ host generation 0 network-id 1',
  'a=candidate:1467250027 1 udp 2122260223 192.168.43.1 54321 typ host generation 0 network-id 2',
  'a=candidate:3029435403 1 udp 2122194687 2a02:810d:4ac0::1 50000 typ host generation 0',
  'a=candidate:2999745851 1 udp 2122129151 7f2c3a1e-1111-4b2b-9c3d-0e1f2a3b4c5d.local 50001 typ host',
  'a=candidate:435653019 1 tcp 1518280447 192.168.43.1 9 typ host tcptype active generation 0',
  'a=candidate:842163049 1 udp 1677729535 85.1.2.3 61000 typ srflx raddr 192.168.43.1 rport 54321',
  'a=ice-ufrag:Xk3Y',
  'a=ice-pwd:a1B2c3D4e5F6g7H8i9J0k1L2',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n')

describe('fromSdp', () => {
  it('keeps the credentials, the role and the UDP host candidates, IPv4 first', () => {
    const signal = fromSdp('offer', CHROME_OFFER)
    expect(signal.type).toBe('offer')
    expect(signal.setup).toBe('actpass')
    expect(signal.ufrag).toBe('Xk3Y')
    expect(signal.pwd).toBe('a1B2c3D4e5F6g7H8i9J0k1L2')
    expect(signal.fingerprint).toHaveLength(32)
    expect(signal.fingerprint[0]).toBe(0x0a)
    expect(signal.candidates).toEqual([
      { address: '192.168.43.1', port: 54321 },
      { address: '7f2c3a1e-1111-4b2b-9c3d-0e1f2a3b4c5d.local', port: 50001 },
      { address: '2a02:810d:4ac0::1', port: 50000 },
    ])
  })

  it('refuses an SDP without a SHA-256 fingerprint', () => {
    expect(() => fromSdp('offer', CHROME_OFFER.replace('sha-256', 'sha-1'))).toThrow()
    expect(() => fromSdp('offer', 'v=0\r\n')).toThrow()
  })
})

describe('pack and unpack', () => {
  it('give back the same signal', () => {
    const signal = fromSdp('offer', CHROME_OFFER)
    expect(unpack(pack(signal))).toEqual(signal)
    const answer = { ...signal, type: 'answer' as const, setup: 'active' as const, candidates: [] }
    expect(unpack(pack(answer))).toEqual(answer)
  })

  it('make a code short enough for a QR code a phone reads from a screen', () => {
    const code = pack(fromSdp('offer', CHROME_OFFER))
    expect(code.length).toBeLessThan(200)
    expect(CHROME_OFFER.length).toBeGreaterThan(code.length * 5)
  })

  it('read the code from a link as well', () => {
    const signal = fromSdp('offer', CHROME_OFFER)
    const code = pack(signal)
    expect(unpack(`https://example.com/game/#o=${code}`)).toEqual(signal)
    expect(unpack(`https://example.com/game/#o=${encodeURIComponent(code)}`)).toEqual(signal)
  })

  it('ignore anything that is not a code', () => {
    const code = pack(fromSdp('offer', CHROME_OFFER))
    for (const text of [
      '',
      'https://example.com/',
      'hello~world',
      code.replace('P1', 'P2'),
      code.replace('~o~', '~q~'),
      code.replace('~x~', '~z~'),
      `${code}~extra`,
      `${code},99999`,
      code.replace(/~[^~]{43}~/, '~short~'),
      '%E0%A4%A',
    ]) {
      expect(unpack(text), text).toBeUndefined()
    }
  })
})

describe('toSdp', () => {
  it('writes an SDP that reads back as the same signal', () => {
    const signal = fromSdp('offer', CHROME_OFFER)
    const sdp = toSdp(signal)
    expect(sdp).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel')
    expect(sdp).toContain(
      'a=fingerprint:sha-256 0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9',
    )
    expect(fromSdp('offer', sdp)).toEqual(signal)
  })
})
