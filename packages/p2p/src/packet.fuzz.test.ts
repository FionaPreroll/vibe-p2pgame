import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MAX_MESSAGE_LENGTH } from './channel.ts'
import { type ChannelName, packetConnection } from './packet.ts'

/**
 * A packet connection under a hostile transport, made up by fast-check: whatever the transport
 * hands over, in whatever order, with whatever state changes in between, the channels pass on
 * exactly the text a well-behaved transport would, and the connection never goes back.
 */

const anything = fc.oneof(
  fc.anything(),
  fc.string(),
  fc.constantFrom(
    'control',
    'fast',
    'Control',
    'fast ',
    '__proto__',
    'constructor',
    '',
    'x'.repeat(MAX_MESSAGE_LENGTH),
    'x'.repeat(MAX_MESSAGE_LENGTH + 1),
    null,
    undefined,
    42,
  ),
)

const step = fc.oneof(
  fc.record({ kind: fc.constant('receive' as const), channel: anything, data: anything }),
  fc.record({
    kind: fc.constant('receive' as const),
    channel: fc.constantFrom('control', 'fast'),
    // Text, and text right at the limit and just past it.
    data: fc.oneof(
      fc.string(),
      fc.constantFrom(
        'x'.repeat(MAX_MESSAGE_LENGTH),
        'x'.repeat(MAX_MESSAGE_LENGTH + 1),
        'é'.repeat(MAX_MESSAGE_LENGTH),
      ),
    ),
  }),
  fc.constantFrom(
    { kind: 'open' as const },
    { kind: 'closed' as const },
    { kind: 'close' as const },
  ),
  fc.record({
    kind: fc.constant('send' as const),
    channel: fc.constantFrom<ChannelName>('control', 'fast'),
    data: fc.string(),
  }),
)

describe('a packet connection, fuzzed', () => {
  it('passes on only short text on a known channel while open, and never reopens', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 80 }), (steps) => {
        const sent: [ChannelName, string][] = []
        let transportClosed = 0
        const connection = packetConnection({
          send: (channel, data) => void sent.push([channel, data]),
          close: () => void transportClosed++,
        })
        const delivered: [ChannelName, unknown][] = []
        connection.control.addEventListener('message', (e) => delivered.push(['control', e.data]))
        connection.fast.addEventListener('message', (e) => delivered.push(['fast', e.data]))
        const states: string[] = [connection.state]
        connection.onStateChange(() => states.push(connection.state))

        const expected: [ChannelName, string][] = []
        const expectedSent: [ChannelName, string][] = []
        for (const s of steps) {
          const before = connection.state
          switch (s.kind) {
            case 'receive':
              connection.receive(s.channel, s.data)
              if (
                before === 'open' &&
                (s.channel === 'control' || s.channel === 'fast') &&
                typeof s.data === 'string' &&
                s.data.length <= MAX_MESSAGE_LENGTH
              )
                expected.push([s.channel, s.data])
              break
            case 'open':
              connection.markOpen()
              break
            case 'closed':
              connection.markClosed()
              break
            case 'close':
              connection.close()
              break
            case 'send': {
              const channel = connection[s.channel]
              if (before === 'open') {
                channel.send(s.data)
                expectedSent.push([s.channel, s.data])
              } else expect(() => channel.send(s.data)).toThrow()
              break
            }
          }
        }

        expect(delivered).toEqual(expected)
        expect(sent).toEqual(expectedSent)
        // Only forward: connecting, then open, then closed, each once at most.
        const order = ['connecting', 'open', 'closed']
        for (let i = 1; i < states.length; i++) {
          expect(order.indexOf(states[i] as string)).toBeGreaterThan(
            order.indexOf(states[i - 1] as string),
          )
        }
        expect(transportClosed).toBeLessThanOrEqual(1)
        if (connection.state === 'closed') {
          expect(connection.control.readyState).toBe('closed')
          expect(connection.fast.readyState).toBe('closed')
        }
      }),
      { numRuns: 500 },
    )
  })
})
