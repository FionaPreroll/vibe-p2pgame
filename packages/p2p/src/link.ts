import { fromSdp, pack, type Signal, toSdp } from './signal.ts'

/**
 * One WebRTC connection between two phones, with two data channels:
 * - `control`, reliable and ordered, for messages that must arrive, such as a player's name;
 * - `fast`, unordered and never resent, like plain UDP, for game state and input, where only
 *   the newest message counts and a lost one is better skipped than waited for.
 *
 * Both channels are negotiated up front with fixed ids, so the offer already contains them and
 * no further signaling is needed once the codes have been scanned.
 */
export interface Link {
  readonly pc: RTCPeerConnection
  readonly control: RTCDataChannel
  readonly fast: RTCDataChannel
}

/** No STUN or TURN servers: on a hotspot without internet, there are none to reach. */
const CONFIG: RTCConfiguration = { iceServers: [] }
/** Gathering local addresses takes milliseconds without servers; this is a safety net. */
const GATHER_TIMEOUT_MS = 3000

function openLink(): Link {
  const pc = new RTCPeerConnection(CONFIG)
  return {
    pc,
    control: pc.createDataChannel('control', { negotiated: true, id: 0 }),
    fast: pc.createDataChannel('fast', {
      negotiated: true,
      id: 1,
      ordered: false,
      maxRetransmits: 0,
    }),
  }
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

/** Resolves once both channels are open, and rejects if the connection fails first. */
export function opened(link: Link, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error('Connection timed out')), timeoutMs)
    const check = () => {
      if (link.control.readyState === 'open' && link.fast.readyState === 'open') {
        clearTimeout(timer)
        resolve()
      }
    }
    function fail(error: Error) {
      clearTimeout(timer)
      reject(error)
    }
    link.control.addEventListener('open', check)
    link.fast.addEventListener('open', check)
    link.pc.addEventListener('connectionstatechange', () => {
      if (link.pc.connectionState === 'failed') fail(new Error('Connection failed'))
    })
    check()
  })
}

/** Calls back once when the other phone is gone: closed, failed or out of reach. */
export function onLost(link: Link, callback: () => void): void {
  let lost = false
  const lose = () => {
    if (lost) return
    lost = true
    callback()
  }
  link.control.addEventListener('close', lose)
  link.pc.addEventListener('connectionstatechange', () => {
    const state = link.pc.connectionState
    if (state === 'failed' || state === 'closed') lose()
  })
}
