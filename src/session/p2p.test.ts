import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARENA, MAX_PLAYERS, PLAYER_RADIUS } from '../game/sim'
import { decode, MAX_MESSAGE_LENGTH, PROTOCOL, parseSnapshot, parseToGuest } from '../net/protocol'
import { type FakeSide, linkPair } from '../net/testing'
import { GuestSession } from './guest'
import { HostSession } from './host'
import { SILENCE_MS } from './session'

/**
 * The host and players talking over the real protocol, through connections in memory: what
 * the game does between phones, without WebRTC, with time under the test's control.
 */

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

/** A player who joins the host honestly, with the game's own client. */
async function join(host: HostSession, name = 'Guesty', playerToken = token()) {
  const pair = linkPair()
  const attached = host.attach(pair.host.link)
  pair.open()
  const guest = await GuestSession.join(pair.guest.link, name, playerToken)
  const joined = await attached.joined
  return { pair, guest, joined, token: playerToken }
}

/** A connection whose other end is the test itself, sending whatever it likes. */
function rogue(host: HostSession) {
  const pair = linkPair()
  const attached = host.attach(pair.host.link)
  attached.joined.catch(() => {})
  pair.open()
  const raw = (channel: 'control' | 'fast', data: unknown) =>
    pair.guest[channel].send(typeof data === 'string' ? data : JSON.stringify(data))
  const hello = (fields: Record<string, unknown> = {}) =>
    raw('control', { type: 'hello', name: 'Rogue', token: token(), version: PROTOCOL, ...fields })
  return { pair, attached, raw, hello }
}

/** Every message a side received. */
function received(side: FakeSide) {
  return [...(side.control.peer?.sent ?? []), ...(side.fast.peer?.sent ?? [])]
}

function player(host: HostSession, id: number) {
  const found = host.world.players.find((p) => p.id === id)
  if (!found) throw new Error(`No player ${id}`)
  return found
}

describe('joining', () => {
  it('lets a player in, with the host’s name and a new id', async () => {
    const host = new HostSession('Hosty')
    const { guest, joined } = await join(host)
    expect(joined).toEqual({ name: 'Guesty', rejoined: false })
    expect(guest.selfId()).toBe(1)
    expect(guest.host).toBe('Hosty')
    expect(host.world.players.map((p) => p.name)).toEqual(['Hosty', 'Guesty'])
    host.close()
  })

  it('sends the game to the player many times a second', async () => {
    const host = new HostSession('Hosty')
    const { guest, pair } = await join(host)
    await later(1000)
    expect(guest.snapshot()?.players).toHaveLength(2)
    const states = pair.host.fast.sent.filter((m) => m.includes('"state"'))
    expect(states.length).toBeGreaterThan(25)
    // Every snapshot is one the player's own parser accepts.
    for (const message of states) expect(decode(message, parseToGuest)?.type).toBe('state')
    host.close()
  })

  it('moves the player where they steer, on every phone', async () => {
    const host = new HostSession('Hosty')
    const { guest } = await join(host)
    guest.setTarget({ x: 500, y: 200 })
    await later(3000)
    expect(player(host, 1)).toMatchObject({ x: 500, y: 200 })
    expect(guest.snapshot()?.players.find((p) => p.id === 1)).toMatchObject({ x: 500, y: 200 })
    host.close()
  })

  it('measures the round trip and shows it to the host', async () => {
    const host = new HostSession('Hosty')
    await join(host)
    await later(2500)
    // Messages in memory take no time: the ping is measured, and is 0.
    expect(player(host, 1).ping).toBe(0)
    host.close()
  })

  it('refuses a player when the game is full, and says so', async () => {
    const host = new HostSession('Hosty')
    for (let i = 1; i < MAX_PLAYERS; i++) await join(host, `P${i}`)
    const pair = linkPair()
    const attached = host.attach(pair.host.link)
    pair.open()
    const refused = GuestSession.join(pair.guest.link, 'Late', token())
    await expect(refused).rejects.toThrow('full')
    await expect(attached.joined).rejects.toThrow('full')
    expect(host.world.players).toHaveLength(MAX_PLAYERS)
    host.close()
  })

  it('refuses a player with another version of the game, on both phones', async () => {
    const host = new HostSession('Hosty')
    const { attached, hello, pair } = rogue(host)
    hello({ version: PROTOCOL - 1 })
    await expect(attached.joined).rejects.toThrow('version')
    expect(pair.host.control.sent.map((m) => JSON.parse(m))).toEqual([
      { type: 'mismatch', version: PROTOCOL },
    ])
    await later(1000)
    expect(pair.host.pc.connectionState).toBe('closed')
    expect(host.world.players).toHaveLength(1)
    host.close()
  })

  it('leaves a player out whose host runs another version', async () => {
    const pair = linkPair()
    pair.open()
    const joining = GuestSession.join(pair.guest.link, 'Guesty', token())
    joining.catch(() => {})
    pair.host.control.send(
      JSON.stringify({ type: 'welcome', id: 1, host: 'Old', rejoined: false, version: 1 }),
    )
    await expect(joining).rejects.toThrow('version')
  })

  it('gives up on a host that never answers', async () => {
    const pair = linkPair()
    pair.open()
    const joining = GuestSession.join(pair.guest.link, 'Guesty', token())
    joining.catch(() => {})
    await later(10_000)
    await expect(joining).rejects.toThrow('timeout')
  })
})

