import { beforeEach, describe, expect, it } from 'vitest'
import { captureErrors, clearLog, log, logLines, redact } from './log'

/** Spark Hunt's log is the library's (see its tests): one for the whole game. */

beforeEach(() => clearLog())

describe('the log', () => {
  it('keeps lines with the area, masking what must not leave the phone', () => {
    log('qr', 'answer P1~a~a~x from 10.0.0.2')
    expect(logLines()).toEqual(['+0s [qr] answer <code> from <ip>'])
    expect(redact('token-1234abcd')).toBe('<token>')
    clearLog()
    expect(logLines()).toEqual([])
  })

  it('catches errors nobody else caught', () => {
    const target = new EventTarget()
    captureErrors(target as unknown as Window)
    target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('boom') }))
    expect(logLines()).toEqual(['+0s [error] boom'])
  })
})
