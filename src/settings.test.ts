import { describe, expect, it } from 'vitest'
import { DEFAULTS, parseSettings } from './settings'

describe('parseSettings', () => {
  it('gives the defaults when nothing is stored', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULTS)
    expect(parseSettings('nonsense')).toEqual(DEFAULTS)
    expect(parseSettings([1, 2])).toEqual(DEFAULTS)
  })

  it('keeps valid values', () => {
    const stored = {
      name: 'Ada',
      language: 'de',
      vibration: false,
      keepScreenOn: false,
      roundSeconds: 90,
      camera: { deviceId: 'cam-2', zoom: 2.5, exposure: -1 },
      checkUpdates: true,
      updatesAsked: true,
      joystick: 'left',
      bindings: {
        keys: {
          up: ['KeyI'],
          down: ['KeyK', 'Numpad2'],
          left: ['KeyJ'],
          right: ['KeyL'],
          start: [],
        },
        buttons: { up: null, down: 13, left: 14, right: 15, start: 0 },
      },
      netGraph: false,
    }
    expect(parseSettings(stored)).toEqual(stored)
  })

  it('replaces each invalid value with its default on its own', () => {
    const settings = parseSettings({
      name: 7,
      language: 'fr',
      vibration: 'yes',
      roundSeconds: 45,
      camera: { deviceId: 3, zoom: Number.NaN, exposure: 'dark' },
      keepScreenOn: false,
      checkUpdates: 'yes',
      updatesAsked: 1,
      joystick: 'middle',
      bindings: 'wasd',
      netGraph: 'on',
    })
    expect(settings).toEqual({ ...DEFAULTS, keepScreenOn: false })
  })

  it('takes the name from before there were settings, and keeps names short', () => {
    expect(parseSettings(undefined, 'Old name').name).toBe('Old name')
    expect(parseSettings({ name: 'New' }, 'Old name').name).toBe('New')
    expect(parseSettings({ name: 'A very long name indeed' }).name).toHaveLength(16)
  })
})
