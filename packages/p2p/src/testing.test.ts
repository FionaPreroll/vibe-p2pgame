import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeChannel, linkPair, seededRandom } from './testing.ts'

/**
 * The connections in memory that games test with: lossless and quick by default, and as weak as
 * a test wants, by seed.
 */

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const later = (ms: number) => vi.advanceTimersByTimeAsync(ms)

/** An open pair, with what arrives on each of the guest's channels. */
function pair(options: Parameters<typeof linkPair>[0] = {}) {
  const link = linkPair(options)
  link.open()
  const arrived = { control: [] as string[], fast: [] as string[] }
  for (const name of ['control', 'fast'] as const)
    link.guest[name].addEventListener('message', (e) => arrived[name].push(e.data))
  return { ...link, arrived }
}

const messages = (n: number) => Array.from({ length: n }, (_, i) => String(i))

describe('seededRandom', () => {
  it('gives the same numbers for the same seed, from 0 up to 1', () => {
    const a = seededRandom(42)
    const b = seededRandom(42)
    const numbers = Array.from({ length: 1000 }, () => a())
    expect(numbers).toEqual(Array.from({ length: 1000 }, () => b()))
    expect(numbers.every((n) => n >= 0 && n < 1)).toBe(true)
    expect(seededRandom(43)()).not.toBe(numbers[0])
  })
})

describe('linkPair', () => {
  it('carries every message a moment later, in order, by default', async () => {
    const p = pair()
    for (const m of messages(20)) {
      p.host.control.send(m)
      p.host.fast.send(m)
    }
    expect(p.arrived.fast).toEqual([])
    await later(0)
    expect(p.arrived.control).toEqual(messages(20))
    expect(p.arrived.fast).toEqual(messages(20))
    expect(p.host.fast.lost).toBe(0)
  })

  it('loses a share of fast messages, the same ones for the same seed', async () => {
    const run = async (seed: number) => {
      const p = pair({ conditions: { loss: 0.3, seed } })
      for (const m of messages(1000)) p.host.fast.send(m)
      await later(0)
      return p
    }
    const a = await run(7)
    expect(a.arrived.fast.length).toBeGreaterThan(620)
    expect(a.arrived.fast.length).toBeLessThan(780)
    expect(a.host.fast.lost).toBe(1000 - a.arrived.fast.length)
    expect(a.host.fast.sent).toHaveLength(1000)
    expect((await run(7)).arrived.fast).toEqual(a.arrived.fast)
    expect((await run(8)).arrived.fast).not.toEqual(a.arrived.fast)
  })

  it('delays and reorders fast messages, but keeps control lossless and in order', async () => {
    const p = pair({ conditions: { loss: 0.5, delayMs: [20, 200], seed: 3 } })
    for (const m of messages(200)) {
      p.host.control.send(m)
      p.host.fast.send(m)
    }
    await later(19)
    expect(p.arrived.fast).toEqual([])
    expect(p.arrived.control).toEqual([])
    await later(200)
    expect(p.arrived.control).toEqual(messages(200))
    expect(p.arrived.fast.length).toBeGreaterThan(70)
    expect(p.arrived.fast.length).toBeLessThan(130)
    // Some later message overtook an earlier one.
    const order = p.arrived.fast.map(Number)
    expect(order).not.toEqual([...order].sort((a, b) => a - b))
  })

  it('draws from different seeds for both ways', async () => {
    const p = pair({ conditions: { loss: 0.5, seed: 9 } })
    const back: string[] = []
    p.host.fast.addEventListener('message', (e) => back.push(e.data))
    for (const m of messages(100)) {
      p.host.fast.send(m)
      p.guest.fast.send(m)
    }
    await later(0)
    expect(back).not.toEqual(p.arrived.fast)
  })

  it('takes new conditions at any time, and dropping loses everything', async () => {
    const p = pair()
    p.host.fast.conditions = { delayMs: 50 }
    p.host.fast.send('late')
    p.host.fast.dropping = true
    p.host.fast.send('lost')
    await later(49)
    expect(p.arrived.fast).toEqual([])
    await later(1)
    expect(p.arrived.fast).toEqual(['late'])
    expect(p.host.fast.lost).toBe(1)
  })

  it('delivers nothing to a side that closed while a message was on its way', async () => {
    const p = pair({ conditions: { delayMs: 100 } })
    p.host.control.send('bye')
    p.guest.connection.close()
    await later(200)
    expect(p.arrived.control).toEqual([])
  })

  it('tells the channels’ counts as details', async () => {
    const p = pair({ conditions: { loss: 1 } })
    p.host.fast.send('x')
    p.host.control.send('y')
    await later(0)
    expect(await p.guest.connection.details()).toEqual({
      transport: 'memory',
      channels: [
        { label: 'control', state: 'open', messagesSent: 0, messagesReceived: 1 },
        { label: 'fast', state: 'open', messagesSent: 0, messagesReceived: 0 },
      ],
    })
  })

  it('refuses to send on a channel that is not open, and anything but text', () => {
    const channel = new FakeChannel()
    expect(() => channel.send('x')).toThrow('connecting')
    channel.readyState = 'open'
    expect(() => channel.send(1 as unknown as string)).toThrow('strings')
  })
})
