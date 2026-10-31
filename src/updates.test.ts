import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ app: true }))
vi.mock('./native', () => ({ isApp: () => native.app }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }))

const { forgetSettings, settings, updateSettings } = await import('./settings')
const {
  availableUpdate,
  checkForUpdate,
  continueInstall,
  installUpdate,
  parseRelease,
  RELEASE,
  updateOnStart,
} = await import('./updates')
type Updater = import('./updates').Updater

/**
 * The native side, played by the test: installed build 5, release build 7. A download leaves
 * build 7 in the cache; installing needs `allowed`, as Android's setting does.
 */
function updater(
  overrides: Partial<Record<keyof Updater, unknown>> = {},
  state = { cached: -1, allowed: true },
) {
  const remove = vi.fn(async () => {})
  let progress: ((p: { percent: number }) => void) | undefined
  const fake = {
    info: vi.fn(async () => ({ build: 5, name: '5-abc' })),
    fetchText: vi.fn(async () => ({ text: '{"build":7,"commit":"0123abc"}' })),
    download: vi.fn(async () => {
      progress?.({ percent: 50 })
      progress?.({ percent: 100 })
      state.cached = 7
    }),
    downloaded: vi.fn(async () => ({ build: state.cached })),
    canInstall: vi.fn(async () => ({ allowed: state.allowed })),
    install: vi.fn(async () => {
      if (!state.allowed) throw Object.assign(new Error('not allowed'), { code: 'permission' })
    }),
    addListener: vi.fn(async (_: string, listener: (p: { percent: number }) => void) => {
      progress = listener
      return { remove }
    }),
    ...overrides,
  }
  return { fake: fake as unknown as Updater, calls: fake, remove }
}

