import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_MESSAGE_LENGTH } from '../channel.ts'
import { type FakeSide, linkPair } from '../testing.ts'
import { GuestRoom } from './guest.ts'
import { HOST_ID, HostRoom, type LeaveReason, type RoomPlayer } from './host.ts'
import { ROOM_PROTOCOL } from './messages.ts'

/**
 * A host room and player rooms talking over connections in memory, with a tiny game: each
 * player sends a digit, and the host sends back every player's last digit. No WebRTC, and time
 * under the test's control.
 */

type Input = number
type State = { digits: Record<string, number> }
const VERSION = 7
const parseInput = (v: unknown): Input | undefined =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 9 ? (v as number) : undefined
const parseState = (v: unknown): State | undefined =>
  typeof v === 'object' &&
  v !== null &&
  'digits' in v &&
  typeof v.digits === 'object' &&
  v.digits !== null
    ? (v as State)
    : undefined

let tokens = 0
const token = () => `token-${String(++tokens).padStart(8, '0')}`

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const later = (ms: number) => vi.advanceTimersByTimeAsync(ms)

/** A host running the tiny game, with a record of everything that happened. */
function host(
  options: { maxPlayers?: number; restore?: ReturnType<HostRoom<Input, State>['saveSeats']> } = {},
) {
  const room = new HostRoom<Input, State>({
    name: 'Hosty',
    version: VERSION,
    parseInput,
    ...options,
  })
  const digits = new Map<number, number>()
  const joins: [RoomPlayer, boolean][] = []
  const leaves: [RoomPlayer, LeaveReason][] = []
  room.onJoin = (player, rejoined) => joins.push([player, rejoined])
  room.onLeave = (player, reason) => leaves.push([player, reason])
  room.onInput = (player, input) => digits.set(player.id, input)
  room.onTick = () => ({ digits: Object.fromEntries(digits) })
  return { room, digits, joins, leaves }
}

/** A player who joins honestly, with the library's own client. */
async function join(room: HostRoom<Input, State>, name = 'Guesty', playerToken = token()) {
  const pair = linkPair()
  const attached = room.attach(pair.host.link)
  pair.open()
  const guest = await GuestRoom.join<Input, State>(pair.guest.link, {
    name,
    token: playerToken,
    version: VERSION,
    parseState,
  })
  const joined = await attached.joined
  return { pair, guest, joined, token: playerToken }
}

/** A connection whose other end is the test itself, sending whatever it likes. */
function rogue(room: HostRoom<Input, State>) {
  const pair = linkPair()
  const attached = room.attach(pair.host.link)
  attached.joined.catch(() => {})
  pair.open()
  const raw = (channel: 'control' | 'fast', data: unknown) =>
    pair.guest[channel].send(typeof data === 'string' ? data : JSON.stringify(data))
  const hello = (fields: Record<string, unknown> = {}) =>
    raw('control', {
      type: 'hello',
      name: 'Rogue',
      token: token(),
      room: ROOM_PROTOCOL,
      version: VERSION,
      ...fields,
    })
  return { pair, attached, raw, hello }
}

function received(side: FakeSide): string[] {
  return [...(side.control.peer?.sent ?? []), ...(side.fast.peer?.sent ?? [])]
}

