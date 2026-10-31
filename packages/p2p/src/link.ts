import type { Connection, ConnectionState } from './connection.ts'
import { fromSdp, pack, type Signal, toSdp } from './signal.ts'

/**
 * One WebRTC connection between two phones, as a `Connection`, with two data channels:
 * - `control`, reliable and ordered, for messages that must arrive, such as a player's name;
 * - `fast`, unordered and never resent, like plain UDP, for game state and input, where only
 *   the newest message counts and a lost one is better skipped than waited for.
 *
 * Both channels are negotiated up front with fixed ids, so the offer already contains them and
 * no further signaling is needed once the codes have been scanned.
 */
export interface Link extends Connection {
  readonly pc: RTCPeerConnection
  readonly control: RTCDataChannel
  readonly fast: RTCDataChannel
}

class RtcLink implements Link {
  readonly control: RTCDataChannel
  readonly fast: RTCDataChannel

  constructor(readonly pc: RTCPeerConnection) {
    this.control = pc.createDataChannel('control', { negotiated: true, id: 0 })
    this.fast = pc.createDataChannel('fast', {
      negotiated: true,
      id: 1,
      ordered: false,
      maxRetransmits: 0,
    })
  }

  get state(): ConnectionState {
    const pc = this.pc.connectionState
    if (pc === 'failed' || pc === 'closed') return 'closed'
    if (this.control.readyState === 'closing' || this.control.readyState === 'closed')
      return 'closed'
    return this.control.readyState === 'open' && this.fast.readyState === 'open'
      ? 'open'
      : 'connecting'
  }

  onStateChange(listener: () => void): void {
    this.pc.addEventListener('connectionstatechange', listener)
    for (const channel of [this.control, this.fast]) {
      channel.addEventListener('open', listener)
      channel.addEventListener('close', listener)
    }
  }

  close(): void {
    this.pc.close()
  }
}

/** No STUN or TURN servers: on a hotspot without internet, there are none to reach. */
const CONFIG: RTCConfiguration = { iceServers: [] }
/** Gathering local addresses takes milliseconds without servers; this is a safety net. */
const GATHER_TIMEOUT_MS = 3000

function openLink(): Link {
  return new RtcLink(new RTCPeerConnection(CONFIG))
}

/** Waits until the connection knows all its local addresses, as a code carries them all at once. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve()
    const timer = setTimeout(done, GATHER_TIMEOUT_MS)
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') done()
    })
    function done() {
      clearTimeout(timer)
      resolve()
    }
  })
}

async function localCode(link: Link, type: 'offer' | 'answer'): Promise<string> {
  const description = type === 'offer' ? await link.pc.createOffer() : await link.pc.createAnswer()
  await link.pc.setLocalDescription(description)
  await gathered(link.pc)
  const sdp = link.pc.localDescription?.sdp
  if (!sdp) throw new Error('No local description')
  return pack(fromSdp(type, sdp))
}

/** The host's side, step 1: a new connection and the offer code for one player to scan. */
export async function createOffer(): Promise<{ link: Link; code: string }> {
  const link = openLink()
  return { link, code: await localCode(link, 'offer') }
}

/** The host's side, step 2: the player's answer code completes the connection. */
export async function acceptAnswer(link: Link, answer: Signal): Promise<void> {
  if (answer.type !== 'answer') throw new Error('Not an answer code')
  await link.pc.setRemoteDescription({ type: 'answer', sdp: toSdp(answer) })
}

/** The player's side: takes the host's offer code and makes the answer code to show back. */
export async function answerOffer(offer: Signal): Promise<{ link: Link; code: string }> {
  if (offer.type !== 'offer') throw new Error('Not an offer code')
  const link = openLink()
  await link.pc.setRemoteDescription({ type: 'offer', sdp: toSdp(offer) })
  return { link, code: await localCode(link, 'answer') }
}
