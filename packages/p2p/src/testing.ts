import type { Link } from './link.ts'

/**
 * Two phones connected in memory, for tests: what one side sends on a channel arrives on the
 * other side's channel of the same name, a moment later, as over WebRTC. No browser needed,
 * so the host and players can be tested in Node, with fake timers.
 */
export class FakeChannel extends EventTarget {
  readyState: RTCDataChannelState = 'connecting'
  peer: FakeChannel | undefined
  /** Every message this side sent, as the other side received it. */
  readonly sent: string[] = []
  /** While true, sent messages are lost on the way, as on a broken Wi-Fi. */
  dropping = false

  send(data: string): void {
    if (this.readyState !== 'open') throw new Error(`send on a ${this.readyState} channel`)
    if (typeof data !== 'string') throw new Error('only strings are sent')
    this.sent.push(data)
    const peer = this.peer
    if (this.dropping || !peer) return
    queueMicrotask(() => {
      if (peer.readyState === 'open') peer.dispatchEvent(new MessageEvent('message', { data }))
    })
  }

  open(): void {
    this.readyState = 'open'
    this.dispatchEvent(new Event('open'))
  }

  close(): void {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    this.dispatchEvent(new Event('close'))
    this.peer?.close()
  }
}

export class FakePeerConnection extends EventTarget {
  connectionState: RTCPeerConnectionState = 'new'
  readonly channels: FakeChannel[] = []
  peer: FakePeerConnection | undefined

  close(): void {
    if (this.connectionState === 'closed') return
    this.connectionState = 'closed'
    this.dispatchEvent(new Event('connectionstatechange'))
    for (const channel of this.channels) channel.close()
    this.peer?.fail()
  }

  /** The other side is gone: WebRTC notices after a while and reports a failed connection. */
  fail(): void {
    if (this.connectionState === 'closed' || this.connectionState === 'failed') return
    this.connectionState = 'failed'
    this.dispatchEvent(new Event('connectionstatechange'))
  }

  connect(): void {
    this.connectionState = 'connected'
    this.dispatchEvent(new Event('connectionstatechange'))
  }
}

export interface FakeSide {
  readonly link: Link
  readonly pc: FakePeerConnection
  readonly control: FakeChannel
  readonly fast: FakeChannel
}

/** A connection between a host and a player; `open` connects it, as scanning both codes does. */
export function linkPair(): { host: FakeSide; guest: FakeSide; open(): void } {
  const host = side()
  const guest = side()
  host.pc.peer = guest.pc
  guest.pc.peer = host.pc
  host.control.peer = guest.control
  guest.control.peer = host.control
  host.fast.peer = guest.fast
  guest.fast.peer = host.fast
  return {
    host,
    guest,
    open() {
      for (const s of [host, guest]) {
        s.pc.connect()
        s.control.open()
        s.fast.open()
      }
    },
  }
}

function side(): FakeSide {
  const pc = new FakePeerConnection()
  const control = new FakeChannel()
  const fast = new FakeChannel()
  pc.channels.push(control, fast)
  const link = { pc, control, fast } as unknown as Link
  return { link, pc, control, fast }
}
