import { describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }))

const { AppUpdates, parseInstallEvent, parseProgress, parseRelease, updateOnStart } = await import(
  './index.ts'
)
const { FakeUpdater } = await import('./testing.ts')

const RELEASES = 'https://github.com/example/game/releases/latest/download/'
const release = { build: 7, commit: '0123abc', size: null }

/** The app installed is build 5, the release build 7. */
function setup(change: (fake: InstanceType<typeof FakeUpdater>) => void = () => {}) {
  const fake = new FakeUpdater()
  fake.autoFinish = true
  change(fake)
  const lines: string[] = []
  const updates = new AppUpdates(
    { releases: RELEASES, apk: 'game.apk', log: (line) => lines.push(line) },
    fake,
  )
  return { fake, updates, lines }
}

describe('AppUpdates', () => {
  it('wants an HTTPS address of releases and an APK’s file name', () => {
    const fake = new FakeUpdater()
    expect(() => new AppUpdates({ releases: 'http://example.com/', apk: 'a.apk' }, fake)).toThrow()
    expect(() => new AppUpdates({ releases: RELEASES.slice(0, -1), apk: 'a.apk' }, fake)).toThrow()
    expect(() => new AppUpdates({ releases: RELEASES, apk: '../a.apk' }, fake)).toThrow()
    expect(() => new AppUpdates({ releases: RELEASES, apk: 'a.zip' }, fake)).toThrow()
  })

  it('says which build is installed, if the native side can', async () => {
    expect(await setup().updates.installed()).toEqual({ build: 5, name: '5-test' })
    const broken = setup((fake) => {
      fake.info = async () => {
        throw new Error('no')
      }
    })
    expect(await broken.updates.installed()).toBeNull()
  })
})

describe('parseRelease', () => {
  it('takes a whole build number and a commit hash, and nothing else', () => {
    expect(parseRelease({ build: 7, commit: '0123abc' })).toEqual(release)
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
      expect(parseRelease({ build: 7, commit: '0123abc', size })).toEqual(release)
    }
  })
})

describe('check', () => {
  it('says whether there is a newer build, the app is up to date, or it could not look', async () => {
    const { updates, fake, lines } = setup()
    expect(await updates.check()).toEqual({ kind: 'newer', release, installed: 5 })
    expect(fake.calls).toContainEqual({
      method: 'fetchText',
      options: { url: `${RELEASES}version.json` },
    })
    expect(lines).toEqual(['installed build 5, release build 7'])
    fake.installedBuild = 7
    expect(await updates.check()).toEqual({ kind: 'current', installed: 7 })
    fake.installedBuild = 8
    expect(await updates.available()).toBeNull()

    for (const broken of [new Error('offline'), 'not json', '{"build":"99"}']) {
      fake.release = broken
      expect(await updates.check()).toEqual({ kind: 'failed' })
      expect(await updates.available()).toBeNull()
    }
  })
})

describe('install', () => {
  it('downloads the APK, tells the progress and hands it to the installer', async () => {
    const { updates, fake } = setup()
    const progress: unknown[] = []
    expect(await updates.install(release, (p) => progress.push(p))).toBe('installing')
    expect(fake.calls).toContainEqual({
      method: 'download',
      options: { url: `${RELEASES}game.apk`, build: 7 },
    })
    expect(fake.count('install')).toBe(1)
    expect(progress).toEqual([
      { done: 500, total: 1000 },
      { done: 1000, total: 1000 },
    ])
    expect(fake.listening('progress')).toBe(0)
  })

  it('reads only sound progress events', async () => {
    const { updates, fake } = setup((fake) => {
      fake.autoFinish = false
    })
    const progress: unknown[] = []
    const running = updates.install(release, (p) => progress.push(p))
    await vi.waitFor(() => expect(fake.count('download')).toBe(1))
    fake.progress(-1, 1000)
    fake.progress('all', 1000)
    fake.progress(5, -2)
    fake.progress(5, -1)
    fake.finish(7)
    expect(await running).toBe('installing')
    expect(progress).toEqual([{ done: 5, total: -1 }])
    expect(parseProgress({ done: 1.5, total: 2 })).toBeUndefined()
  })

  it('does not download again what is already here', async () => {
    const { updates, fake } = setup((fake) => {
      fake.cached = 7
    })
    expect(await updates.install(release, () => {})).toBe('installing')
    expect(fake.count('download')).toBe(0)
  })

  it('installs nothing that is not the release', async () => {
    const { updates, fake } = setup((fake) => {
      fake.cached = 6
      const download = fake.download.bind(fake)
      fake.download = async (options) => download({ ...options, build: 8 })
    })
    expect(await updates.install(release, () => {})).toBe('failed')
    expect(fake.count('download')).toBe(1)
    expect(fake.count('install')).toBe(0)
  })

  it('waits for the right to install apps, then goes on without downloading again', async () => {
    const { updates, fake } = setup((fake) => {
      fake.allowed = false
    })
    expect(await updates.install(release, () => {})).toBe('permission')
    expect(fake.count('download')).toBe(1)
    // Back from the setting, still not allowed: nothing more happens.
    expect(await updates.continueInstall()).toBe('permission')
    expect(fake.count('install')).toBe(1)
    fake.allowed = true
    expect(await updates.continueInstall()).toBe('installing')
    // Tapping Install again also goes on from the file already here.
    expect(await updates.install(release, () => {})).toBe('installing')
    expect(fake.count('download')).toBe(1)
  })

  it('stops when paused, and goes on with the same build when asked again', async () => {
    const { updates, fake } = setup((fake) => {
      fake.autoFinish = false
    })
    const first = updates.install(release, () => {})
    await vi.waitFor(() => expect(fake.count('download')).toBe(1))
    await updates.pause()
    expect(await first).toBe('paused')
    expect(fake.count('install')).toBe(0)
    fake.autoFinish = true
    expect(await updates.install(release, () => {})).toBe('installing')
    expect(fake.count('download')).toBe(2)
  })

  it('says when the download fails, and installs nothing', async () => {
    const { updates, fake, lines } = setup((fake) => {
      fake.autoFinish = false
    })
    const running = updates.install(release, () => {})
    await vi.waitFor(() => expect(fake.count('download')).toBe(1))
    fake.fail(Object.assign(new Error('offline'), { code: 'io' }))
    expect(await running).toBe('failed')
    expect(fake.count('install')).toBe(0)
    expect(fake.listening('progress')).toBe(0)
    expect(lines).toContain('download failed: io: offline')
  })

  it('says how much an earlier download left, and what the connection costs', async () => {
    const { updates, fake } = setup((fake) => {
      fake.partialBytes = 4096
    })
    expect(await updates.partialBytes(release)).toBe(4096)
    fake.partialBytes = -3
    expect(await updates.partialBytes(release)).toBe(0)
    fake.partial = async () => {
      throw new Error('no')
    }
    fake.network = async () => {
      throw new Error('no')
    }
    expect(await updates.partialBytes(release)).toBe(0)
    // Where Android cannot say, the dialog does not warn.
    expect(await updates.network()).toEqual({ online: true, metered: false, cellular: false })
    fake.network = async () => ({ online: true, metered: true, cellular: true })
    expect(await updates.network()).toEqual({ online: true, metered: true, cellular: true })
  })
})