describe('leaving and rejoining', () => {
  it('drops a player whose connection closes, and keeps their place', async () => {
    const host = new HostSession('Hosty')
    const left: string[] = []
    host.onLeave = (name) => left.push(name)
    const { guest } = await join(host)
    guest.close()
    await later(100)
    expect(left).toEqual(['Guesty'])
    expect(host.snapshot().away).toMatchObject([{ id: 1, name: 'Guesty' }])
    host.close()
  })

  it('drops a player who falls silent, even if the connection seems open', async () => {
    const host = new HostSession('Hosty')
    const left: string[] = []
    host.onLeave = (name) => left.push(name)
    const { pair } = await join(host)
    pair.guest.fast.dropping = true
    await later(SILENCE_MS - 500)
    expect(left).toEqual([])
    await later(1000)
    expect(left).toEqual(['Guesty'])
    host.close()
  })

  it('tells a player when the host falls silent, so they can rejoin', async () => {
    const host = new HostSession('Hosty')
    const { guest, pair } = await join(host)
    const lost = vi.fn()
    guest.onLost = lost
    pair.host.fast.dropping = true
    await later(SILENCE_MS + 500)
    expect(lost).toHaveBeenCalledWith(false)
    host.close()
  })

  it('tells players when the host ends the game, as nothing is left to rejoin', async () => {
    const host = new HostSession('Hosty')
    const { guest } = await join(host)
    const lost = vi.fn()
    guest.onLost = lost
    host.close(true)
    await later(1000)
    expect(lost).toHaveBeenCalledWith(true)
    expect(lost).toHaveBeenCalledOnce()
  })

  it('gives a returning player their id and score back', async () => {
    const host = new HostSession('Hosty')
    const first = await join(host)
    player(host, 1).score = 5
    first.guest.close()
    await later(100)
    const again = await join(host, 'Guesty', first.token)
    expect(again.joined).toEqual({ name: 'Guesty', rejoined: true })
    expect(again.guest.selfId()).toBe(1)
    expect(again.guest.rejoined).toBe(true)
    expect(player(host, 1).score).toBe(5)
    expect(host.snapshot().away).toEqual([])
    host.close()
  })

  it('replaces a connection that has not timed out yet when the same browser comes back', async () => {
    const host = new HostSession('Hosty')
    const first = await join(host)
    const again = await join(host, 'Guesty', first.token)
    expect(again.guest.selfId()).toBe(1)
    expect(first.pair.host.pc.connectionState).toBe('closed')
    expect(host.world.players).toHaveLength(2)
    host.close()
  })
})

