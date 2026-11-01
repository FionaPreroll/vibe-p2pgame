import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptAnswer, answerOffer, createOffer } from './link.ts'
import { pack, type Signal, unpack } from './signal.ts'

/** A code read back, which must be one. */
function read(code: string): Signal {
  const signal = unpack(code)
  if (!signal) throw new Error('not a code')
  return signal
}

/**
 * The WebRTC side, without a browser: a stand-in RTCPeerConnection that hands out an SDP as
 * Chrome writes it and gathers its addresses when the test says. The browser tests connect two
 * real pages; this checks what they cannot reach, such as the channels' settings, how the state
 * is read, and the safety net for gathering that never ends.
 */

function sdp(setup: 'actpass' | 'active', ufrag: string): string {
  return [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=candidate:1467250027 1 udp 2122260223 192.168.43.1 54321 typ host generation 0',
    `a=ice-ufrag:${ufrag}`,
    'a=ice-pwd:a1B2c3D4e5F6g7H8i9J0k1L2',
    'a=fingerprint:sha-256 0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9',
    `a=setup:${setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n')
}

class FakeChannel extends EventTarget {
  readyState: RTCDataChannelState = 'connecting'
  constructor(
    readonly label: string,
    readonly options: RTCDataChannelInit,
  ) {
    super()
  }
  set(state: RTCDataChannelState) {
    this.readyState = state
    this.dispatchEvent(new Event(state === 'open' ? 'open' : 'close'))
  }
}

class FakePeerConnection extends EventTarget {
  static made: FakePeerConnection[] = []
  /** Whether new connections know their addresses at once, as without any network. */
  static gatherAtOnce = false
  readonly channels: FakeChannel[] = []
  connectionState: RTCPeerConnectionState = 'new'
  iceGatheringState: RTCIceGatheringState = 'new'
  localDescription: RTCSessionDescriptionInit | null = null
  remoteDescription: RTCSessionDescriptionInit | null = null
  closed = false

  constructor(readonly config: RTCConfiguration) {
    super()
    FakePeerConnection.made.push(this)
    if (FakePeerConnection.gatherAtOnce) this.iceGatheringState = 'complete'
  }
  createDataChannel(label: string, options: RTCDataChannelInit) {
    const channel = new FakeChannel(label, options)
    this.channels.push(channel)
    return channel
  }
  async createOffer() {
    return { type: 'offer' as const, sdp: sdp('actpass', 'HOST') }
  }
  async createAnswer() {
    return { type: 'answer' as const, sdp: sdp('active', 'PLAY') }
  }
  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description
    if (this.iceGatheringState !== 'complete') this.iceGatheringState = 'gathering'
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description
  }
  gather() {
    this.iceGatheringState = 'complete'
    this.dispatchEvent(new Event('icegatheringstatechange'))
  }
  set(state: RTCPeerConnectionState) {
    this.connectionState = state
    this.dispatchEvent(new Event('connectionstatechange'))
  }
  close() {
    this.closed = true
    this.connectionState = 'closed'
  }
}

/** The connection made last, once its code waits for its addresses. */
async function made(): Promise<FakePeerConnection> {
  await vi.advanceTimersByTimeAsync(0)
  const pc = FakePeerConnection.made.at(-1)
  if (!pc) throw new Error('no connection')
  return pc
}

beforeEach(() => {
  vi.useFakeTimers()
  FakePeerConnection.made = []
  FakePeerConnection.gatherAtOnce = false
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('createOffer', () => {
  it('opens a reliable control channel and a fast one that never resends, both negotiated', async () => {
    const offering = createOffer()
    const pc = await made()
    pc.gather()
    await offering
    // No servers: on a hotspot there is no internet to reach them.
    expect(pc.config.iceServers).toEqual([])
    expect(pc.channels.map((c) => [c.label, c.options])).toEqual([
      ['control', { negotiated: true, id: 0 }],
      ['fast', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 }],
    ])
  })

  it('waits for every address before making the code', async () => {
    let code: string | undefined
    void createOffer().then((offer) => {
      code = offer.code
    })
    const pc = await made()
    await vi.advanceTimersByTimeAsync(1000)
    expect(code).toBeUndefined()
    pc.gather()
    await vi.advanceTimersByTimeAsync(0)
    expect(read(code as string)).toMatchObject({
      type: 'offer',
      setup: 'actpass',
      ufrag: 'HOST',
      candidates: [{ address: '192.168.43.1', port: 54321 }],
    })
  })

  it('makes the code with what it has after 3 seconds, if gathering never ends', async () => {
    let code: string | undefined
    void createOffer().then((offer) => {
      code = offer.code
    })
    await made()
    await vi.advanceTimersByTimeAsync(2999)
    expect(code).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(read(code as string).type).toBe('offer')
  })

  it('does not wait when the addresses are known already', async () => {
    FakePeerConnection.gatherAtOnce = true
    const { code } = await createOffer()
    expect(read(code).type).toBe('offer')
  })
})

describe('answerOffer and acceptAnswer', () => {
  async function offerCode(): Promise<{ signal: Signal; host: FakePeerConnection }> {
    FakePeerConnection.gatherAtOnce = true
    const { code } = await createOffer()
    return { signal: read(code), host: FakePeerConnection.made.at(-1) as FakePeerConnection }
  }

  it('answer the host’s code, and complete the connection with the player’s', async () => {
    const { signal } = await offerCode()
    const { link, code } = await answerOffer(signal)
    const player = FakePeerConnection.made.at(-1) as FakePeerConnection
    expect(player.remoteDescription?.type).toBe('offer')
    expect(player.remoteDescription?.sdp).toContain('a=ice-ufrag:HOST')
    expect(read(code)).toMatchObject({ type: 'answer', setup: 'active', ufrag: 'PLAY' })
    expect(link.pc).toBe(player)

    const host = await createOffer()
    await acceptAnswer(host.link, read(code))
    const hostPc = host.link.pc as unknown as FakePeerConnection
    expect(hostPc.remoteDescription?.type).toBe('answer')
    expect(hostPc.remoteDescription?.sdp).toContain('a=ice-ufrag:PLAY')
  })

  it('refuse a code of the wrong kind', async () => {
    const { signal } = await offerCode()
    const { link, code } = await answerOffer(signal)
    await expect(answerOffer(read(code))).rejects.toThrow('Not an offer code')
    await expect(acceptAnswer(link, signal)).rejects.toThrow('Not an answer code')
    // A code packed again is the same code.
    expect(pack(read(code))).toBe(code)
  })
})

describe('a link', () => {
  async function opened() {
    FakePeerConnection.gatherAtOnce = true
    const { link } = await createOffer()
    const pc = link.pc as unknown as FakePeerConnection
    const [control, fast] = pc.channels as [FakeChannel, FakeChannel]
    return { link, pc, control, fast }
  }

  it('is open only once both channels are', async () => {
    const { link, control, fast } = await opened()
    const changes = vi.fn()
    link.onStateChange(changes)
    expect(link.state).toBe('connecting')
    control.set('open')
    expect(link.state).toBe('connecting')
    fast.set('open')
    expect(link.state).toBe('open')
    expect(changes).toHaveBeenCalledTimes(2)
  })

  it('is closed when the connection fails or the control channel closes', async () => {
    const a = await opened()
    a.control.set('open')
    a.fast.set('open')
    const changes = vi.fn()
    a.link.onStateChange(changes)
    a.pc.set('failed')
    expect(a.link.state).toBe('closed')
    expect(changes).toHaveBeenCalledOnce()

    const b = await opened()
    b.control.set('open')
    b.fast.set('open')
    b.control.set('closing')
    expect(b.link.state).toBe('closed')

    const c = await opened()
    c.link.close()
    expect(c.pc.closed).toBe(true)
    expect(c.link.state).toBe('closed')
  })
})