describe('the installer’s answers', () => {
  it('are read only when sound', () => {
    expect(parseInstallEvent({ status: 'confirm' })).toEqual({ status: 'confirm', message: '' })
    expect(
      parseInstallEvent({ status: 'failure', message: 'x'.repeat(500) })?.message,
    ).toHaveLength(200)
    for (const value of [null, 'success', { status: 'done' }, { status: 1 }]) {
      expect(parseInstallEvent(value)).toBeUndefined()
    }
  })

  it('reach the listener, and stop when it stops listening', async () => {
    const { updates, fake, lines } = setup()
    const heard: string[] = []
    const stop = await updates.onInstallEvent((event) => heard.push(event.status))
    fake.installer('confirm')
    fake.installer('nonsense')
    fake.installer('aborted', 'User cancelled')
    expect(heard).toEqual(['confirm', 'aborted'])
    expect(lines).toEqual(['installer: confirm', 'installer: aborted (User cancelled)'])
    stop()
    await vi.waitFor(() => expect(fake.listening('install')).toBe(0))
  })
})

describe('updateOnStart', () => {
  function choice(start: { asked: boolean; enabled: boolean }) {
    const state = { ...start }
    return {
      state,
      choice: {
        asked: () => state.asked,
        enabled: () => state.enabled,
        answer: (yes: boolean) => {
          state.asked = true
          state.enabled = yes
        },
      },
    }
  }
  const dialogs = (answer: boolean) => ({ ask: vi.fn(async () => answer), offer: vi.fn() })

  it('asks once at the first start, and looks only if the player says yes', async () => {
    const { updates } = setup()
    const first = choice({ asked: false, enabled: false })
    const yes = dialogs(true)
    await updateOnStart(updates, first.choice, yes)
    expect(yes.ask).toHaveBeenCalledOnce()
    expect(yes.offer).toHaveBeenCalledWith(release)
    expect(first.state).toEqual({ asked: true, enabled: true })

    const next = dialogs(true)
    await updateOnStart(updates, first.choice, next)
    expect(next.ask).not.toHaveBeenCalled()
    expect(next.offer).toHaveBeenCalledOnce()
  })

  it('stays off when the player says no', async () => {
    const { updates, fake } = setup()
    const first = choice({ asked: false, enabled: false })
    const no = dialogs(false)
    await updateOnStart(updates, first.choice, no)
    expect(no.offer).not.toHaveBeenCalled()
    expect(fake.count('fetchText')).toBe(0)
    expect(first.state).toEqual({ asked: true, enabled: false })
  })

  it('offers nothing when the app is up to date', async () => {
    const { updates } = setup((fake) => {
      fake.installedBuild = 7
    })
    const up = dialogs(true)
    await updateOnStart(updates, choice({ asked: true, enabled: true }).choice, up)
    expect(up.ask).not.toHaveBeenCalled()
    expect(up.offer).not.toHaveBeenCalled()
  })
})
