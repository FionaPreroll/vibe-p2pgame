/**
 * Steering with keys, a game controller or the joystick on the screen, besides touching the
 * arena. Keys are bound by their place on the keyboard (`KeyboardEvent.code`), so WASD stays
 * WASD on every layout; controller buttons by their index in the standard mapping. Players
 * change both in the settings.
 */

export const ACTIONS = ['up', 'down', 'left', 'right', 'start'] as const
export type Action = (typeof ACTIONS)[number]

/** Keys per action, at most two each. */
export const KEYS_PER_ACTION = 2

export interface Bindings {
  readonly keys: Readonly<Record<Action, readonly string[]>>
  /** One controller button per action, or null for none. */
  readonly buttons: Readonly<Record<Action, number | null>>
}

export const DEFAULT_BINDINGS: Bindings = {
  keys: {
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    start: ['Enter', 'Space'],
  },
  // The standard mapping: the D-pad is 12 to 15, Start is 9.
  buttons: { up: 12, down: 13, left: 14, right: 15, start: 9 },
}

/** The controllers' sticks ignore this much tilt, as worn sticks never quite rest at 0. */
export const DEADZONE = 0.2
const MAX_BUTTON = 31

const DIRECTIONS: Record<Exclude<Action, 'start'>, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

/** A direction to steer in, at most 1 long, or null to let go. */
export type Direction = { readonly x: number; readonly y: number } | null

/**
 * Stored bindings, checked: every action keeps its keys and button if they are valid, and
 * falls back to its defaults if not. A key or button bound twice stays with the first action.
 */
export function parseBindings(value: unknown): Bindings {
  const stored = isObject(value) ? value : {}
  const keys = isObject(stored.keys) ? stored.keys : {}
  const buttons = isObject(stored.buttons) ? stored.buttons : {}
  const usedKeys = new Set<string>()
  const usedButtons = new Set<number>()
  const parsedKeys = {} as Record<Action, string[]>
  const parsedButtons = {} as Record<Action, number | null>
  for (const action of ACTIONS) {
    const list = keys[action]
    const valid =
      Array.isArray(list) &&
      list.length <= KEYS_PER_ACTION &&
      list.every((key) => typeof key === 'string' && isKeyCode(key))
    parsedKeys[action] = ((valid ? list : DEFAULT_BINDINGS.keys[action]) as string[]).filter(
      (key) => !usedKeys.has(key) && usedKeys.add(key),
    )
    const button = buttons[action]
    const chosen =
      button === null ||
      (typeof button === 'number' &&
        Number.isInteger(button) &&
        button >= 0 &&
        button <= MAX_BUTTON)
        ? button
        : DEFAULT_BINDINGS.buttons[action]
    parsedButtons[action] = chosen === null || usedButtons.has(chosen) ? null : chosen
    if (chosen !== null) usedButtons.add(chosen)
  }
  return { keys: parsedKeys, buttons: parsedButtons }
}

/** A key code as browsers name them: letters, digits and words, such as `KeyW` or `Numpad8`. */
function isKeyCode(key: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]{0,23}$/.test(key)
}

/**
 * Binds a key to an action, in slot 0 or 1: the key leaves any other action it was bound to,
 * and null empties the slot.
 */
export function bindKey(
  bindings: Bindings,
  action: Action,
  slot: number,
  key: string | null,
): Bindings {
  const keys = {} as Record<Action, string[]>
  for (const a of ACTIONS) keys[a] = bindings.keys[a].filter((k) => k !== key)
  const own = [...bindings.keys[action]]
  if (key === null) own.splice(slot, 1)
  else own[Math.min(slot, own.length)] = key
  keys[action] = own.filter((k, i) => k !== undefined && own.indexOf(k) === i)
  return { keys, buttons: bindings.buttons }
}

/** Binds a controller button to an action, taking it from any other; null for none. */
export function bindButton(bindings: Bindings, action: Action, button: number | null): Bindings {
  const buttons = {} as Record<Action, number | null>
  for (const a of ACTIONS) buttons[a] = bindings.buttons[a] === button ? null : bindings.buttons[a]
  buttons[action] = button
  return { keys: bindings.keys, buttons }
}

/** The action a key is bound to, if any. */
export function actionOfKey(bindings: Bindings, key: string): Action | undefined {
  return ACTIONS.find((action) => bindings.keys[action].includes(key))
}

