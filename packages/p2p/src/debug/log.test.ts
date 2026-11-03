import fc from 'fast-check'
import { beforeEach, describe, expect, it } from 'vitest'
import { DebugLog, describeError, redact } from './log.ts'

let now = 0
let debug = new DebugLog(300, () => now)
const log = (area: string, message: string) => debug.log(area, message)
const logLines = () => debug.lines()

beforeEach(() => {
  now = 0
  debug = new DebugLog(300, () => now)
})

describe('the log', () => {
  it('keeps the last lines, with the time since the start and the area', () => {
    log('bluetooth', 'start as player')
    now = 1520
    log('net', 'player 1: messages again')
    expect(logLines()).toEqual([
      '+0s [bluetooth] start as player',
      '+1.5s [net] player 1: messages again',
    ])
    for (let i = 0; i < 400; i++) log('x', `line ${i}`)
    expect(logLines()).toHaveLength(300)
    expect(logLines().at(-1)).toContain('line 399')
  })

  it('masks codes, addresses and tokens, wherever they are', () => {
    expect(redact('offer P1~o~x~Wke9~pwd~fp~192.168.43.1,58378 failed')).toBe('offer <code> failed')
    expect(redact('candidate 192.168.43.1 port 9')).toBe('candidate <ip> port 9')
    expect(redact('from 2a02:810d:4ac0::1 and fe80::1')).toBe('from <ip> and <ip>')
    expect(redact('device 0A:1b:2C:3d:4E:5f or 0a-1b-2c-3d-4e-5f')).toBe('device <mac> or <mac>')
    expect(redact('offer P2~o~x~y now')).toBe('offer <code> now')
    expect(redact('host 7f2c3a1e-1111-4b2b-9c3d-0e1f2a3b4c5d.local')).toBe('host <mdns>')
    expect(redact('token 0123456789abcdef01234567 and token-00000001')).toBe(
      'token <token> and <token>',
    )
    expect(redact('could not start: nearby-8007 at 12:30')).toBe(
      'could not start: nearby-8007 at 12:30',
    )
    log('qr', 'answer P1~a~a~x from 10.0.0.2')
    expect(logLines().join()).not.toMatch(/P1~|10\.0\.0\.2/)
  })

  it('never lets an address through, whatever the text around it', () => {
    fc.assert(
      fc.property(fc.string(), fc.ipV4(), fc.string(), (before, ip, after) => {
        expect(redact(`${before} ${ip} ${after}`)).not.toContain(` ${ip} `)
      }),
      { numRuns: 500 },
    )
  })

  it('describes errors of every kind in one short line', () => {
    expect(
      describeError(Object.assign(new Error('Could not discover'), { code: 'nearby-8007' })),
    ).toBe('nearby-8007: Could not discover')
    expect(describeError(new Error('plain'))).toBe('plain')
    expect(describeError('text')).toBe('text')
    expect(describeError(null)).toBe('null')
    expect(describeError({})).toBe('[object Object]')
    expect(describeError(new Error('x'.repeat(1000))).length).toBe(300)
  })

  it('catches errors nobody else caught', () => {
    const target = new EventTarget()
    debug.captureErrors(target as unknown as Window)
    target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('boom') }))
    target.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: { code: 'x', message: 'lost' } }),
    )
    expect(logLines()).toEqual(['+0s [error] boom', '+0s [error] unhandled: x: lost'])
  })

  it('starts afresh', () => {
    log('x', 'one')
    now = 5000
    debug.clear()
    log('x', 'two')
    expect(logLines()).toEqual(['+0s [x] two'])
  })
})
