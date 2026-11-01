import { describe, expect, it } from 'vitest'
import {
  ACTIONS,
  bindButton,
  bindKey,
  buttonLabel,
  Controls,
  DEFAULT_BINDINGS,
  direction,
  keyLabel,
  parseBindings,
} from './input'

describe('parseBindings', () => {
  it('gives the defaults for nothing or nonsense', () => {
    expect(parseBindings(undefined)).toEqual(DEFAULT_BINDINGS)
    expect(parseBindings('wasd')).toEqual(DEFAULT_BINDINGS)
    expect(parseBindings({ keys: [], buttons: 7 })).toEqual(DEFAULT_BINDINGS)
  })

  it('checks every action on its own', () => {
    const parsed = parseBindings({
      keys: {
        up: ['KeyI'],
        down: 'KeyK',
        left: ['KeyJ', 'KeyH', 'KeyG'],
        right: ['<script>'],
        start: [],
      },
      buttons: { up: 3, down: -1, left: 1.5, right: 99, start: null },
    })
    expect(parsed.keys).toEqual({
      up: ['KeyI'],
      down: DEFAULT_BINDINGS.keys.down,
      left: DEFAULT_BINDINGS.keys.left,
      right: DEFAULT_BINDINGS.keys.right,
      start: [],
    })
    expect(parsed.buttons).toEqual({ ...DEFAULT_BINDINGS.buttons, up: 3, start: null })
  })

  it('keeps a key or button bound twice with the first action only', () => {
    const parsed = parseBindings({
      keys: { up: ['KeyW'], down: ['KeyW', 'KeyS'] },
      buttons: { up: 0, down: 0 },
    })
    expect(parsed.keys.up).toEqual(['KeyW'])
    expect(parsed.keys.down).toEqual(['KeyS'])
    expect(parsed.buttons.up).toBe(0)
    expect(parsed.buttons.down).toBeNull()
  })
})

describe('binding', () => {
  it('moves a key from another action, and empties a slot', () => {
    const moved = bindKey(DEFAULT_BINDINGS, 'start', 0, 'KeyW')
    expect(moved.keys.start).toEqual(['KeyW', 'Space'])
    expect(moved.keys.up).toEqual(['ArrowUp'])
    expect(bindKey(moved, 'start', 1, null).keys.start).toEqual(['KeyW'])
    expect(bindKey(moved, 'up', 1, 'KeyI').keys.up).toEqual(['ArrowUp', 'KeyI'])
    // Twice the same key on one action is once.
    expect(bindKey(DEFAULT_BINDINGS, 'up', 1, 'ArrowUp').keys.up).toEqual(['ArrowUp'])
  })

  it('moves a button from another action', () => {
    const moved = bindButton(DEFAULT_BINDINGS, 'start', 12)
    expect(moved.buttons.start).toBe(12)
    expect(moved.buttons.up).toBeNull()
    expect(bindButton(moved, 'start', null).buttons.start).toBeNull()
  })

  it('round-trips through storage', () => {
    let bindings = DEFAULT_BINDINGS
    bindings = bindKey(bindings, 'left', 0, 'KeyJ')
    bindings = bindButton(bindings, 'start', 0)
    expect(parseBindings(JSON.parse(JSON.stringify(bindings)))).toEqual(bindings)
  })

  it('names keys and buttons for players', () => {
    expect(keyLabel('KeyW')).toBe('W')
    expect(keyLabel('ArrowLeft')).toBe('←')
    expect(keyLabel('Digit7')).toBe('7')
    expect(keyLabel('Space')).toBe('Space')
    expect(buttonLabel(9)).toBe('Start')
    expect(buttonLabel(25)).toBe('#25')
  })
})

describe('direction', () => {
  it('adds up the directions held, at most 1 long', () => {
    expect(direction(new Set(), null)).toBeNull()
    expect(direction(new Set(['up']), null)).toEqual({ x: 0, y: -1 })
    const diagonal = direction(new Set(['up', 'right']), null)
    expect(diagonal?.x).toBeCloseTo(Math.SQRT1_2)
    expect(diagonal?.y).toBeCloseTo(-Math.SQRT1_2)
    expect(direction(new Set(['left', 'right']), null)).toBeNull()
    expect(direction(new Set(['start']), null)).toBeNull()
  })

  it('takes a stick past its dead zone over the keys, scaled from 0 to 1', () => {
    expect(direction(new Set(['up']), [0.1, 0.1])).toEqual({ x: 0, y: -1 })
    expect(direction(new Set(), [1, 0])).toEqual({ x: 1, y: 0 })
    const half = direction(new Set(), [0, 0.6])
    expect(half?.y).toBeCloseTo(0.5)
    expect(
      Math.hypot(direction(new Set(), [1, 1])?.x ?? 0, direction(new Set(), [1, 1])?.y ?? 0),
    ).toBeCloseTo(1)
    expect(direction(new Set(), [Number.NaN, 0])).toBeNull()
  })
})

describe('Controls', () => {
  function setup(pads: Gamepad[] = []) {
    const target = new EventTarget() as unknown as Window
    const controls = new Controls(
      () => DEFAULT_BINDINGS,
      target,
      () => pads,
    )
    const key = (type: 'keydown' | 'keyup', code: string, repeat = false) =>
      target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code, repeat }))
    return { controls, key }
  }

  const pad = (pressed: number[], axes: number[] = [0, 0]) =>
    ({
      connected: true,
      axes,
      buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
    }) as unknown as Gamepad

  it('steers by the keys held, and lets go', () => {
    const { controls, key } = setup()
    key('keydown', 'KeyW')
    key('keydown', 'ArrowRight')
    expect(controls.poll().direction?.y).toBeCloseTo(-Math.SQRT1_2)
    key('keyup', 'KeyW')
    key('keyup', 'ArrowRight')
    expect(controls.poll().direction).toBeNull()
    key('keydown', 'KeyQ')
    expect(controls.poll().direction).toBeNull()
    controls.destroy()
  })

  it('reports start once per press, not for a held key', () => {
    const { controls, key } = setup()
    key('keydown', 'Enter')
    key('keydown', 'Enter', true)
    expect(controls.poll().start).toBe(true)
    expect(controls.poll().start).toBe(false)
    controls.destroy()
  })

  it('reads controllers: the D-pad, the stick and start once per press', () => {
    const pads = [pad([12, 9])]
    const { controls } = setup(pads)
    expect(controls.poll()).toEqual({ direction: { x: 0, y: -1 }, start: true })
    expect(controls.poll().start).toBe(false)
    pads[0] = pad([], [-1, 0])
    expect(controls.poll()).toEqual({ direction: { x: -1, y: 0 }, start: false })
    pads[0] = pad([9])
    expect(controls.poll().start).toBe(true)
    controls.destroy()
  })

  it('forgets keys held when the window loses focus', () => {
    const { controls, key } = setup()
    const target = (controls as unknown as { target: EventTarget }).target
    key('keydown', 'KeyA')
    target.dispatchEvent(new Event('blur'))
    expect(controls.poll().direction).toBeNull()
    controls.destroy()
  })

  it('covers every action in the defaults', () => {
    for (const action of ACTIONS) {
      expect(DEFAULT_BINDINGS.keys[action].length).toBeGreaterThan(0)
      expect(DEFAULT_BINDINGS.buttons[action]).not.toBeNull()
    }
  })
})