describe('a malicious player', () => {
  it('never learns another player’s token', async () => {
    const host = new HostSession('Hosty')
    const honest = await join(host)
    honest.guest.close()
    await later(100)
    const spy = await join(host, 'Spy')
    await later(2000)
    const everything = received(spy.pair.guest).join('\n')
    expect(everything).toContain('Guesty')
    expect(everything).not.toContain(honest.token)
    expect(everything).not.toContain('token')
    host.close()
  })

  it('cannot steer anyone else, whatever ids it sends', async () => {
    const host = new HostSession('Hosty')
    const honest = await join(host)
    honest.guest.setTarget({ x: 100, y: 100 })
    const { raw, hello } = rogue(host)
    hello()
    await later(100)
    const before = { ...player(host, 0) }
    for (const id of [0, 1, -1, '1']) {
      raw('fast', { type: 'input', id, playerId: id, x: 900, y: 900, ping: 1 })
    }
    await later(2000)
    expect(player(host, 0)).toMatchObject({ x: before.x, y: before.y })
    expect(player(host, 1)).toMatchObject({ x: 100, y: 100 })
    expect(player(host, 2)).toMatchObject({ x: 900, y: 900 })
    host.close()
  })

  it('keeps every position finite and in the arena, whatever numbers it sends', async () => {
    const host = new HostSession('Hosty')
    const { raw, hello } = rogue(host)
    hello()
    await later(100)
    for (const data of [
      '{"type":"input","x":1e999,"y":5,"ping":1e999}',
      '{"type":"input","x":-1e999,"y":-1e999,"ping":-5}',
      '{"type":"input","x":1e308,"y":-1e308,"ping":null}',
      '{"type":"input","x":"500","y":[500],"ping":"1"}',
      '{"type":"input","x":-0,"y":5e-324}',
    ]) {
      raw('fast', data)
      await later(500)
      const rogueDot = player(host, 1)
      expect(Number.isFinite(rogueDot.x) && Number.isFinite(rogueDot.y)).toBe(true)
      expect(rogueDot.x).toBeGreaterThanOrEqual(PLAYER_RADIUS)
      expect(rogueDot.x).toBeLessThanOrEqual(ARENA - PLAYER_RADIUS)
      expect(rogueDot.ping === null || (rogueDot.ping >= 0 && rogueDot.ping <= 60_000)).toBe(true)
    }
    host.close()
  })

  it('cannot take a second seat with a second hello on its connection', async () => {
    const host = new HostSession('Hosty')
    const { hello } = rogue(host)
    hello()
    hello({ name: 'Twin' })
    hello({ token: token() })
    await later(100)
    expect(host.world.players.map((p) => p.name)).toEqual(['Hosty', 'Rogue'])
    host.close()
  })

  it('is ignored until it says hello, and on the wrong channel', async () => {
    const host = new HostSession('Hosty')
    const { raw, pair } = rogue(host)
    raw('fast', { type: 'input', x: 1, y: 1, ping: 1 })
    raw('fast', { type: 'hello', name: 'Fast', token: token(), version: PROTOCOL })
    raw('control', { type: 'input', x: 1, y: 1, ping: 1 })
    raw('control', { type: 'ping', sent: 1 })
    await later(500)
    expect(host.world.players).toHaveLength(1)
    expect(pair.host.fast.sent).toEqual([])
    host.close()
  })

  it('cannot make the host echo anything but a number', async () => {
    const host = new HostSession('Hosty')
    const { raw, hello, pair } = rogue(host)
    hello()
    await later(100)
    raw('fast', { type: 'ping', sent: { huge: 'x'.repeat(1000) } })
    raw('fast', { type: 'ping', sent: '<script>' })
    raw('fast', { type: 'ping', sent: 42 })
    await later(100)
    const pongs = pair.host.fast.sent.filter((m) => m.includes('"pong"'))
    expect(pongs).toEqual(['{"type":"pong","sent":42}'])
    host.close()
  })

  it('cannot get oversized messages read', async () => {
    const host = new HostSession('Hosty')
    const { raw } = rogue(host)
    const padding = 'x'.repeat(MAX_MESSAGE_LENGTH)
    raw('control', { type: 'hello', name: 'Big', token: token(), version: PROTOCOL, padding })
    await later(100)
    expect(host.world.players).toHaveLength(1)
    host.close()
  })

  it('shows up under a clean, short name', async () => {
    const host = new HostSession('Hosty')
    const names = [
      ['‮evil‬ name', 'evil name'],
      ['a\u0000b\u0007c\nd\te', 'abc d e'],
      ['zero​width', 'zerowidth'],
      ['   ', '?'],
      ['x'.repeat(100), 'x'.repeat(16)],
      ['😀'.repeat(20), '😀'.repeat(16)],
    ] as const
    for (const [name, shown] of names) {
      const { hello } = rogue(host)
      hello({ name })
      await later(50)
      expect(host.world.players.at(-1)?.name).toBe(shown)
    }
    host.close()
  })

  it('cannot pollute the host’s objects', async () => {
    const host = new HostSession('Hosty')
    const { raw } = rogue(host)
    raw(
      'control',
      `{"type":"hello","name":"Proto","token":"${token()}","version":${PROTOCOL},"__proto__":{"polluted":true}}`,
    )
    raw('fast', '{"type":"input","x":1,"y":1,"constructor":{"prototype":{"polluted":true}}}')
    await later(100)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(host.world.players.map((p) => p.name)).toContain('Proto')
    host.close()
  })
})

