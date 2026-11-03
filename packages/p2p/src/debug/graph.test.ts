import { describe, expect, it } from 'vitest'
import { drawNetGraph, pingQuality, worstLatest } from './graph.ts'
import { NetLog, type NetReading } from './netlog.ts'

const reading = (ping: number | null, n: number): NetReading => ({
  ping,
  traffic: { sent: n, sentChars: n, received: n, receivedChars: n },
})

/** A log with two players: one quick, one slow that stalls once. */
function twoPlayers(): NetLog {
  const log = new NetLog(0, 0)
  for (const peer of [1, 2]) log.sample(peer, 0, reading(null, 0))
  for (let s = 1; s <= 10; s++) {
    log.arrived(1, s * 1000 - 10)
    if (s !== 5) log.arrived(2, s * 1000 - 10)
    log.sample(1, s * 1000, reading(20, s * 30))
    log.sample(2, s * 1000, reading(s === 8 ? null : 120, s * 30))
  }
  return log
}

/** A canvas that records what is drawn on it. */
function canvas() {
  const calls: string[] = []
  const context = new Proxy(
    {},
    {
      get: (_, name) => (name in record ? record[name as string] : () => calls.push(String(name))),
      set: (_, name, value) => {
        calls.push(`${String(name)}=${value}`)
        return true
      },
    },
  )
  const record: Record<string, unknown> = {
    fillText: (text: string) => calls.push(`text ${text}`),
  }
  const element = {
    clientWidth: 120,
    clientHeight: 40,
    width: 0,
    height: 0,
    getContext: () => context,
  } as unknown as HTMLCanvasElement
  return { element, calls }
}

describe('the connection graph', () => {
  it('rates a ping as players feel it', () => {
    expect(pingQuality(20)).toBe('good')
    expect(pingQuality(100)).toBe('fair')
    expect(pingQuality(200)).toBe('poor')
    expect(pingQuality(20, true)).toBe('poor')
    expect(pingQuality(null)).toBe('none')
  })

  it('shows the worst newest sample of the connections still going', () => {
    const log = twoPlayers()
    expect(worstLatest(log, 10_000)).toMatchObject({ peer: 2 })
    expect(worstLatest(log, 20_000)).toBeNull()
  })

  it('draws a line for every connection in its colour, a mark for every stall, and the scale', () => {
    const { element, calls } = canvas()
    drawNetGraph(element, twoPlayers(), 10_000, 30, {
      axes: true,
      color: (peer) => `colour-${peer}`,
      stallColor: 'stall',
      nowLabel: 'jetzt',
    })
    expect(element.width).toBe(120)
    expect(calls).toContain('strokeStyle=colour-1')
    expect(calls).toContain('strokeStyle=colour-2')
    expect(calls).toContain('fillStyle=stall')
    expect(calls).toContain('text 150 ms')
    expect(calls).toContain('text jetzt')
    expect(calls).toContain('text −30 s')
    expect(calls.filter((c) => c === 'fillRect').length).toBeGreaterThan(1)
  })

  it('draws without a scale, and does nothing without a context', () => {
    const { element, calls } = canvas()
    drawNetGraph(element, twoPlayers(), 10_000, 30)
    expect(calls).toContain('strokeStyle=#ffc400')
    expect(calls.some((c) => c.startsWith('text'))).toBe(false)
    const blank = { ...element, getContext: () => null } as unknown as HTMLCanvasElement
    expect(() => drawNetGraph(blank, twoPlayers(), 10_000, 30)).not.toThrow()
  })
})
