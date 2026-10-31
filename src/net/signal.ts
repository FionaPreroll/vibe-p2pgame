/**
 * Packs a WebRTC session description into a short code for a QR code, and unpacks it again.
 *
 * A browser's SDP for a data channel is 1–3 KB, too dense for a QR code a phone camera reads
 * from another phone's screen. Most of it is the same for every connection, though. Only five
 * things differ: offer or answer, the ICE user fragment and password, the DTLS certificate
 * fingerprint, the DTLS role and the addresses to try. The code carries just those, about
 * 150 characters, and `unpack` writes a minimal SDP around them that every browser accepts.
 *
 * Without internet there is no STUN server, so the only useful candidates are the phone's own
 * UDP addresses on the hotspot (`typ host`). Chrome may hide these behind random `.local` names
 * (mDNS) until the page may use the camera; such names travel as they are.
 *
 * Format, fields joined by `~`: `P1~<o|a>~<setup>~<ufrag>~<pwd>~<fingerprint>~<candidates>`
 * - setup: `x` actpass, `a` active, `p` passive
 * - fingerprint: the SHA-256 fingerprint as unpadded base64url
 * - candidates: `<address>,<port>` joined by `!`
 *
 * None of these characters occur inside a field (ICE credentials use letters, digits, `+` and
 * `/`), and all may stand unescaped in a URL fragment.
 */

export type SignalType = 'offer' | 'answer'

export interface Candidate {
  readonly address: string
  readonly port: number
}

export interface Signal {
  readonly type: SignalType
  readonly setup: 'actpass' | 'active' | 'passive'
  readonly ufrag: string
  readonly pwd: string
  /** The 32 bytes of the SHA-256 certificate fingerprint. */
  readonly fingerprint: Uint8Array
  readonly candidates: readonly Candidate[]
}

const MAGIC = 'P1'
/** Enough for a hotspot, and keeps the QR code small on phones with many network interfaces. */
const MAX_CANDIDATES = 6
const SETUP_CODES = { actpass: 'x', active: 'a', passive: 'p' } as const

/** Reads the parts of a browser's SDP that the other side needs. */
export function fromSdp(type: SignalType, sdp: string): Signal {
  const lines = sdp.split(/\r?\n/)
  const value = (prefix: string): string => {
    const line = lines.find((l) => l.startsWith(prefix))
    if (line === undefined) throw new Error(`SDP without ${prefix}`)
    return line.slice(prefix.length).trim()
  }
  const [algorithm, hex] = value('a=fingerprint:').split(' ')
  if (algorithm?.toLowerCase() !== 'sha-256' || hex === undefined) {
    throw new Error('SDP without a SHA-256 fingerprint')
  }
  const setup = value('a=setup:')
  if (setup !== 'actpass' && setup !== 'active' && setup !== 'passive') {
    throw new Error(`Unknown DTLS role ${setup}`)
  }
  const candidates: Candidate[] = []
  for (const line of lines) {
    if (!line.startsWith('a=candidate:')) continue
    // foundation component protocol priority address port "typ" type …
    const [, component, protocol, , address, port, , kind] = line.trim().split(' ')
    if (component !== '1' || protocol?.toLowerCase() !== 'udp' || kind !== 'host') continue
    if (address === undefined || port === undefined) continue
    if (candidates.some((c) => c.address === address && c.port === Number(port))) continue
    candidates.push({ address, port: Number(port) })
  }
  // IPv4 first: a hotspot hands those out, while IPv6 addresses often belong to mobile data.
  candidates.sort((a, b) => Number(a.address.includes(':')) - Number(b.address.includes(':')))
  return {
    type,
    setup,
    ufrag: value('a=ice-ufrag:'),
    pwd: value('a=ice-pwd:'),
    fingerprint: Uint8Array.from(hex.split(':'), (byte) => Number.parseInt(byte, 16)),
    candidates: candidates.slice(0, MAX_CANDIDATES),
  }
}

/** Writes a minimal SDP for a data channel connection, as `RTCPeerConnection` accepts it. */
export function toSdp(signal: Signal): string {
  const fingerprint = Array.from(signal.fingerprint, (byte) =>
    byte.toString(16).padStart(2, '0').toUpperCase(),
  ).join(':')
  const candidates = signal.candidates.map(
    // Host candidates, in the order given: 126 is the type preference of a host candidate.
    (c, i) => `a=candidate:${i + 1} 1 udp ${2130706431 - i} ${c.address} ${c.port} typ host`,
  )
  return [
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...candidates,
    'a=end-of-candidates',
    `a=ice-ufrag:${signal.ufrag}`,
    `a=ice-pwd:${signal.pwd}`,
    `a=fingerprint:sha-256 ${fingerprint}`,
    `a=setup:${signal.setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n')
}

/** The signal as a short code. */
export function pack(signal: Signal): string {
  return [
    MAGIC,
    signal.type === 'offer' ? 'o' : 'a',
    SETUP_CODES[signal.setup],
    signal.ufrag,
    signal.pwd,
    toBase64Url(signal.fingerprint),
    signal.candidates.map((c) => `${c.address},${c.port}`).join('!'),
  ].join('~')
}

/**
 * Reads a code made by `pack`. Takes the bare code as well as a link with the code in its
 * fragment (`…#o=<code>`), as a phone's own camera app opens it. Returns undefined for
 * anything else, such as a QR code that belongs to something else.
 */
export function unpack(text: string): Signal | undefined {
  let code = text.includes('#') ? text.slice(text.indexOf('#') + 1) : text
  try {
    code = decodeURIComponent(code)
      .replace(/^[oa]=/, '')
      .trim()
  } catch {
    return undefined
  }
  const [magic, type, setup, ufrag, pwd, fingerprint, candidates, ...rest] = code.split('~')
  if (magic !== MAGIC || rest.length > 0 || candidates === undefined) return undefined
  if (type !== 'o' && type !== 'a') return undefined
  const role = (Object.keys(SETUP_CODES) as Signal['setup'][]).find(
    (key) => SETUP_CODES[key] === setup,
  )
  if (role === undefined || !ufrag || !pwd) return undefined
  const bytes = fromBase64Url(fingerprint ?? '')
  if (bytes?.length !== 32) return undefined
  const list: Candidate[] = []
  for (const entry of candidates === '' ? [] : candidates.split('!')) {
    const comma = entry.lastIndexOf(',')
    const port = Number(entry.slice(comma + 1))
    if (comma < 1 || !Number.isInteger(port) || port < 1 || port > 65535) return undefined
    list.push({ address: entry.slice(0, comma), port })
  }
  return {
    type: type === 'o' ? 'offer' : 'answer',
    setup: role,
    ufrag,
    pwd,
    fingerprint: bytes,
    candidates: list,
  }
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array | undefined {
  try {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch {
    return undefined
  }
}
