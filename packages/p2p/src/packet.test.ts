import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_MESSAGE_LENGTH } from './channel.ts'
import { onLost, opened } from './connection.ts'
import { type ChannelName, type PacketConnection, packetConnection } from './packet.ts'
import { GuestRoom } from './room/guest.ts'
import { HostRoom } from './room/host.ts'

/**
 * Packet connections, as a Bluetooth link makes them: tested on their own, and with a host room
 * and a player room talking over a pair of them.
 */

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

/** A transport that records what it sends. */
function recording(options: { minStateIntervalMs?: number } = {}) {
  const sent: [ChannelName, string][] = []
  const transport = {
    send: vi.fn((c: ChannelName, d: string) => sent.push([c, d])),
    close: vi.fn(),
  }
  return { connection: packetConnection(transport, options), transport, sent }
}

/** Two packet connections whose transports hand each message to the other, a moment later. */
function packetPair(options: { minStateIntervalMs?: number } = {}) {
  let host: PacketConnection
  let guest: PacketConnection
  const to = (other: () => PacketConnection) => ({
    send: (channel: ChannelName, data: string) =>
      queueMicrotask(() => other().receive(channel, data)),
    close: () => queueMicrotask(() => other().markClosed()),
  })
  host = packetConnection(
    to(() => guest),
    options,
  )
  guest = packetConnection(to(() => host))
  return {
    host,
    guest,
    open() {
      host.markOpen()
      guest.markOpen()
    },
  }
}

function messages(connection: PacketConnection) {
  const got: [string, unknown][] = []
  connection.control.addEventListener('message', (e) => got.push(['control', e.data]))
  connection.fast.addEventListener('message', (e) => got.push(['fast', e.data]))
  return got
}

describe('packetConnection', () => {
  it('opens its channels with the transport, and sends on the right one', () => {
    const { connection, sent } = recording()
    expect(connection.control.readyState).toBe('connecting')
    expect(() => connection.control.send('x')).toThrow()
    connection.markOpen()
    expect(connection.state).toBe('open')
    connection.control.send('a')
    connection.fast.send('b')
    expect(sent).toEqual([
      ['control', 'a'],
      ['fast', 'b'],
    ])
  })

  it('hands on only short text on a known channel, while open', () => {
    const { connection } = recording()
    const got = messages(connection)
    connection.receive('control', 'too early')
    connection.markOpen()
    connection.receive('control', 'one')
    connection.receive('fast', 'two')
    for (const [channel, data] of [
      ['other', 'x'],
      ['__proto__', 'x'],
      [null, 'x'],
      ['control', 42],
      ['control', { data: 'x' }],
      ['control', 'x'.repeat(MAX_MESSAGE_LENGTH + 1)],
    ] as const) {
      connection.receive(channel, data)
    }
    connection.markClosed()
    connection.receive('control', 'too late')
    expect(got).toEqual([
      ['control', 'one'],
      ['fast', 'two'],
    ])
  })

  it('closes for good, once, and closes its transport when it is closed itself', () => {
    const { connection, transport } = recording()
    const changes = vi.fn()
    connection.onStateChange(changes)
    connection.markOpen()
    connection.close()
    connection.close()
    connection.markClosed()
    connection.markOpen()
    expect(connection.state).toBe('closed')
    expect(connection.control.readyState).toBe('closed')
    expect(transport.close).toHaveBeenCalledOnce()
    expect(changes).toHaveBeenCalledTimes(2)
  })

  it('does not close its transport when the transport closed first', () => {
    const { connection, transport } = recording()
    connection.markOpen()
    connection.markClosed()
    connection.close()
    expect(transport.close).not.toHaveBeenCalled()
  })

  it('tells opened and onLost what happens', async () => {
    const first = recording().connection
    const opening = opened(first)
    first.markOpen()
    await expect(opening).resolves.toBeUndefined()
    const lost = vi.fn()
    onLost(first, lost)
    first.markClosed()
    first.markClosed()
    expect(lost).toHaveBeenCalledOnce()

    const failing = recording().connection
    const never = opened(failing)
    failing.markClosed()
    await expect(never).rejects.toThrow('failed')

    const slow = opened(recording().connection, 1000)
    vi.advanceTimersByTime(1000)
    await expect(slow).rejects.toThrow('timed out')
  })

  it('keeps every promise whatever the transport does, in any order', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.constant({ kind: 'open' as const }),
            fc.constant({ kind: 'closed' as const }),
            fc.constant({ kind: 'close' as const }),
            fc.record({
              kind: fc.constant('receive' as const),
              channel: fc.anything(),
              data: fc.anything(),
            }),
          ),
          { maxLength: 40 },
        ),
        (events) => {
          const { connection, transport } = recording()
          const got = messages(connection)
          let wasClosed = false
          for (const event of events) {
            const before = connection.state
            if (event.kind === 'open') connection.markOpen()
            else if (event.kind === 'closed') connection.markClosed()
            else if (event.kind === 'close') connection.close()
            else connection.receive(event.channel, event.data)
            // Closed is for good; open comes only from connecting.
            if (wasClosed) expect(connection.state).toBe('closed')
            if (connection.state === 'open')
              expect(before === 'open' || before === 'connecting').toBe(true)
            wasClosed ||= connection.state === 'closed'
          }
          for (const [, data] of got) {
            expect(typeof data === 'string' && data.length <= MAX_MESSAGE_LENGTH).toBe(true)
          }
          expect(transport.close.mock.calls.length).toBeLessThanOrEqual(1)
        },
      ),
      { numRuns: 1000 },
    )
  })
})

