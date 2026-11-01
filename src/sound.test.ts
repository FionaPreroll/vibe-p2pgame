import { describe, expect, it } from 'vitest'
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
})
