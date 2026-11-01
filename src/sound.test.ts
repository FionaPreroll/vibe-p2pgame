import { afterEach, describe, expect, it, vi } from 'vitest'
import { play, SOUNDS, scoreSound, unlockSound } from './sound'

describe('sounds', () => {
  it('match a change of the own score', () => {
    expect(scoreSound(1)).toBe('spark')
    expect(scoreSound(3)).toBe('gold')
    expect(scoreSound(-2)).toBe('mine')
    expect(scoreSound(0)).toBeNull()
  })

  it('are short and quiet enough not to drown the game', () => {
    for (const notes of Object.values(SOUNDS)) {
      for (const note of notes) {
        expect(note.at + note.seconds).toBeLessThanOrEqual(1)
        expect(note.volume).toBeLessThanOrEqual(0.3)
        expect(note.frequency).toBeGreaterThan(20)
      }
    }
  })

  it('play nothing where there is no Web Audio, as in Node', () => {
    expect(() => {
      unlockSound()
      play('spark', true)
    }).not.toThrow()
  })

  describe('with Web Audio', () => {
    /** A stand-in AudioContext that records the notes it is given. */
    class FakeAudio {
      static made: FakeAudio[] = []
      state: AudioContextState = 'suspended'
      currentTime = 10
      destination = {}
      notes: { type: string; frequency: number; start: number; stop: number }[] = []
      ramps: [string, number, number][] = []
      constructor() {
        FakeAudio.made.push(this)
      }
      async resume() {
        this.state = 'running'
      }
      createOscillator() {
        const note = { type: '', frequency: 0, start: -1, stop: -1 }
        this.notes.push(note)
        return {
          set type(value: string) {
            note.type = value
          },
          frequency: {
            set value(value: number) {
              note.frequency = value
            },
          },
          connect: (gain: unknown) => gain,
          start: (at: number) => {
            note.start = at
          },
          stop: (at: number) => {
            note.stop = at
          },
        }
      }
      createGain() {
        const ramp = (kind: string) => (value: number, at: number) =>
          void this.ramps.push([kind, value, at])
        return {
          gain: {
            setValueAtTime: ramp('set'),
            linearRampToValueAtTime: ramp('linear'),
            exponentialRampToValueAtTime: ramp('exponential'),
          },
          connect: (to: unknown) => to,
        }
      }
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('starts after the first touch, plays each note of a sound, and nothing when off', async () => {
      vi.stubGlobal('AudioContext', FakeAudio)
      // Not started yet: nothing plays.
      play('spark', true)
      unlockSound()
      unlockSound()
      expect(FakeAudio.made).toHaveLength(1)
      const audio = FakeAudio.made[0] as FakeAudio
      expect(audio.notes).toHaveLength(0)
      await Promise.resolve()
      expect(audio.state).toBe('running')

      play('gold', false)
      expect(audio.notes).toHaveLength(0)

      play('gold', true)
      expect(audio.notes).toHaveLength(SOUNDS.gold.length)
      SOUNDS.gold.forEach((note, i) => {
        expect(audio.notes[i]).toMatchObject({
          type: note.type,
          frequency: note.frequency,
          start: 10 + note.at,
        })
        // Each note ends after it faded, so it does not click.
        expect(audio.notes[i]?.stop).toBeCloseTo(10 + note.at + note.seconds + 0.02)
      })
      // It rises from silence and falls to almost nothing.
      expect(audio.ramps[0]).toEqual(['set', 0, 10 + (SOUNDS.gold[0]?.at ?? 0)])
      expect(audio.ramps.filter(([kind]) => kind === 'exponential').map(([, v]) => v)).toEqual(
        SOUNDS.gold.map(() => 0.001),
      )
    })
  })
})
