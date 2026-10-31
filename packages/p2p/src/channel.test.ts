import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  clamp,
  cleanName,
  decode,
  inRange,
  isId,
  isNumber,
  isObject,
  list,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  send,
} from './channel.ts'
import { linkPair } from './testing.ts'

const anyNumber = (value: unknown) => (typeof value === 'number' ? value : undefined)

describe('decode', () => {
  it('reads short JSON that the parser accepts', () => {
    expect(decode('42', anyNumber)).toBe(42)
    expect(decode('"42"', anyNumber)).toBeUndefined()
    expect(decode('{broken', anyNumber)).toBeUndefined()
    expect(decode(new ArrayBuffer(4), anyNumber)).toBeUndefined()
    expect(decode(`"${'x'.repeat(MAX_MESSAGE_LENGTH)}"`, (v) => v)).toBeUndefined()
  })

  it('never throws, whatever arrives', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.string({ unit: 'binary' }), fc.json(), fc.anything()),
        (data) => {
          decode(data, (v) => v)
        },
      ),
      { numRuns: 2000 },
    )
  })
})

describe('send', () => {
  it('sends JSON on an open channel, and nothing on a closed one', async () => {
    const pair = linkPair()
    send(pair.host.link.control, { a: 1 })
    expect(pair.host.control.sent).toEqual([])
    pair.open()
    send(pair.host.link.control, { a: 1 })
    expect(pair.host.control.sent).toEqual(['{"a":1}'])
  })
})

describe('cleanName', () => {
  it('makes names short, single line and printable', () => {
    expect(cleanName('‮evil‬ name', '?')).toBe('evil name')
    expect(cleanName('a\u0000b\u0007c\nd\te', '?')).toBe('abc d e')
    expect(cleanName('zero​width', '?')).toBe('zerowidth')
    expect(cleanName('   ', '?')).toBe('?')
    expect(cleanName(7, '?')).toBe('?')
    expect(cleanName('😀'.repeat(20), '?')).toBe('😀'.repeat(16))
  })

  it('holds for any text', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.string({ unit: 'grapheme' }),
          fc.string({ unit: 'binary' }),
          fc.anything(),
        ),
        (name) => {
          const clean = cleanName(name, '?')
          expect(clean.length).toBeGreaterThan(0)
          expect(Array.from(clean).length).toBeLessThanOrEqual(MAX_NAME_LENGTH)
          expect(clean).not.toMatch(/[\p{Cc}\p{Cf}\n\r\t]/u)
          expect(clean).toBe(clean.trim())
          expect(cleanName(clean, '?')).toBe(clean)
        },
      ),
      { numRuns: 2000 },
    )
  })
})

describe('checks', () => {
  it('tell sound values from others', () => {
    expect(isObject({})).toBe(true)
    expect(isObject([])).toBe(false)
    expect(isObject(null)).toBe(false)
    expect(isNumber(1)).toBe(true)
    expect(isNumber(JSON.parse('1e999'))).toBe(false)
    expect(isNumber(Number.NaN)).toBe(false)
    expect(isId(0)).toBe(true)
    expect(isId(-1)).toBe(false)
    expect(isId(1.5)).toBe(false)
    expect(inRange(5, 0, 10)).toBe(true)
    expect(inRange(11, 0, 10)).toBe(false)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(list([1, 2], 2, anyNumber)).toEqual([1, 2])
    expect(list([1, 2, 3], 2, anyNumber)).toBeUndefined()
    expect(list([1, 'x'], 2, anyNumber)).toBeUndefined()
    expect(list('no', 2, anyNumber)).toBeUndefined()
  })
})