describe('a malicious host', () => {
  /** A player who joined a host played by the test. */
  async function joinedTo() {
    const pair = linkPair()
    pair.open()
    const joining = GuestSession.join(pair.guest.link, 'Guesty', token())
    await later(0)
    pair.host.control.send(
      JSON.stringify({ type: 'welcome', id: 3, host: 'Host', rejoined: false, version: PROTOCOL }),
    )
    const guest = await joining
    const raw = (data: unknown) =>
      pair.host.fast.send(typeof data === 'string' ? data : JSON.stringify(data))
    return { guest, pair, raw }
  }

  const sound = {
    phase: 'play',
    timeLeft: 30,
    players: [{ id: 3, name: 'Guesty', x: 100, y: 100, score: 2, ping: 5 }],
    sparks: [{ id: 1, x: 300, y: 300, gold: false }],
    mines: [{ id: 2, x: 600, y: 600, armIn: 0 }],
    blasts: [],
    away: [],
  }

  it('gets only sound snapshots drawn', async () => {
    const { guest, raw } = await joinedTo()
    raw({ type: 'state', state: sound })
    await later(0)
    expect(guest.snapshot()).toEqual(sound)
    for (const state of [
      { ...sound, phase: 'won' },
      { ...sound, timeLeft: Number.POSITIVE_INFINITY },
      { ...sound, players: 'all' },
      { ...sound, players: [{ ...sound.players[0], x: Number.NaN }] },
      { ...sound, players: [{ ...sound.players[0], x: -50 }] },
      { ...sound, players: [{ ...sound.players[0], score: 1.5 }] },
      { ...sound, players: [sound.players[0], sound.players[0]] },
      { ...sound, sparks: Array(1000).fill(sound.sparks[0]) },
      { ...sound, mines: [{ id: 2, x: 600, y: 600 }] },
      { ...sound, blasts: [{ id: 1, x: 1, y: 1, playerId: -1, age: 0 }] },
      null,
    ]) {
      raw({ type: 'state', state })
      await later(0)
      expect(guest.snapshot()).toEqual(sound)
    }
    guest.close()
  })

  it('cannot set a long or tricky host name', async () => {
    const pair = linkPair()
    pair.open()
    const joining = GuestSession.join(pair.guest.link, 'Guesty', token())
    await later(0)
    pair.host.control.send(
      JSON.stringify({
        type: 'welcome',
        id: 0,
        host: `‮${'h'.repeat(500)}`,
        rejoined: 'yes',
        version: PROTOCOL,
      }),
    )
    const guest = await joining
    expect(guest.host).toBe('h'.repeat(16))
    expect(guest.rejoined).toBe(false)
    guest.close()
  })

  it('cannot fake a round trip', async () => {
    const { guest, raw, pair } = await joinedTo()
    raw({ type: 'pong', sent: 'never' })
    raw('{"type":"pong","sent":1e999}')
    await later(100)
    const inputs = pair.guest.fast.sent.filter((m) => m.includes('"input"'))
    const pings = inputs.map((m) => JSON.parse(m).ping)
    expect(pings.every((p) => p === null)).toBe(true)
    guest.close()
  })

  it('cannot end the game for a player on the wrong channel', async () => {
    const { guest, raw } = await joinedTo()
    const lost = vi.fn()
    guest.onLost = lost
    raw({ type: 'bye' })
    raw({ type: 'state', state: sound })
    await later(100)
    expect(lost).not.toHaveBeenCalled()
    guest.close()
  })
})

describe('snapshots', () => {
  it('that the host sends are always sound', async () => {
    const host = new HostSession('Hosty')
    const { pair, guest } = await join(host)
    guest.setTarget({ x: 0, y: 1000 })
    host.start(5)
    await later(6000)
    for (const message of pair.host.fast.sent.filter((m) => m.includes('"state"'))) {
      expect(parseSnapshot(JSON.parse(message).state)).toBeDefined()
    }
    host.close()
  })
})
