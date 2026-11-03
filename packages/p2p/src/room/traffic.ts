import type { Channel } from '../channel.ts'

/**
 * What went over a connection since a room took it on, both channels together: messages and
 * their length in characters, which for the JSON the rooms send is their size in bytes. A game
 * reads it now and then to show how well the connection keeps up (see `GuestRoom.traffic` and
 * `HostRoom.traffic`).
 */
export interface Traffic {
  readonly sent: number
  readonly sentChars: number
  /** Everything that arrived, also messages dropped as malformed. */
  readonly received: number
  readonly receivedChars: number
}

/**
 * A player's traffic, with the pings sent to the host, the answers that came back, and the
 * pings taken for lost (see `PING_LOST_MS`). Pings neither answered nor lost are on the way.
 */
export interface GuestTraffic extends Traffic {
  readonly pings: number
  readonly pongs: number
  readonly lostPings: number
}

/** Counts a connection's traffic. */
export class TrafficCounter {
  private sent = 0
  private sentChars = 0
  private received = 0
  private receivedChars = 0

  /** Counts what arrives on these channels from now on, and calls back with every message. */
  watch(channels: readonly Channel[], arrived: () => void = () => {}): void {
    for (const channel of channels) {
      channel.addEventListener('message', (event) => {
        this.received++
        this.receivedChars += typeof event.data === 'string' ? event.data.length : 0
        arrived()
      })
    }
  }

  /** Counts a message sent, given its length as `send` returns it: 0 for nothing sent. */
  out(chars: number): number {
    if (chars > 0) {
      this.sent++
      this.sentChars += chars
    }
    return chars
  }

  read(): Traffic {
    return {
      sent: this.sent,
      sentChars: this.sentChars,
      received: this.received,
      receivedChars: this.receivedChars,
    }
  }
}
