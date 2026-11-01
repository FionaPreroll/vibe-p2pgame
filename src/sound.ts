/**
 * The game's sounds, made on the spot with the Web Audio API, without sound files: short tones
 * for a spark, a golden spark and a mine, ticks for the countdown, and chords for the start and
 * the end of a round. Browsers allow sound only after the player touched the page, so the
 * sounds start with the first touch or key; until then, and with sound off, nothing plays.
 */

export type Sound = 'spark' | 'gold' | 'mine' | 'tick' | 'go' | 'end'

interface Note {
  /** Seconds after the sound starts. */
  readonly at: number
  readonly frequency: number
  readonly seconds: number
  readonly type: OscillatorType
  readonly volume: number
}

/** Each sound as notes, so it can be read and tested without playing it. */
export const SOUNDS: Readonly<Record<Sound, readonly Note[]>> = {
  spark: [{ at: 0, frequency: 1320, seconds: 0.08, type: 'sine', volume: 0.25 }],
  gold: [
    { at: 0, frequency: 1320, seconds: 0.08, type: 'sine', volume: 0.25 },
    { at: 0.08, frequency: 1760, seconds: 0.14, type: 'sine', volume: 0.25 },
  ],
  mine: [
    { at: 0, frequency: 160, seconds: 0.25, type: 'sawtooth', volume: 0.3 },
    { at: 0.05, frequency: 90, seconds: 0.3, type: 'square', volume: 0.15 },
  ],
  tick: [{ at: 0, frequency: 660, seconds: 0.1, type: 'triangle', volume: 0.3 }],
  go: [
    { at: 0, frequency: 880, seconds: 0.25, type: 'triangle', volume: 0.3 },
    { at: 0, frequency: 1320, seconds: 0.25, type: 'sine', volume: 0.15 },
  ],
  end: [
    { at: 0, frequency: 523, seconds: 0.2, type: 'triangle', volume: 0.25 },
    { at: 0.15, frequency: 659, seconds: 0.2, type: 'triangle', volume: 0.25 },
    { at: 0.3, frequency: 784, seconds: 0.4, type: 'triangle', volume: 0.25 },
  ],
}

/** The sound for a change of the player's own score: a spark, a golden one, or a mine. */
export function scoreSound(change: number): Sound | null {
  return change < 0 ? 'mine' : change > 1 ? 'gold' : change > 0 ? 'spark' : null
}

let context: AudioContext | null = null

/** Starts the sound after the player's first touch or key, as browsers ask. */
export function unlockSound(): void {
  if (typeof AudioContext === 'undefined') return
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume().catch(() => {})
  } catch {
    context = null
  }
}

/** Plays a sound, if sound is on and allowed. */
export function play(sound: Sound, on: boolean): void {
  if (!on || context === null || context.state !== 'running') return
  const start = context.currentTime
  for (const note of SOUNDS[sound]) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = note.type
    oscillator.frequency.value = note.frequency
    // A quick rise and an even fall, so no note clicks.
    gain.gain.setValueAtTime(0, start + note.at)
    gain.gain.linearRampToValueAtTime(note.volume, start + note.at + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, start + note.at + note.seconds)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(start + note.at)
    oscillator.stop(start + note.at + note.seconds + 0.02)
  }
}