beforeEach(() => {
  native.app = true
  forgetSettings()
  vi.stubGlobal('localStorage', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseRelease', () => {
  it('takes a whole build number and a commit hash, and nothing else', () => {
    expect(parseRelease({ build: 7, commit: '0123abc' })).toEqual({ build: 7, commit: '0123abc' })
    for (const value of [
      null,
      'x',
      { build: 0, commit: '0123abc' },
      { build: 1.5, commit: '0123abc' },
      { build: '7', commit: '0123abc' },
      { build: 7, commit: 'not a hash' },
      { build: 7 },
    ]) {
      expect(parseRelease(value)).toBeUndefined()
    }
  })
})

describe('availableUpdate', () => {
  it('finds a newer build in the release', async () => {
    const { fake, calls } = updater()
    expect(await availableUpdate(fake)).toEqual({ build: 7, commit: '0123abc' })
    expect(calls.fetchText).toHaveBeenCalledWith({ url: `${RELEASE}version.json` })
  })

  it('offers nothing for the same or an older build', async () => {
    for (const build of [5, 4]) {
      const { fake } = updater({
        fetchText: async () => ({ text: `{"build":${build},"commit":"0123abc"}` }),
      })
      expect(await availableUpdate(fake)).toBeNull()
    }
  })

  it('offers nothing without internet or with a broken release, so the game starts as usual', async () => {
    for (const fetchText of [
      async () => {
        throw new Error('offline')
      },
      async () => ({ text: 'not json' }),
      async () => ({ text: '{"build":"99"}' }),
    ]) {
      expect(await availableUpdate(updater({ fetchText }).fake)).toBeNull()
    }
  })
})

const release = { build: 7, commit: '0123abc' }

describe('checkForUpdate', () => {
  it('says whether there is a newer build, the app is up to date, or it could not look', async () => {
    expect(await checkForUpdate(updater().fake)).toEqual({ kind: 'newer', release, installed: 5 })
    const current = updater({ info: async () => ({ build: 7, name: '7' }) }).fake
    expect(await checkForUpdate(current)).toEqual({ kind: 'current', installed: 7 })
    const offline = updater({
      fetchText: async () => {
        throw new Error('offline')
      },
    }).fake
    expect(await checkForUpdate(offline)).toEqual({ kind: 'failed' })
    const broken = updater({ fetchText: async () => ({ text: '{"build":"x"}' }) }).fake
    expect(await checkForUpdate(broken)).toEqual({ kind: 'failed' })
  })
})

describe('installUpdate', () => {
  it('downloads the APK, tells the progress and hands it to the installer', async () => {
    const { fake, calls, remove } = updater()
    const progress: number[] = []
    expect(await installUpdate(release, (p) => progress.push(p), fake)).toBe('installing')
    expect(calls.download).toHaveBeenCalledWith({ url: `${RELEASE}spark-hunt.apk` })
    expect(calls.install).toHaveBeenCalledOnce()
    expect(progress).toEqual([50, 100])
    expect(remove).toHaveBeenCalledOnce()
  })

  it('does not download again what is already here', async () => {
    const { fake, calls } = updater({}, { cached: 7, allowed: true })
    expect(await installUpdate(release, () => {}, fake)).toBe('installing')
    expect(calls.download).not.toHaveBeenCalled()
  })

  it('downloads again over an older file, and installs nothing that is not the release', async () => {
    const state = { cached: 6, allowed: true }
    const { fake, calls } = updater(
      {
        download: vi.fn(async () => {
          state.cached = 8
        }),
      },
      state,
    )
    expect(await installUpdate(release, () => {}, fake)).toBe('failed')
    expect(calls.download).toHaveBeenCalledOnce()
    expect(calls.install).not.toHaveBeenCalled()
  })

  it('waits for the right to install apps, then goes on without downloading again', async () => {
    const state = { cached: -1, allowed: false }
    const { fake, calls } = updater({}, state)
    expect(await installUpdate(release, () => {}, fake)).toBe('permission')
    expect(calls.download).toHaveBeenCalledOnce()
    // Back from the setting, still not allowed: nothing more happens, no setting opens again.
    expect(await continueInstall(fake)).toBe('permission')
    expect(calls.install).toHaveBeenCalledOnce()
    state.allowed = true
    expect(await continueInstall(fake)).toBe('installing')
    // Tapping Install again also goes on from the file already here.
    expect(await installUpdate(release, () => {}, fake)).toBe('installing')
    expect(calls.download).toHaveBeenCalledOnce()
  })

  it('says when the download fails, and installs nothing', async () => {
    const { fake, calls, remove } = updater({
      download: vi.fn(async () => {
        throw new Error('offline')
      }),
    })
    expect(await installUpdate(release, () => {}, fake)).toBe('failed')
    expect(calls.install).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledOnce()
  })
})

describe('updateOnStart', () => {
  const dialogs = (answer: boolean) => ({ ask: vi.fn(async () => answer), offer: vi.fn() })

  it('asks once at the first start, and looks only if the player says yes', async () => {
    const first = dialogs(true)
    await updateOnStart(first, updater().fake)
    expect(first.ask).toHaveBeenCalledOnce()
    expect(first.offer).toHaveBeenCalledWith({ build: 7, commit: '0123abc' })
    expect(settings()).toMatchObject({ checkUpdates: true, updatesAsked: true })

    const next = dialogs(true)
    await updateOnStart(next, updater().fake)
    expect(next.ask).not.toHaveBeenCalled()
    expect(next.offer).toHaveBeenCalledOnce()
  })

  it('stays off when the player says no, and does not ask again', async () => {
    const first = dialogs(false)
    const { fake, calls } = updater()
    await updateOnStart(first, fake)
    expect(first.offer).not.toHaveBeenCalled()
    expect(calls.fetchText).not.toHaveBeenCalled()
    expect(settings()).toMatchObject({ checkUpdates: false, updatesAsked: true })
    const next = dialogs(true)
    await updateOnStart(next, fake)
    expect(next.ask).not.toHaveBeenCalled()
    expect(calls.fetchText).not.toHaveBeenCalled()
  })

  it('follows the switch in the settings', async () => {
    updateSettings({ updatesAsked: true, checkUpdates: true })
    const on = dialogs(false)
    await updateOnStart(on, updater().fake)
    expect(on.ask).not.toHaveBeenCalled()
    expect(on.offer).toHaveBeenCalledOnce()
  })

  it('offers nothing when the app is up to date', async () => {
    updateSettings({ updatesAsked: true, checkUpdates: true })
    const up = dialogs(true)
    await updateOnStart(up, updater({ info: async () => ({ build: 7, name: '7' }) }).fake)
    expect(up.offer).not.toHaveBeenCalled()
  })

  it('does nothing at all in a browser', async () => {
    native.app = false
    const web = dialogs(true)
    const { fake, calls } = updater()
    await updateOnStart(web, fake)
    expect(web.ask).not.toHaveBeenCalled()
    expect(calls.info).not.toHaveBeenCalled()
    expect(settings().updatesAsked).toBe(false)
  })
})
