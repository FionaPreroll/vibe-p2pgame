import { ROOM_PROTOCOL } from '@fionapreroll/p2p/room'
import { linkPair } from '@fionapreroll/p2p/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARENA, MAX_PLAYERS, PLAYER_RADIUS } from '../game/sim'
import { latestNet } from '../net/netlog'
import { PROTOCOL, parseSnapshot } from '../net/protocol'
import { ANSWER_WAIT_MS, GuestSession } from './guest'
import { HostSession } from './host'

/**
 * Spark Hunt's host and players over the room of `@fionapreroll/p2p`, through connections in
 * memory. The room's own behaviour is tested in the library; this is what the game adds:
 * steering, scores kept for players away, and its checks of input and snapshots.
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

async function join(host: HostSession, name = 'Guesty', playerToken = token()) {
  const pair = linkPair()
  const attached = host.attach(pair.host.link)
  pair.open()
  const guest = await GuestSession.join(pair.guest.link, name, playerToken)
  const joined = await attached.joined
  return { pair, guest, joined, token: playerToken }
}

function rogue(host: HostSession) {
  const pair = linkPair()
  host.attach(pair.host.link).joined.catch(() => {})
  pair.open()
  const raw = (channel: 'control' | 'fast', data: unknown) =>
    pair.guest[channel].send(typeof data === 'string' ? data : JSON.stringify(data))
  const hello = (fields: Record<string, unknown> = {}) =>
    raw('control', {
      type: 'hello',
      name: 'Rogue',
      token: token(),
      room: ROOM_PROTOCOL,
      version: PROTOCOL,
      ...fields,
    })
  return { pair, raw, hello }
}

function player(host: HostSession, id: number) {
  const found = host.world.players.find((p) => p.id === id)
  if (!found) throw new Error(`No player ${id}`)
  return found
}

describe('Spark Hunt between phones', () => {
  it('keeps the room’s samples, details and connection tests for the screens and the report', async () => {
    const host = new HostSession('Hosty')
    const { guest } = await join(host)
    expect(latestNet()).toBe(guest)
    const results: unknown[] = []
    let started = 0
    guest.onTestStart = () => started++
    guest.onTestResult = (result) => results.push(result)
    await later(3000)
    expect(host.net.peerIds()).toEqual([1])
    expect(guest.net.peerIds()).toEqual([0])
    expect(host.peers()).toEqual([1])
    expect(guest.peers()).toEqual([0])
    expect(await host.details(1)).toMatchObject({ transport: 'memory' })
    expect(await guest.details()).toMatchObject({ transport: 'memory' })
    expect(host.lastTest()).toBeNull()
    const run = host.testConnections()
    await later(9000)
    expect((await run).players[0]?.result?.down.kbPerSecond).toBeGreaterThan(0)
    expect(started).toBe(1)
    expect(results).toEqual([(await run).players[0]?.result])
    expect(guest.lastTest()).toEqual(results[0])
    expect(host.lastTest()).toBe(await run)
    host.close()
  })

  it('moves a player where they steer, on every phone, and shows their ping', async () => {
    const host = new HostSession('Hosty')
    const { guest } = await join(host)
    guest.setTarget({ x: 500, y: 200 })
    await later(3000)
    expect(player(host, 1)).toMatchObject({ x: 500, y: 200, ping: 0 })
    expect(guest.snapshot()?.players.find((p) => p.id === 1)).toMatchObject({ x: 500, y: 200 })
    expect(guest.host).toBe('Hosty')
    host.close()
  })

  it('sends only sound snapshots, through a whole round', async () => {
    const host = new HostSession('Hosty')
    const { pair, guest } = await join(host)
    guest.setTarget({ x: 0, y: 1000 })
    host.start(5)
    // Three seconds of countdown, then the round.
    await later(9000)
    const states = pair.host.fast.sent.filter((m) => m.includes('"state"'))
    expect(states.length).toBeGreaterThan(100)
    for (const message of states) expect(parseSnapshot(JSON.parse(message).data)).toBeDefined()
    expect(guest.snapshot()?.phase).toBe('over')
    host.close()
  })

  it('lets in as many players as the game has colors, and no more', async () => {
    const host = new HostSession('Hosty')
    for (let i = 1; i < MAX_PLAYERS; i++) await join(host, `P${i}`)
    const pair = linkPair()
    host.attach(pair.host.link).joined.catch(() => {})
    pair.open()
    await expect(GuestSession.join(pair.guest.link, 'Late', token())).rejects.toThrow('full')
    expect(host.world.players).toHaveLength(MAX_PLAYERS)
    host.close()
  })

  it('refuses a phone with an older version of the game', async () => {
    const host = new HostSession('Hosty')
    const { hello, pair } = rogue(host)
    hello({ version: PROTOCOL - 1 })
    await later(100)
    expect(JSON.parse(pair.host.control.sent[0] ?? '{}')).toMatchObject({
      type: 'mismatch',
      version: PROTOCOL,
    })
    expect(host.world.players).toHaveLength(1)
    host.close()
  })
})

describe('the network log', () => {
  it('samples every connection once a second, on both phones', async () => {
    const host = new HostSession('Hosty')
    const { guest } = await join(host)
    guest.setTarget({ x: 500, y: 200 })
    await later(5000)
    const mine = guest.net.series(0)
    const theirs = host.net.series(1)
    expect(mine.length).toBeGreaterThanOrEqual(4)
    expect(theirs.length).toBeGreaterThanOrEqual(3)
    // The host sends 30 snapshots a second, and the player as many inputs.
    expect(mine.at(-1)).toMatchObject({ peer: 0, ping: 0, loss: 0 })
    expect(mine.at(-1)?.inRate).toBeGreaterThan(25)
    expect(theirs.at(-1)?.inRate).toBeGreaterThan(25)
    expect(theirs.at(-1)?.gap).toBeLessThan(100)
    expect(guest.net.summary()[0]).toMatchObject({ peer: 0, loss: 0, stalls: 0 })
    host.close()
  })

  it('shows a stall when the host goes quiet', async () => {
    const host = new HostSession('Hosty')
    const { guest, pair } = await join(host)
    await later(2000)
    pair.host.fast.dropping = true
    await later(3000)
    const last = guest.net.series(0).at(-1)
    expect(last?.gap).toBeGreaterThanOrEqual(1000)
    expect(last?.inRate).toBe(0)
    expect(guest.net.summary()[0]?.stalls).toBeGreaterThan(0)
    host.close()
  })
})

describe('rounds', () => {
  it('start by themselves after a round once every player is ready, and not before', async () => {
    const host = new HostSession('Hosty')
    const one = await join(host, 'One')
    const two = await join(host, 'Two')
    host.start(5)
    await later(9000)
    expect(host.world.phase).toBe('over')
    one.guest.setReady(true)
    await later(500)
    expect(player(host, 1).ready).toBe(true)
    expect(host.world.phase).toBe('over')
    two.guest.setReady(true)
    await later(500)
    expect(host.world.phase).toBe('countdown')
    expect(host.world.roundSeconds).toBe(5)
    // Ready ends with the start, on the players' phones too, so the next round waits again.
    await later(500)
    expect(one.guest.ready()).toBe(false)
    expect(host.world.players.every((p) => !p.ready)).toBe(true)
    host.close()
  })

  it('show players who only watch apart, and let them play again between rounds', async () => {
    const host = new HostSession('Hosty')
    const { guest } = await join(host)
    player(host, 1).score = 4
    guest.setWatching(true)
    await later(200)
    expect(host.world.players.map((p) => p.id)).toEqual([0])
    expect(guest.snapshot()?.watching).toEqual([{ id: 1, name: 'Guesty' }])
    host.start(5)
    await later(1000)
    guest.setWatching(false)
    await later(500)
    // Not in the middle of a round.
    expect(host.world.players.map((p) => p.id)).toEqual([0])
    await later(8000)
    expect(host.world.phase).toBe('over')
    await later(200)
    expect(player(host, 1).score).toBe(0)
    expect(host.snapshot().watching).toEqual([])
    host.close()
  })

  it('warn the host about a player whose connection keeps stalling, once a minute', async () => {
    const host = new HostSession('Hosty')
    const warned: string[] = []
    host.onStalling = (name) => warned.push(name)
    const { pair } = await join(host)
    await later(2000)
    pair.guest.fast.dropping = true
    // Inputs stop: every second is a stall, until the player is taken for gone after 8 s.
    await later(5000)
    expect(warned).toEqual(['Guesty'])
    host.close()
  })
})

describe('scores of players away', () => {
  it('stay while the player is away, without their token', async () => {
    const host = new HostSession('Hosty')
    const left: string[] = []
    host.onLeave = (name) => left.push(name)
    const first = await join(host)
    player(host, 1).score = 5
    first.guest.close()
    await later(100)
    expect(left).toEqual(['Guesty'])
    expect(host.snapshot().away).toEqual([{ id: 1, name: 'Guesty' }])
    expect(JSON.stringify(host.snapshot())).not.toContain(first.token)
    const again = await join(host, 'Guesty', first.token)
    expect(again.guest).toMatchObject({ rejoined: true })
    expect(again.guest.selfId()).toBe(1)
    expect(player(host, 1).score).toBe(5)
    host.close()
  })

  it('stay when the same browser comes back before its old connection timed out', async () => {
    const host = new HostSession('Hosty')
    const left: string[] = []
    host.onLeave = (name) => left.push(name)
    const first = await join(host)
    player(host, 1).score = 3
    await join(host, 'Guesty', first.token)
    expect(player(host, 1).score).toBe(3)
    expect(host.world.players).toHaveLength(2)
    // Replaced, not lost: nobody is told the player left.
    expect(left).toEqual([])
    host.close()
  })

  it('start from nothing with everyone else when a round starts', async () => {
    const host = new HostSession('Hosty')
    const first = await join(host)
    player(host, 1).score = 5
    first.guest.close()
    await later(100)
    host.start(60)
    await join(host, 'Guesty', first.token)
    expect(player(host, 1).score).toBe(0)
    host.close()
  })
})

describe('a malicious player', () => {
  it('keeps every position finite and in the arena, whatever numbers it sends', async () => {
    const host = new HostSession('Hosty')
    const { raw, hello } = rogue(host)
    hello()
    await later(100)
    for (const data of [
      '{"type":"input","data":{"x":1e999,"y":5},"ping":1e999}',
      '{"type":"input","data":{"x":-1e999,"y":-1e999},"ping":-5}',
      '{"type":"input","data":{"x":1e308,"y":-1e308},"ping":null}',
      '{"type":"input","data":{"x":"500","y":[500]},"ping":"1"}',
      '{"type":"input","data":{"x":-0,"y":5e-324}}',
    ]) {
      raw('fast', data)
      await later(500)
      const dot = player(host, 1)
      expect(Number.isFinite(dot.x) && Number.isFinite(dot.y)).toBe(true)
      expect(dot.x >= PLAYER_RADIUS && dot.x <= ARENA - PLAYER_RADIUS).toBe(true)
      expect(dot.y >= PLAYER_RADIUS && dot.y <= ARENA - PLAYER_RADIUS).toBe(true)
    }
    host.close()
  })

  it('never learns another player’s token', async () => {
    const host = new HostSession('Hosty')
    const honest = await join(host)
    honest.guest.close()
    await later(100)
    const spy = await join(host, 'Spy')
    await later(2000)
    const everything = [...spy.pair.host.control.sent, ...spy.pair.host.fast.sent].join('\n')
    expect(everything).toContain('Guesty')
    expect(everything).not.toContain(honest.token)
    host.close()
  })
})

describe('a malicious host', () => {
  const sound = {
    phase: 'play',
    timeLeft: 30,
    players: [
      {
        id: 3,
        name: 'Guesty',
        x: 100,
        y: 100,
        score: 2,
        ping: 5,
        caught: 2,
        gold: 0,
        hits: 0,
        ready: false,
      },
    ],
    sparks: [{ id: 1, x: 300, y: 300, gold: false }],
    mines: [{ id: 2, x: 600, y: 600, armIn: 0 }],
    blasts: [],
    away: [],
    watching: [],
  }

  it('gets only sound snapshots drawn', async () => {
    const pair = linkPair()
    pair.open()
    const joining = GuestSession.join(pair.guest.link, 'Guesty', token())
    await later(0)
    pair.host.control.send(
      JSON.stringify({
        type: 'welcome',
        id: 3,
        host: 'Host',
        rejoined: false,
        room: ROOM_PROTOCOL,
        version: PROTOCOL,
      }),
    )
    const guest = await joining
    const state = (data: unknown) => pair.host.fast.send(JSON.stringify({ type: 'state', data }))
    state(sound)
    await later(0)
    expect(guest.snapshot()).toEqual(sound)
    for (const data of [
      { ...sound, phase: 'won' },
      { ...sound, timeLeft: Number.POSITIVE_INFINITY },
      { ...sound, players: 'all' },
      { ...sound, players: [{ ...sound.players[0], x: -50 }] },
      { ...sound, players: [{ ...sound.players[0], score: 1.5 }] },
      { ...sound, players: [{ ...sound.players[0], ready: 'yes' }] },
      { ...sound, players: [{ ...sound.players[0], caught: -1 }] },
      { ...sound, watching: [{ id: 'x', name: 'Cy' }] },
      { ...sound, players: [sound.players[0], sound.players[0]] },
      { ...sound, sparks: Array(1000).fill(sound.sparks[0]) },
      { ...sound, mines: [{ id: 2, x: 600, y: 600 }] },
      { ...sound, blasts: [{ id: 1, x: 1, y: 1, playerId: -1, age: 0 }] },
      null,
    ]) {
      state(data)
      await later(0)
      expect(guest.snapshot()).toEqual(sound)
    }
    guest.close()
  })
})

describe('a player whose code is copied over', () => {
  it('waits a minute for the host to take it, and then gives up', async () => {
    const host = new HostSession('Hosty')
    expect(ANSWER_WAIT_MS).toBe(60_000)
    // Taken after 45 seconds, longer than the library's own 30: the player gets in.
    const slow = linkPair()
    const attached = host.attach(slow.host.link)
    const joining = GuestSession.join(slow.guest.link, 'Slowpoke', token())
    await later(45_000)
    slow.open()
    const guest = await joining
    await attached.joined
    expect(guest.selfId()).toBe(1)

    // Never taken: after a minute, the player hears that it timed out.
    const never = linkPair()
    host.attach(never.host.link).joined.catch(() => {})
    const waiting = GuestSession.join(never.guest.link, 'Waity', token())
    const failed = expect(waiting).rejects.toThrow('Connection timed out')
    await later(ANSWER_WAIT_MS - 1)
    await later(1)
    await failed
    host.close()
  })
})