describe('joining', () => {
  it('lets a player in, with the host’s name and a new id', async () => {
    const h = host()
    const { guest, joined } = await join(h.room)
    expect(joined).toEqual({ player: { id: 1, name: 'Guesty', ping: null }, rejoined: false })
    expect(guest).toMatchObject({ id: 1, host: 'Hosty', rejoined: false })
    expect(h.joins).toEqual([[{ id: 1, name: 'Guesty', ping: null }, false]])
    expect(h.room.players()).toEqual([{ id: 1, name: 'Guesty', ping: null }])
    h.room.close()
  })

  it('carries input to the host and state back, many times a second', async () => {
    const h = host()
    const { guest, pair } = await join(h.room)
    const states: State[] = []
    guest.onState = (state) => states.push(state)
    guest.setInput(5)
    await later(1000)
    expect(h.digits.get(1)).toBe(5)
    expect(guest.state()).toEqual({ digits: { 1: 5 } })
    expect(states.length).toBeGreaterThan(25)
    expect(pair.guest.fast.sent.filter((m) => m.includes('"input"')).length).toBeGreaterThan(25)
    h.room.close()
  })

  it('sends no input before the game sets one', async () => {
    const h = host()
    const { pair } = await join(h.room)
    await later(500)
    expect(pair.guest.fast.sent.filter((m) => m.includes('"input"'))).toEqual([])
    h.room.close()
  })

  it('measures the round trip, and the host sees it', async () => {
    const h = host()
    const { guest } = await join(h.room)
    guest.setInput(1)
    await later(2500)
    // Messages in memory take no time: the ping is measured, and is 0.
    expect(guest.ping()).toBe(0)
    expect(h.room.players()[0]?.ping).toBe(0)
    h.room.close()
  })

  it('refuses a player when the room is full, and says so', async () => {
    const h = host({ maxPlayers: 3 })
    await join(h.room, 'A')
    await join(h.room, 'B')
    const pair = linkPair()
    const attached = h.room.attach(pair.host.link)
    pair.open()
    const refused = GuestRoom.join(pair.guest.link, {
      name: 'C',
      token: token(),
      version: VERSION,
      parseState,
    })
    await expect(refused).rejects.toThrow('full')
    await expect(attached.joined).rejects.toThrow('full')
    expect(h.room.players()).toHaveLength(2)
    h.room.close()
  })

  it('refuses a player with another version of the game or the room, on both phones', async () => {
    for (const fields of [
      { version: VERSION - 1 },
      { room: ROOM_PROTOCOL + 1 },
      { version: 'x' },
    ]) {
      const h = host()
      const { attached, hello, pair } = rogue(h.room)
      hello(fields)
      await expect(attached.joined).rejects.toThrow('version')
      expect(pair.host.control.sent.map((m) => JSON.parse(m))).toEqual([
        { type: 'mismatch', room: ROOM_PROTOCOL, version: VERSION },
      ])
      await later(1000)
      expect(pair.host.pc.connectionState).toBe('closed')
      h.room.close()
    }
  })

  it('leaves a player out whose host runs another version', async () => {
    for (const welcome of [
      { type: 'welcome', id: 1, host: 'Old', rejoined: false, room: ROOM_PROTOCOL, version: 1 },
      { type: 'welcome', id: 1, host: 'Old', rejoined: false, version: VERSION },
      { type: 'mismatch', room: ROOM_PROTOCOL, version: 1 },
    ]) {
      const pair = linkPair()
      pair.open()
      const joining = GuestRoom.join(pair.guest.link, {
        name: 'G',
        token: token(),
        version: VERSION,
        parseState,
      })
      joining.catch(() => {})
      pair.host.control.send(JSON.stringify(welcome))
      await expect(joining).rejects.toThrow('version')
    }
  })

  it('gives up on a host that never answers', async () => {
    const pair = linkPair()
    pair.open()
    const joining = GuestRoom.join(pair.guest.link, {
      name: 'G',
      token: token(),
      version: VERSION,
      parseState,
    })
    joining.catch(() => {})
    await later(10_000)
    await expect(joining).rejects.toThrow('timeout')
  })

  it('makes invitations that can be cancelled before anyone joins', async () => {
    const h = host()
    const pair = linkPair()
    const attached = h.room.attach(pair.host.link)
    attached.cancel()
    expect(pair.host.pc.connectionState).toBe('closed')
    h.room.close()
  })
})