/** A key's name for players: `KeyW` is W, `ArrowUp` an arrow. */
export function keyLabel(code: string): string {
  const arrows: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  }
  return (
    arrows[code] ??
    code
      .replace(/^Key([A-Z])$/, '$1')
      .replace(/^Digit(\d)$/, '$1')
      .replace(/^Numpad/, 'Num ')
  )
}

const BUTTON_NAMES = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'Select',
  'Start',
  'L3',
  'R3',
  'D-pad ↑',
  'D-pad ↓',
  'D-pad ←',
  'D-pad →',
  'Home',
]

/** A controller button's name in the standard mapping. */
export function buttonLabel(button: number): string {
  return BUTTON_NAMES[button] ?? `#${button}`
}

/**
 * The direction from the actions held down and a stick: the stick wins when it is tilted past
 * the dead zone, as it is the finer of the two.
 */
export function direction(
  held: ReadonlySet<Action>,
  stick: readonly [number, number] | null,
): Direction {
  if (stick) {
    const [x, y] = stick
    const length = Math.hypot(x, y)
    if (Number.isFinite(length) && length > DEADZONE) {
      // Past the dead zone, from 0 up to 1, so a slight tilt steers slightly.
      const scale = Math.min(1, (length - DEADZONE) / (1 - DEADZONE)) / length
      return { x: x * scale, y: y * scale }
    }
  }
  let x = 0
  let y = 0
  for (const action of held) {
    if (action === 'start') continue
    x += DIRECTIONS[action][0]
    y += DIRECTIONS[action][1]
  }
  const length = Math.hypot(x, y)
  return length === 0 ? null : { x: x / length, y: y / length }
}

/** What a controller holds down, by the bindings, and its left stick. */
export function readGamepad(
  pad: Pick<Gamepad, 'buttons' | 'axes'>,
  bindings: Bindings,
): { held: Set<Action>; stick: [number, number] | null } {
  const held = new Set<Action>()
  for (const action of ACTIONS) {
    const button = bindings.buttons[action]
    if (button !== null && pad.buttons[button]?.pressed) held.add(action)
  }
  const [x, y] = pad.axes
  return { held, stick: typeof x === 'number' && typeof y === 'number' ? [x, y] : null }
}

/**
 * Keys and controllers together: `poll` once a frame gives the direction to steer in, and
 * whether `start` was pressed since the last poll.
 */
export class Controls {
  private readonly keysHeld = new Set<Action>()
  private startPressed = false
  private padStartWasDown = false
  private readonly onKey = (event: KeyboardEvent) => {
    const target = event.target
    if (
      typeof HTMLElement !== 'undefined' &&
      target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    ) {
      return
    }
    const action = actionOfKey(this.bindings(), event.code)
    if (action === undefined) return
    event.preventDefault()
    if (event.type === 'keydown') {
      if (action === 'start' && !event.repeat) this.startPressed = true
      this.keysHeld.add(action)
    } else {
      this.keysHeld.delete(action)
    }
  }
  private readonly onBlur = () => this.keysHeld.clear()

  constructor(
    private readonly bindings: () => Bindings,
    private readonly target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
    private readonly gamepads: () => readonly (Gamepad | null)[] = () =>
      typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [],
  ) {
    target.addEventListener('keydown', this.onKey)
    target.addEventListener('keyup', this.onKey)
    target.addEventListener('blur', this.onBlur)
  }

  poll(): { direction: Direction; start: boolean } {
    const held = new Set(this.keysHeld)
    let stick: [number, number] | null = null
    let padStart = false
    for (const pad of this.gamepads()) {
      if (!pad?.connected) continue
      const read = readGamepad(pad, this.bindings())
      for (const action of read.held) held.add(action)
      if (read.held.has('start')) padStart = true
      // The first stick tilted past the dead zone steers.
      if (stick === null && read.stick && Math.hypot(...read.stick) > DEADZONE) stick = read.stick
    }
    const start = this.startPressed || (padStart && !this.padStartWasDown)
    this.startPressed = false
    this.padStartWasDown = padStart
    return { direction: direction(held, stick), start }
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.onKey)
    this.target.removeEventListener('keyup', this.onKey)
    this.target.removeEventListener('blur', this.onBlur)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
