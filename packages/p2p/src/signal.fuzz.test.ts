import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { pack, type Signal, toSdp, unpack } from './signal.ts'

const iceChars = fc.constantFrom(
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split(''),
)
const ipv4 = fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255)).map((p) => p.join('.'))
const mdns = fc.uuid().map((id) => `${id}.local`)
const ipv6 = fc.ipV6()
const signal: fc.Arbitrary<Signal> = fc.record({
  type: fc.constantFrom('offer', 'answer'),
  setup: fc.constantFrom('actpass', 'active', 'passive'),
  ufrag: fc.string({ unit: iceChars, minLength: 4, maxLength: 32 }),
  pwd: fc.string({ unit: iceChars, minLength: 22, maxLength: 64 }),
  fingerprint: fc.uint8Array({ minLength: 32, maxLength: 32 }),
  candidates: fc.array(
    fc.record({ address: fc.oneof(ipv4, ipv6, mdns), port: fc.integer({ min: 1, max: 65535 }) }),
    {
      maxLength: 6,
    },
  ),
})

/** The only lines a written SDP may have: no field can add one of its own. */
const SDP_LINE = [
  /^v=0$/,
  /^o=- 1 2 IN IP4 127\.0\.0\.1$/,
  /^s=-$/,
  /^t=0 0$/,
  /^a=group:BUNDLE 0$/,
  /^m=application 9 UDP\/DTLS\/SCTP webrtc-datachannel$/,
  /^c=IN IP4 0\.0\.0\.0$/,
  /^a=candidate:\d 1 udp \d+ [0-9A-Za-z.:-]+ \d{1,5} typ host$/,
  /^a=end-of-candidates$/,
  /^a=ice-ufrag:[A-Za-z0-9+/]+$/,
  /^a=ice-pwd:[A-Za-z0-9+/]+$/,
  /^a=fingerprint:sha-256 ([0-9A-F]{2}:){31}[0-9A-F]{2}$/,
  /^a=setup:(actpass|active|passive)$/,
  /^a=mid:0$/,
  /^a=sctp-port:5000$/,
  /^a=max-message-size:262144$/,
]

/** The fixed lines of every SDP, besides one line per candidate. */
const FIXED_LINES = 15

function expectOnlyKnownLines(sdp: string, candidates: number): void {
  const lines = sdp.split('\r\n')
  expect(lines.pop()).toBe('')
  // A smuggled line could look like a real one, so the lines are counted too.
  expect(lines).toHaveLength(FIXED_LINES + candidates)
  for (const line of lines) {
    expect(
      SDP_LINE.some((pattern) => pattern.test(line)),
      line,
    ).toBe(true)
  }
}

/** Codes with a part swapped for something hostile, the way a forged QR code would look. */
const forged = fc
  .tuple(
    signal,
    fc.nat(6),
    fc.oneof(
      fc.string(),
      fc.constantFrom(
        '%0D%0Aa=candidate:9 1 udp 1 6.6.6.6 9 typ host',
        '\r\n',
        '%00',
        '~',
        '!',
        ',',
        '#o=',
        '%',
      ),
    ),
  )
  .map(([s, part, text]) => {
    const parts = pack(s).split('~')
    parts[part] = `${parts[part]}${text}`
    return parts.join('~')
  })

describe('codes, fuzzed', () => {
  it('give back every valid signal', () => {
    fc.assert(
      fc.property(signal, (s) => {
        expect(unpack(pack(s))).toEqual(s)
        expect(unpack(`https://example.com/#o=${encodeURIComponent(pack(s))}`)).toEqual(s)
      }),
      { numRuns: 1000 },
    )
  })

  it('never throw, and never let a field write its own SDP line', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: 'binary' }), forged), (text) => {
        const s = unpack(text)
        if (s !== undefined) {
          expectOnlyKnownLines(toSdp(s), s.candidates.length)
          expect(unpack(pack(s))).toEqual(s)
        }
      }),
      { numRuns: 3000 },
    )
  })

  it('refuse a line break smuggled into a field', () => {
    const code = pack({
      type: 'offer',
      setup: 'actpass',
      ufrag: 'abcd',
      pwd: 'a'.repeat(22),
      fingerprint: new Uint8Array(32),
      candidates: [],
    })
    for (const evil of [
      code.replace('~abcd~', '~abcd%0D%0Aa=candidate:9 1 udp 1 6.6.6.6 9 typ host~'),
      code.replace('~abcd~', '~ab\ncd~'),
      code.replace(/~$/, '~6.6.6.6%0D%0Aa=x:y,9'),
      code.replace(/~$/, '~host name,9'),
      `${code}${'1.2.3.4,1!'.repeat(7)}`,
    ]) {
      expect(unpack(evil), evil).toBeUndefined()
    }
  })
})