describe('leaving and rejoining', () => {
  it('drops a player whose connection closes, and keeps their place', async () => {
    const h = host()
    const { guest } = await join(h.room)
    guest.close()
    await later(100)
    expect(h.leaves).toEqual([[{ id: 1, name: 'Guesty', ping: null }, 'lost']])
    expect(h.room.awaySeats()).toMatchObject([{ id: 1, name: 'Guesty' }])
    h.room.close()
  })

  it('drops a player who falls silent, even if the connection seems open', async () => {
    const h = host()
    const { pair } = await join(h.room)
    pair.guest.fast.dropping = true
    await later(7500)
    expect(h.leaves).toEqual([])
    await later(1000)
    expect(h.leaves.map(([, reason]) => reason)).toEqual(['lost'])
    h.room.close()
  })

  it('tells a player when the host falls silent, so they can rejoin', async () => {
    const h = host()
    const { guest, pair } = await join(h.room)
    const lost = vi.fn()
    guest.onLost = lost
    pair.host.fast.dropping = true
    await later(8500)
    expect(lost).toHaveBeenCalledWith(false)
    h.room.close()
  })

  it('tells players when the host ends the game, as nothing is left to rejoin', async () => {
    const h = host()
    const { guest } = await join(h.room)
    const lost = vi.fn()
    guest.onLost = lost
    h.room.close(true)
    await later(1000)
    expect(lost).toHaveBeenCalledWith(true)
    expect(lost).toHaveBeenCalledOnce()
  })

  it('closes quietly when the host’s page goes, so players may rejoin later', async () => {
    const h = host()
    const { guest } = await join(h.room)
    const lost = vi.fn()
    guest.onLost = lost
    h.room.close(false)
    await later(1000)
    expect(lost).toHaveBeenCalledWith(false)
  })

  it('gives a returning player their id back', async () => {
    const h = host()
    const first = await join(h.room)
    first.guest.close()
    await later(100)
    const again = await join(h.room, 'Guesty', first.token)
    expect(again.joined.rejoined).toBe(true)
    expect(again.guest).toMatchObject({ id: 1, rejoined: true })
    expect(h.room.awaySeats()).toEqual([])
    h.room.close()
  })

  it('replaces a connection that has not timed out yet when the same browser comes back', async () => {
    const h = host()
    const first = await join(h.room)
    const again = await join(h.room, 'Guesty', first.token)
    expect(again.guest.id).toBe(1)
    expect(h.leaves.map(([, reason]) => reason)).toEqual(['replaced'])
    expect(first.pair.host.pc.connectionState).toBe('closed')
    expect(h.room.players()).toHaveLength(1)
    h.room.close()
  })

  it('saves its seats, and a new room takes the same players back', async () => {
    const h = host()
    const a = await join(h.room, 'Ada')
    const b = await join(h.room, 'Bo')
    b.guest.close()
    await later(100)
    const saved = h.room.saveSeats()
    expect(saved).toEqual({
      nextId: 3,
      seats: [
        { token: a.token, id: 1, name: 'Ada' },
        { token: b.token, id: 2, name: 'Bo' },
      ],
    })
    h.room.close(false)
    const again = host({ restore: saved })
    expect(again.room.awaySeats().map((s) => s.name)).toEqual(['Ada', 'Bo'])
    const back = await join(again.room, 'Bo', b.token)
    expect(back.guest).toMatchObject({ id: 2, rejoined: true })
    expect((await join(again.room, 'New')).guest.id).toBe(3)
    again.room.close()
  })
})

describe('a malicious player', () => {
  it('never learns another player’s token', async () => {
    const h = host()
    const honest = await join(h.room)
    honest.guest.close()
    await later(100)
    const spy = await join(h.room, 'Spy')
    await later(2000)
    const everything = received(spy.pair.guest).join('\n')
    expect(everything).not.toContain(honest.token)
    expect(everything).not.toContain('token')
    h.room.close()
  })

  it('only ever sends input for itself, whatever ids it names', async () => {
    const h = host()
    const honest = await join(h.room)
    honest.guest.setInput(3)
    const { raw, hello } = rogue(h.room)
    hello()
    await later(100)
    for (const id of [0, 1, -1, '1'])
      raw('fast', { type: 'input', id, playerId: id, data: 9, ping: 1 })
    await later(500)
    expect(h.digits.get(HOST_ID)).toBeUndefined()
    expect(h.digits.get(1)).toBe(3)
    expect(h.digits.get(2)).toBe(9)
    h.room.close()
  })

  it('gets no input past the game’s parser', async () => {
    const h = host()
    const { raw, hello } = rogue(h.room)
    hello()
    await later(100)
    for (const data of [10, -1, 1.5, '5', null, [5], { n: 5 }])
      raw('fast', { type: 'input', data, ping: 1 })
    raw('fast', '{"type":"input","data":1e999,"ping":1e999}')
    await later(500)
    expect(h.digits.size).toBe(0)
    h.room.close()
  })

  it('cannot fake its ping', async () => {
    const h = host()
    const { raw, hello } = rogue(h.room)
    hello()
    await later(100)
    for (const ping of [-5, 1e9, '7', null]) {
      raw('fast', { type: 'input', data: 1, ping })
      await later(50)
      expect(h.room.players()[0]?.ping).toBeNull()
    }
    h.room.close()
  })

  it('cannot take a second seat with a second hello on its connection', async () => {
    const h = host()
    const { hello } = rogue(h.room)
    hello()
    hello({ name: 'Twin' })
    hello({ token: token() })
    await later(100)
    expect(h.room.players().map((p) => p.name)).toEqual(['Rogue'])
    h.room.close()
  })

  it('is ignored until it says hello, and on the wrong channel', async () => {
    const h = host()
    const { raw, pair } = rogue(h.room)
    raw('fast', { type: 'input', data: 1, ping: 1 })
    raw('fast', {
      type: 'hello',
      name: 'Fast',
      token: token(),
      room: ROOM_PROTOCOL,
      version: VERSION,
    })
    raw('control', { type: 'input', data: 1, ping: 1 })
    raw('control', { type: 'ping', sent: 1 })
    await later(500)
    expect(h.room.players()).toEqual([])
    expect(pair.host.fast.sent).toEqual([])
    h.room.close()
  })

  it('cannot make the host echo anything but a number', async () => {
    const h = host()
    const { raw, hello, pair } = rogue(h.room)
    hello()
    await later(100)
    raw('fast', { type: 'ping', sent: { huge: 'x'.repeat(1000) } })
    raw('fast', { type: 'ping', sent: '<script>' })
    raw('fast', { type: 'ping', sent: 42 })
    await later(100)
    expect(pair.host.fast.sent.filter((m) => m.includes('"pong"'))).toEqual([
      '{"type":"pong","sent":42}',
    ])
    h.room.close()
  })

  it('cannot get oversized messages read', async () => {
    const h = host()
    const { hello } = rogue(h.room)
    hello({ padding: 'x'.repeat(MAX_MESSAGE_LENGTH) })
    await later(100)
    expect(h.room.players()).toEqual([])
    h.room.close()
  })

  it('shows up under a clean, short name', async () => {
    const h = host()
    const { hello } = rogue(h.room)
    hello({ name: `‮${'x'.repeat(100)}\n` })
    await later(50)
    expect(h.room.players()[0]?.name).toBe('x'.repeat(16))
    h.room.close()
  })

  it('cannot pollute the host’s objects', async () => {
    const h = host()
    const { raw } = rogue(h.room)
    raw(
      'control',
      `{"type":"hello","name":"Proto","token":"${token()}","room":${ROOM_PROTOCOL},"version":${VERSION},"__proto__":{"polluted":true}}`,
    )
    raw('fast', '{"type":"input","data":1,"constructor":{"prototype":{"polluted":true}}}')
    await later(100)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(h.room.players().map((p) => p.name)).toEqual(['Proto'])
    h.room.close()
  })
})