describe('rooms over packet connections', () => {
  type State = { n: number }
  const parseInput = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined)
  const parseState = (v: unknown) =>
    typeof v === 'object' && v !== null && typeof (v as State).n === 'number'
      ? (v as State)
      : undefined

  async function game(minStateIntervalMs?: number) {
    const room = new HostRoom<number, State>({ name: 'Hosty', version: 1, parseInput })
    let n = 0
    room.onTick = () => ({ n: ++n })
    const inputs: number[] = []
    room.onInput = (_, input) => inputs.push(input)
    const pair = packetPair({ minStateIntervalMs })
    const attached = room.attach(pair.host)
    pair.open()
    const guest = await GuestRoom.join<number, State>(pair.guest, {
      name: 'Bo',
      token: 'token-00000001',
      version: 1,
      parseState,
    })
    await attached.joined
    const states: State[] = []
    guest.onState = (state) => states.push(state)
    return { room, guest, pair, inputs, states }
  }

  it('play as over WebRTC: hello, input, state, goodbye', async () => {
    const { room, guest, inputs, states } = await game()
    guest.setInput(3)
    await vi.advanceTimersByTimeAsync(1000)
    expect(inputs.length).toBeGreaterThan(25)
    expect(new Set(inputs)).toEqual(new Set([3]))
    expect(states.length).toBeGreaterThan(25)
    const lost = vi.fn()
    guest.onLost = lost
    room.close(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(lost).toHaveBeenCalledWith(true)
  })

  it('send a slow connection fewer states, and only that one', async () => {
    const slow = await game(100)
    const quick = await game()
    await vi.advanceTimersByTimeAsync(1000)
    expect(slow.states.length).toBeGreaterThanOrEqual(9)
    expect(slow.states.length).toBeLessThanOrEqual(11)
    expect(quick.states.length).toBeGreaterThan(25)
    slow.room.close()
    quick.room.close()
  })

  it('drop a player whose transport goes', async () => {
    const { room, pair } = await game()
    const left = vi.fn()
    room.onLeave = left
    pair.guest.markClosed()
    pair.host.markClosed()
    await vi.advanceTimersByTimeAsync(100)
    expect(left).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bo' }), 'lost')
    room.close()
  })
})
