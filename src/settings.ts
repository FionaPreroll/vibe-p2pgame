import { type Bindings, DEFAULT_BINDINGS, parseBindings } from './input'
import { readJson, readText, writeJson } from './storage'

/** What a player sets once and finds again next time, in this browser. */
export interface Settings {
  /** Empty until the player has chosen one: a default name is made then. */
  readonly name: string
  readonly language: 'auto' | 'en' | 'de'
  readonly vibration: boolean
  /** Keeps the screen on during a game, where the browser can. */
  readonly keepScreenOn: boolean
  /** Used when this phone hosts. */
  readonly roundSeconds: number
  /** The camera that last read a code, and its zoom and brightness. */
  readonly camera: CameraSettings
  /** In the Android app: look for a new version at every start (see src/updates.ts). */
  readonly checkUpdates: boolean
  /** Whether the app has asked about `checkUpdates` yet, which it does once, at the first start. */
  readonly updatesAsked: boolean
  /** A joystick on the screen beside the arena, on this side, or none. */
  readonly joystick: JoystickSide
  /** Keys and controller buttons (see src/input.ts). */
  readonly bindings: Bindings
  /** The small graph of the connection while playing. */
  readonly netGraph: boolean
}

export type JoystickSide = 'off' | 'left' | 'right'
export const JOYSTICK_CHOICES: readonly JoystickSide[] = ['off', 'left', 'right']

export interface CameraSettings {
  readonly deviceId: string | null
  readonly zoom: number | null
  readonly exposure: number | null
}

export const ROUND_CHOICES = [30, 60, 90, 120] as const
const KEY = 'settings'
/** Where the name lived before there were settings. */
const OLD_NAME_KEY = 'name'

export const DEFAULTS: Settings = {
  name: '',
  language: 'auto',
  vibration: true,
  keepScreenOn: true,
  roundSeconds: 60,
  camera: { deviceId: null, zoom: null, exposure: null },
  checkUpdates: false,
  updatesAsked: false,
  joystick: 'off',
  bindings: DEFAULT_BINDINGS,
  netGraph: true,
}

/**
 * Reads stored settings, keeping each value only if it is valid: a value from an older or
 * newer version of the game, or a hand-edited one, falls back to its default on its own.
 */
export function parseSettings(stored: unknown, oldName?: unknown): Settings {
  const s = isObject(stored) ? stored : {}
  const camera = isObject(s.camera) ? s.camera : {}
  const name = typeof s.name === 'string' ? s.name : typeof oldName === 'string' ? oldName : ''
  return {
    name: name.slice(0, 16),
    language: s.language === 'en' || s.language === 'de' ? s.language : DEFAULTS.language,
    vibration: typeof s.vibration === 'boolean' ? s.vibration : DEFAULTS.vibration,
    keepScreenOn: typeof s.keepScreenOn === 'boolean' ? s.keepScreenOn : DEFAULTS.keepScreenOn,
    roundSeconds: (ROUND_CHOICES as readonly unknown[]).includes(s.roundSeconds)
      ? (s.roundSeconds as number)
      : DEFAULTS.roundSeconds,
    camera: {
      deviceId: typeof camera.deviceId === 'string' ? camera.deviceId : null,
      zoom: finite(camera.zoom),
      exposure: finite(camera.exposure),
    },
    checkUpdates: s.checkUpdates === true,
    updatesAsked: s.updatesAsked === true,
    joystick: (JOYSTICK_CHOICES as readonly unknown[]).includes(s.joystick)
      ? (s.joystick as JoystickSide)
      : DEFAULTS.joystick,
    bindings: s.bindings === undefined ? DEFAULT_BINDINGS : parseBindings(s.bindings),
    netGraph: typeof s.netGraph === 'boolean' ? s.netGraph : DEFAULTS.netGraph,
  }
}

let current: Settings | undefined

export function settings(): Settings {
  current ??= parseSettings(readJson(KEY), readText(OLD_NAME_KEY))
  return current
}

/** Changes some settings and stores them at once. */
export function updateSettings(change: Partial<Settings>): Settings {
  current = { ...settings(), ...change }
  writeJson(KEY, current)
  return current
}

export function updateCamera(change: Partial<CameraSettings>): void {
  updateSettings({ camera: { ...settings().camera, ...change } })
}

/** After all stored data has been cleared. */
export function forgetSettings(): void {
  current = undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
