import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Loaded once: these read storage when called, so they need no fresh copy per test.
import { HostSession } from './session/host'
import { hostedGame } from './session/saved'

/** The browser's local storage, in memory; `full` makes every write fail, as a full disk does. */
class MemoryStorage {
  readonly items = new Map<string, string>()
  full = false
  getItem(key: string) {
    return this.items.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.full) throw new DOMException('full', 'QuotaExceededError')
    this.items.set(key, String(value))
  }
  removeItem(key: string) {
    this.items.delete(key)
  }
  get length() {
    return this.items.size
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null
  }
}

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  // Object.keys(localStorage) lists the stored keys in browsers; a proxy does the same here.
  vi.stubGlobal(
    'localStorage',
    new Proxy(storage, {
      ownKeys: (target) => [...target.items.keys()],
      getOwnPropertyDescriptor: (target, key) =>
        typeof key === 'string' && target.items.has(key)
          ? { enumerable: true, configurable: true, value: target.items.get(key) }
          : undefined,
    }),
  )
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('storage', () => {
  it('keeps values under the game’s own prefix, and clears only those', async () => {
    const { clearAll, readJson, readText, remove, writeJson } = await import('./storage')
    writeJson('a', { n: 1 })
    storage.setItem('other-site', 'keep')
    expect(readJson('a')).toEqual({ n: 1 })
    expect(storage.getItem('vibe-p2pgame:a')).toBe('{"n":1}')
    expect(readText('a')).toBe('{"n":1}')
    remove('a')
    expect(readJson('a')).toBeUndefined()
    writeJson('b', 2)
    clearAll()
    expect([...storage.items.keys()]).toEqual(['other-site'])
  })

  it('never throws: broken values read as nothing, failed writes are dropped', async () => {
    const { readJson, writeJson } = await import('./storage')
    storage.setItem('vibe-p2pgame:broken', '{not json')
    expect(readJson('broken')).toBeUndefined()
    storage.full = true
    expect(() => writeJson('x', 1)).not.toThrow()
    vi.stubGlobal('localStorage', undefined)
    expect(readJson('x')).toBeUndefined()
  })
})

describe('settings', () => {
  it('come back after a reload, and changes merge', async () => {
    const first = await import('./settings')
    first.updateSettings({ name: 'Ada', vibration: false })
    first.updateCamera({ zoom: 2 })
    first.updateCamera({ exposure: -1 })
    vi.resetModules()
    const again = await import('./settings')
    expect(again.settings()).toMatchObject({
      name: 'Ada',
      vibration: false,
      camera: { deviceId: null, zoom: 2, exposure: -1 },
    })
  })

  it('take over the name stored before there were settings', async () => {
    storage.setItem('vibe-p2pgame:name', 'Old Name')
    const { settings } = await import('./settings')
    expect(settings().name).toBe('Old Name')
  })

  it('start over once forgotten', async () => {
    const { forgetSettings, settings, updateSettings } = await import('./settings')
    const { clearAll } = await import('./storage')
    updateSettings({ name: 'Ada' })
    clearAll()
    forgetSettings()
    expect(settings().name).toBe('')
  })
})

describe('saved games', () => {
  it('keep one player token per browser, and replace a broken one', async () => {
    const { playerToken } = await import('./session/saved')
    const token = playerToken()
    expect(token).toMatch(/^[0-9a-f]{24}$/)
    expect(playerToken()).toBe(token)
    storage.setItem('vibe-p2pgame:token', '"short"')
    expect(playerToken()).not.toBe('short')
  })

  it('remember the game joined last, until it is forgotten', async () => {
    const { forgetJoinedGame, joinedGame, rememberJoinedGame } = await import('./session/saved')
    expect(joinedGame()).toBeNull()
    rememberJoinedGame('Hosty')
    expect(joinedGame()?.host).toBe('Hosty')
    forgetJoinedGame()
    expect(joinedGame()).toBeNull()
  })

  it('let a host carry on with its players and scores', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'],
    })
    try {
      const host = new HostSession('Hosty', {
        savedAt: Date.now(),
        hostScore: 4,
        nextId: 3,
        players: [{ token: 'token-aaaaaaaa', id: 2, name: 'Bo', score: 6 }],
      })
      expect(host.world.players).toMatchObject([{ id: 0, score: 4 }])
      expect(host.snapshot().away).toMatchObject([{ id: 2, name: 'Bo' }])
      await vi.advanceTimersByTimeAsync(3000)
      // A spark may land on the host's dot meanwhile, so the score saved is the current one.
      expect(hostedGame()).toMatchObject({
        hostScore: host.world.players[0]?.score,
        nextId: 3,
        players: [{ id: 2, score: 6 }],
      })
      host.close(false)
      expect(hostedGame()).not.toBeNull()
      const ended = new HostSession('Hosty', hostedGame())
      ended.close(true)
      expect(hostedGame()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('texts', () => {
  it('fill in their placeholders, in the language chosen', async () => {
    const { currentLanguage, setLanguage, t } = await import('./i18n')
    setLanguage('en')
    expect(t('connected', { name: 'Ada' })).toBe('Ada joined.')
    expect(t('connected')).toBe(' joined.')
    setLanguage('de')
    expect(currentLanguage()).toBe('de')
    expect(t('connected', { name: 'Ada' })).toBe('Ada spielt mit.')
    setLanguage('auto')
    expect(['en', 'de']).toContain(currentLanguage())
  })
})