describe('a malicious host', () => {
  async function joinedTo() {
    const pair = linkPair()
    pair.open()
    const joining = GuestRoom.join<Input, State>(pair.guest.link, {
      name: 'G',
      token: token(),
      version: VERSION,
      parseState,
    })
    await later(0)
    pair.host.control.send(
      JSON.stringify({
        type: 'welcome',
        id: 3,
        host: 'Host',
        rejoined: false,
        room: ROOM_PROTOCOL,
        version: VERSION,
      }),
    )
    const guest = await joining
    const raw = (data: unknown) =>
      pair.host.fast.send(typeof data === 'string' ? data : JSON.stringify(data))
    return { guest, pair, raw }
  }

  it('gets only states past the game’s parser', async () => {
    const { guest, raw } = await joinedTo()
    raw({ type: 'state', data: { digits: { 3: 1 } } })
    await later(0)
    for (const data of [null, 5, 'x', []]) raw({ type: 'state', data })
    raw({ type: 'state' })
    await later(0)
    expect(guest.state()).toEqual({ digits: { 3: 1 } })
    guest.close()
  })

  it('cannot set a long or tricky host name, nor fake a rejoin', async () => {
    const pair = linkPair()
    pair.open()
    const joining = GuestRoom.join(pair.guest.link, {
      name: 'G',
      token: token(),
      version: VERSION,
      parseState,
    })
    await later(0)
    pair.host.control.send(
      JSON.stringify({
        type: 'welcome',
        id: 0,
        host: `‮${'h'.repeat(500)}`,
        rejoined: 'yes',
        room: ROOM_PROTOCOL,
        version: VERSION,
      }),
    )
    const guest = await joining
    expect(guest.host).toBe('h'.repeat(16))
    expect(guest.rejoined).toBe(false)
    guest.close()
  })

  it('cannot fake a round trip', async () => {
    const { guest, raw } = await joinedTo()
    raw({ type: 'pong', sent: 'never' })
    raw('{"type":"pong","sent":1e999}')
    await later(100)
    expect(guest.ping()).toBeNull()
    guest.close()
  })

  it('cannot end the game for a player on the wrong channel', async () => {
    const { guest, raw } = await joinedTo()
    const lost = vi.fn()
    guest.onLost = lost
    raw({ type: 'bye' })
    raw({ type: 'state', data: { digits: {} } })
    await later(100)
    expect(lost).not.toHaveBeenCalled()
    guest.close()
  })
})
