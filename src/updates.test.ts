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
  network,
  parseProgress,
  parseRelease,
  partialBytes,
  pauseUpdate,
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
  let progress: ((p: unknown) => void) | undefined
  const fake = {
    info: vi.fn(async () => ({ build: 5, name: '5-abc' })),
    fetchText: vi.fn(async () => ({ text: '{"build":7,"commit":"0123abc"}' })),
    download: vi.fn(async () => {
      progress?.({ done: 500, total: 1000 })
      // Events that are not sound are dropped.
      progress?.({ done: -1, total: 1000 })
      progress?.({ done: 'all', total: 1000 })
      progress?.({ done: 1000, total: 1000 })
      state.cached = 7
    }),
    pauseDownload: vi.fn(async () => {}),
    partial: vi.fn(async () => ({ bytes: 0 })),
    network: vi.fn(async () => ({ online: true, metered: false, cellular: false })),
    downloaded: vi.fn(async () => ({ build: state.cached })),
    canInstall: vi.fn(async () => ({ allowed: state.allowed })),
    install: vi.fn(async () => {
      if (!state.allowed) throw Object.assign(new Error('not allowed'), { code: 'permission' })
    }),
    addListener: vi.fn(async (_: string, listener: (p: unknown) => void) => {
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
    expect(parseRelease({ build: 7, commit: '0123abc' })).toEqual({
      build: 7,
      commit: '0123abc',
      size: null,
    })
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

  it('takes the size if it is sound, and goes without it if not', () => {
    expect(parseRelease({ build: 7, commit: '0123abc', size: 12_345_678 })?.size).toBe(12_345_678)
    for (const size of [0, -5, 1.5, '12', 1e12, null]) {
      expect(parseRelease({ build: 7, commit: '0123abc', size })).toEqual({
        build: 7,
        commit: '0123abc',
        size: null,
      })
    }
  })
})

describe('availableUpdate', () => {
  it('finds a newer build in the release', async () => {
    const { fake, calls } = updater()
    expect(await availableUpdate(fake)).toEqual({ build: 7, commit: '0123abc', size: null })
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

const release = { build: 7, commit: '0123abc', size: null }

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
    const progress: unknown[] = []
    expect(await installUpdate(release, (p) => progress.push(p), fake)).toBe('installing')
    expect(calls.download).toHaveBeenCalledWith({ url: `${RELEASE}spark-hunt.apk`, build: 7 })
    expect(calls.install).toHaveBeenCalledOnce()
    expect(progress).toEqual([
      { done: 500, total: 1000 },
      { done: 1000, total: 1000 },
    ])
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

  it('stops when paused, and goes on with the same build when asked again', async () => {
    const state = { cached: -1, allowed: true }
    let paused = true
    const { fake, calls } = updater(
      {
        download: vi.fn(async () => {
          if (paused) throw Object.assign(new Error('Paused'), { code: 'paused' })
          state.cached = 7
        }),
      },
      state,
    )
    expect(await installUpdate(release, () => {}, fake)).toBe('paused')
    expect(calls.install).not.toHaveBeenCalled()
    paused = false
    expect(await installUpdate(release, () => {}, fake)).toBe('installing')
    expect(calls.download).toHaveBeenCalledTimes(2)
    await pauseUpdate(fake)
    expect(calls.pauseDownload).toHaveBeenCalledOnce()
  })

  it('says how much an earlier download left, and what the connection costs', async () => {
    const { fake } = updater({ partial: async () => ({ bytes: 4096 }) })
    expect(await partialBytes(release, fake)).toBe(4096)
    expect(
      await partialBytes(release, updater({ partial: async () => ({ bytes: -3 }) }).fake),
    ).toBe(0)
    const failing = updater({
      partial: async () => {
        throw new Error('no')
      },
      network: async () => {
        throw new Error('no')
      },
    }).fake
    expect(await partialBytes(release, failing)).toBe(0)
    // Where Android cannot say, the dialog does not warn.
    expect(await network(failing)).toEqual({ online: true, metered: false, cellular: false })
    const mobile = updater({
      network: async () => ({ online: true, metered: true, cellular: true }),
    }).fake
    expect(await network(mobile)).toEqual({ online: true, metered: true, cellular: true })
  })

  it('reads only sound progress events', () => {
    expect(parseProgress({ done: 5, total: -1 })).toEqual({ done: 5, total: -1 })
    for (const value of [null, {}, { done: 1.5, total: 2 }, { done: 1, total: -2 }, 'x']) {
      expect(parseProgress(value)).toBeUndefined()
    }
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
    expect(first.offer).toHaveBeenCalledWith({ build: 7, commit: '0123abc', size: null })
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

describe('formatBytes', () => {
  it('gives megabytes with one decimal, none from 100 on', async () => {
    const { formatBytes } = await import('./ui/updates')
    expect(formatBytes(12_600_000)).toBe('12.6 MB')
    expect(formatBytes(400_000)).toBe('0.4 MB')
    expect(formatBytes(128_400_000)).toBe('128 MB')
  })
})
