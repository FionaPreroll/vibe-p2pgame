/**
 * What a connection can tell about itself, for a game's connection screen and debug report:
 * what carries it, the addresses and protocols on both ends, and what went over it as the
 * transport counts it. `Connection.details()` gives it, where the transport can tell.
 *
 * Addresses are the phone's own and the other phone's, as the transport knows them. They never
 * leave the phone by themselves: a game shows them masked (`maskAddress`) until the player asks
 * to see them, and a debug report holds only their kind (`addressKind`).
 */

/** One end of a connection. */
export interface Endpoint {
  /** An IP address, a name such as an mDNS name (`….local`), or a transport's own id. */
  readonly address: string
  readonly port?: number
  /** `udp` or `tcp`, for WebRTC. */
  readonly protocol?: string
  /**
   * How it was found, for WebRTC: `host` (the phone's own address), `srflx` (as a STUN server
   * sees it), `prflx` (as the other phone saw it) or `relay` (a TURN server).
   */
  readonly type?: string
  /** The kind of network, where the browser says: `wifi`, `ethernet`, `cellular`, … */
  readonly network?: string
}

/** One channel of a connection, as the transport counts it. */
export interface ChannelDetails {
  readonly label: string
  readonly state?: string
  readonly messagesSent?: number
  readonly messagesReceived?: number
  readonly bytesSent?: number
  readonly bytesReceived?: number
}

export interface ConnectionDetails {
  /** What carries it: `webrtc`, `bluetooth`, `memory`, or what a transport calls itself. */
  readonly transport: string
  /** This phone's end, and the other phone's, of the path in use. */
  readonly local?: Endpoint
  readonly remote?: Endpoint
  /** Every address each side offered, of which the pair in use is one. */
  readonly candidates?: {
    readonly local: readonly Endpoint[]
    readonly remote: readonly Endpoint[]
  }
  /** The round trip as the transport itself measured it, in milliseconds. */
  readonly rttMs?: number
  /** What the transport thinks it could send, in kilobits per second. */
  readonly availableKbps?: number
  /** Everything that went over the transport, all channels and its own messages together. */
  readonly bytesSent?: number
  readonly bytesReceived?: number
  readonly packetsSent?: number
  readonly packetsReceived?: number
  /** How it is encrypted, such as `DTLS 1.2, TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256`. */
  readonly security?: string
  /** The state of the transport's own connection, such as `connected`. */
  readonly state?: string
  readonly channels?: readonly ChannelDetails[]
  /** Anything else the transport tells, by name. */
  readonly extra?: Readonly<Record<string, string | number | boolean>>
}

/** What an address is, without saying which one: safe for a debug report. */
export type AddressKind =
  | 'ipv4-local'
  | 'ipv4'
  | 'ipv6-local'
  | 'ipv6'
  | 'mdns'
  | 'mac'
  | 'loopback'
  | 'other'

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const MAC = /^[0-9a-f]{2}([:-])[0-9a-f]{2}(?:\1[0-9a-f]{2}){4}$/i

export function addressKind(address: string): AddressKind {
  const v4 = IPV4.exec(address)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 127) return 'loopback'
    const local =
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    return local ? 'ipv4-local' : 'ipv4'
  }
  if (MAC.test(address)) return 'mac'
  if (address.includes(':') && /^[0-9a-f:.]+$/i.test(address)) {
    const lower = address.toLowerCase()
    if (lower === '::1') return 'loopback'
    return /^(fe[89ab]|f[cd])/.test(lower) ? 'ipv6-local' : 'ipv6'
  }
  if (/\.local$/i.test(address)) return 'mdns'
  return 'other'
}

/** An address with nothing left of it but its shape, to show before the player reveals it. */
export function maskAddress(address: string): string {
  switch (addressKind(address)) {
    case 'ipv4':
    case 'ipv4-local':
    case 'loopback':
      return address.includes(':') ? '••••::•' : '•••.•••.•••.•••'
    case 'ipv6':
    case 'ipv6-local':
      return '••••:••••:••••::••••'
    case 'mac':
      return '••:••:••:••:••:••'
    case 'mdns':
      return '••••••••.local'
    default:
      return '••••••'
  }
}

/** Reads one of a stats report's entries, which are plain objects with a type and an id. */
type Stats = Readonly<Record<string, unknown>>

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value.slice(0, 200) : undefined
const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

function endpoint(stats: Stats | undefined): Endpoint | undefined {
  if (!stats) return undefined
  const address = text(stats.address) ?? text(stats.ip)
  if (!address) return undefined
  return {
    address,
    port: count(stats.port),
    protocol: text(stats.protocol),
    type: text(stats.candidateType),
    network: text(stats.networkType),
  }
}

/**
 * A WebRTC connection's details, from its `getStats()`: the candidate pair in use, both ends of
 * it and every candidate offered, the transport's counts and encryption, and every data channel.
 * Takes the report's entries, so it reads Chrome's, Firefox's and Safari's alike.
 */
export function rtcDetails(entries: Iterable<Stats>): ConnectionDetails {
  const all = [...entries]
  const byId = new Map(all.map((s) => [s.id, s]))
  const of = (type: string) => all.filter((s) => s.type === type)
  const transport = of('transport')[0]
  const pairs = of('candidate-pair')
  const pair =
    byId.get(transport?.selectedCandidatePairId) ??
    pairs.find((p) => p.selected === true) ??
    pairs.find((p) => p.nominated === true && p.state === 'succeeded') ??
    pairs.find((p) => p.state === 'succeeded')
  const rtt = count(pair?.currentRoundTripTime)
  const available = count(pair?.availableOutgoingBitrate)
  const security = [
    text(transport?.tlsVersion) && `DTLS ${dtlsVersion(text(transport?.tlsVersion) ?? '')}`,
    text(transport?.dtlsCipher),
  ].filter(Boolean)
  return {
    transport: 'webrtc',
    local: endpoint(byId.get(pair?.localCandidateId)),
    remote: endpoint(byId.get(pair?.remoteCandidateId)),
    candidates: {
      local: of('local-candidate').flatMap((s) => endpoint(s) ?? []),
      remote: of('remote-candidate').flatMap((s) => endpoint(s) ?? []),
    },
    rttMs: rtt === undefined ? undefined : Math.round(rtt * 1000),
    availableKbps: available === undefined ? undefined : Math.round(available / 1000),
    bytesSent: count(transport?.bytesSent) ?? count(pair?.bytesSent),
    bytesReceived: count(transport?.bytesReceived) ?? count(pair?.bytesReceived),
    packetsSent: count(transport?.packetsSent) ?? count(pair?.packetsSent),
    packetsReceived: count(transport?.packetsReceived) ?? count(pair?.packetsReceived),
    security: security.length > 0 ? security.join(', ') : undefined,
    state: text(transport?.dtlsState) ?? text(pair?.state),
    channels: of('data-channel').map((s) => ({
      label: text(s.label) ?? '?',
      state: text(s.state),
      messagesSent: count(s.messagesSent),
      messagesReceived: count(s.messagesReceived),
      bytesSent: count(s.bytesSent),
      bytesReceived: count(s.bytesReceived),
    })),
  }
}

/** Chrome names DTLS 1.2 by its wire code, `FEFD`. */
function dtlsVersion(version: string): string {
  const codes: Record<string, string> = { FEFF: '1.0', FEFD: '1.2', FEFC: '1.3' }
  return codes[version.toUpperCase()] ?? version
}
