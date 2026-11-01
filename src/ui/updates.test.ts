// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// In the app, whose AppUpdater cannot reach a release here: looking for updates fails quietly.
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }))
vi.mock('../native', () => ({ isApp: () => true }))

const { handleBack, setBackAction } = await import('../back')
const { setLanguage } = await import('../i18n')
const { forgetSettings, settings } = await import('../settings')
const { formatBytes, offer, offerUpdates } = await import('./updates')
type Updater = import('../updates').Updater
type Network = import('../updates').Network

/**
 * The update dialog the Android app shows, played through with a fake AppUpdaterPlugin: what it
 * says before a download, while it runs, when it is paused, and what Android's installer answers.
 */

const MB = 1_000_000
const release = { build: 9, commit: 'abc1234', size: 20 * MB }

/** The native side, played by the test: the download runs until the test finishes or pauses it. */
function fakeUpdater(
  start: { partial?: number; cached?: number; network?: Partial<Network>; allowed?: boolean } = {},
) {
  const listeners = new Map<string, (value: unknown) => void>()
  let finish: (() => void) | undefined
  let fail: ((error: unknown) => void) | undefined
  const state = { cached: start.cached ?? -1, allowed: start.allowed ?? true }
  const native = {
    pauseDownload: vi.fn(async () =>
      fail?.(Object.assign(new Error('paused'), { code: 'paused' })),
    ),
    partial: vi.fn(async () => ({ bytes: start.partial ?? 0 })),
    network: vi.fn(async () => ({
      online: true,
      metered: false,
      cellular: false,
      ...start.network,
    })),
    downloaded: vi.fn(async () => ({ build: state.cached })),
    canInstall: vi.fn(async () => ({ allowed: state.allowed })),
    install: vi.fn(async () => {
      if (!state.allowed) throw Object.assign(new Error('not allowed'), { code: 'permission' })
      return { way: 'session' }
    }),
    download: vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          finish = () => {
            state.cached = release.build
            resolve()
          }
          fail = reject
        }),
    ),
    addListener: vi.fn(async (event: string, listener: (value: unknown) => void) => {
      listeners.set(event, listener)
      return { remove: async () => void listeners.delete(event) }
    }),
  }
  return {
    updater: native as unknown as Updater,
    native,
    state,
    progress: (done: number, total = release.size) => listeners.get('progress')?.({ done, total }),
    installer: (status: string, message = '') => listeners.get('install')?.({ status, message }),
    finish: () => finish?.(),
    fail: (error: unknown) => fail?.(error),
  }
}

const dialog = () => document.querySelector<HTMLElement>('.modal.update')
const status = () => dialog()?.querySelector('.status')?.textContent
const note = () => dialog()?.querySelector('p:not(.status):not(.warning):nth-of-type(2)')
const warning = () => dialog()?.querySelector<HTMLElement>('.warning')
const bar = () => dialog()?.querySelector('progress')
function button(name: string): HTMLButtonElement {
  const found = [...(dialog()?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent === name && !b.hidden,
  )
  if (!found) throw new Error(`no visible button "${name}"`)
  return found
}
const buttons = () =>
  [...(dialog()?.querySelectorAll('button') ?? [])]
    .filter((b) => !b.hidden)
    .map((b) => b.textContent)
const settle = () => vi.advanceTimersByTimeAsync(0)

let visibility: DocumentVisibilityState = 'visible'
function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  setLanguage('en')
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  document.body.replaceChildren()
  // Dialogs of earlier tests are dropped from the back button's list.
  setBackAction(() => {})
  handleBack(() => {})
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the question at the first start', () => {
  async function answer(choice: 'Yes, look' | 'No' | 'back') {
    localStorage.clear()
    forgetSettings()
    const starting = offerUpdates()
    await settle()
    expect(dialog()?.textContent).toMatch(/updates/i)
    if (choice === 'back') handleBack(() => {})
    else button(choice).click()
    await starting
    expect(dialog()).toBeNull()
  }

  it('looks for updates at every start only if the player says yes', async () => {
    await answer('Yes, look')
    expect(settings()).toMatchObject({ checkUpdates: true, updatesAsked: true })
    await answer('No')
    expect(settings()).toMatchObject({ checkUpdates: false, updatesAsked: true })
    // Android's back button says no.
    await answer('back')
    expect(settings()).toMatchObject({ checkUpdates: false, updatesAsked: true })
  })

  it('is asked once', async () => {
    await answer('No')
    await offerUpdates()
    expect(dialog()).toBeNull()
  })
})

describe('formatBytes', () => {
  it('shows megabytes with one digit below 100, and none above', () => {
    expect(formatBytes(12_600_000)).toBe('12.6 MB')
    expect(formatBytes(128_400_000)).toBe('128 MB')
    expect(formatBytes(0)).toBe('0.0 MB')
    setLanguage('de')
    expect(formatBytes(12_600_000)).toBe('12,6 MB')
  })
})

describe('the update dialog', () => {
  it('tells the size, shows the progress, and follows Android’s installer to the end', async () => {
    const fake = fakeUpdater()
    offer(release, fake.updater)
    await settle()
    expect(dialog()?.textContent).toContain('build 9')
    expect(note()?.textContent).toBe('The download is 20.0 MB.')
    expect(warning()?.hidden).toBe(true)
    expect(buttons()).toEqual(['Later', 'Download'])

    button('Download').click()
    await settle()
    expect(buttons()).toEqual(['Later', 'Pause'])
    fake.progress(5 * MB)
    expect(bar()?.value).toBe(25)
    expect(status()).toBe('5.0 MB of 20.0 MB · 25 %')

    fake.finish()
    await settle()
    expect(fake.native.install).toHaveBeenCalledOnce()
    expect(status()).toBe('Opening Android’s installer…')
    expect(bar()?.hidden).toBe(true)
    expect(buttons()).toEqual(['Later'])

    fake.installer('confirm')
    expect(status()).toBe('Confirm the update in Android’s dialog.')
    fake.installer('success')
    expect(status()).toBe('Installed. The app starts again in its new version.')
    // Having heard from the installer, the dialog does not offer to try again.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(buttons()).toEqual(['Later'])
  })

  it('shows the bytes alone while the size is unknown', async () => {
    const fake = fakeUpdater()
    offer({ ...release, size: null }, fake.updater)
    await settle()
    expect(note()?.textContent).toBe('')
    button('Download').click()
    await settle()
    fake.progress(3 * MB, -1)
    expect(status()).toBe('3.0 MB')
    expect(bar()?.hasAttribute('value')).toBe(false)
    // The download says its size later: from then on, as a share.
    fake.progress(4 * MB, 8 * MB)
    expect(status()).toBe('4.0 MB of 8.0 MB · 50 %')
  })

  it('warns on mobile data and on other metered connections before downloading', async () => {
    offer(release, fakeUpdater({ network: { cellular: true, metered: true } }).updater)
    await settle()
    expect(warning()?.hidden).toBe(false)
    expect(warning()?.textContent).toMatch(/mobile data/i)
    expect(buttons()).toEqual(['Later', 'Download anyway'])

    document.body.replaceChildren()
    offer(release, fakeUpdater({ network: { metered: true } }).updater)
    await settle()
    expect(warning()?.hidden).toBe(false)
    expect(warning()?.textContent).not.toMatch(/mobile data/i)
    expect(buttons()).toEqual(['Later', 'Download anyway'])
  })

  it('goes on from an earlier download, which it says, also on mobile data', async () => {
    const fake = fakeUpdater({ partial: 8 * MB, network: { cellular: true } })
    offer(release, fake.updater)
    await settle()
    expect(note()?.textContent).toBe(
      'An earlier download stopped at 40 % of 20.0 MB: it goes on from there.',
    )
    expect(warning()?.hidden).toBe(false)
    expect(buttons()).toEqual(['Later', 'Resume'])

    button('Resume').click()
    await settle()
    // Before the first progress event, the bar starts where the download stopped.
    expect(status()).toBe('8.0 MB of 20.0 MB · 40 %')
    expect(warning()?.hidden).toBe(true)
  })

  it('pauses, and goes on from where it stopped', async () => {
    const fake = fakeUpdater()
    offer(release, fake.updater)
    await settle()
    button('Download').click()
    await settle()
    fake.progress(10 * MB)

    button('Pause').click()
    expect(button('Pause').disabled).toBe(true)
    await settle()
    expect(fake.native.pauseDownload).toHaveBeenCalledOnce()
    expect(status()).toBe('Paused at 50 %. It goes on from there, also after closing the app.')
    expect(buttons()).toEqual(['Later', 'Resume'])

    button('Resume').click()
    await settle()
    expect(fake.native.download).toHaveBeenCalledTimes(2)
    expect(buttons()).toEqual(['Later', 'Pause'])
    fake.finish()
    await settle()
    expect(status()).toBe('Opening Android’s installer…')
  })

  it('offers to go on after a download failed', async () => {
    const fake = fakeUpdater()
    offer(release, fake.updater)
    await settle()
    button('Download').click()
    await settle()
    fake.fail(new Error('connection lost'))
    await settle()
    expect(status()).toBe('The download stopped. Try again: it goes on where it stopped.')
    expect(buttons()).toEqual(['Later', 'Resume'])
  })

  it('installs a build that is downloaded already, without downloading', async () => {
    const fake = fakeUpdater({ cached: release.build, network: { cellular: true } })
    offer(release, fake.updater)
    await settle()
    // Nothing to download, so nothing to warn about.
    expect(warning()?.hidden).toBe(true)
    expect(buttons()).toEqual(['Later', 'Install'])
    button('Install').click()
    await settle()
    expect(fake.native.download).not.toHaveBeenCalled()
    expect(fake.native.install).toHaveBeenCalledOnce()
    expect(status()).toBe('Opening Android’s installer…')
  })

  it('offers to try again when Android’s installer stays silent, or the player says no', async () => {
    const fake = fakeUpdater({ cached: release.build })
    offer(release, fake.updater)
    await settle()
    button('Install').click()
    await settle()
    await vi.advanceTimersByTimeAsync(5_999)
    expect(buttons()).toEqual(['Later'])
    await vi.advanceTimersByTimeAsync(1)
    expect(status()).toBe('Android’s installer did not open. Tap Install to try again.')

    button('Install').click()
    await settle()
    expect(fake.native.install).toHaveBeenCalledTimes(2)
    fake.installer('aborted')
    expect(status()).toBe('The update was not installed. Tap Install to try again.')
    expect(buttons()).toEqual(['Later', 'Install'])

    button('Install').click()
    await settle()
    fake.installer('failure', 'INSTALL_FAILED_UPDATE_INCOMPATIBLE')
    expect(status()).toBe(
      'Android could not install the update: INSTALL_FAILED_UPDATE_INCOMPATIBLE',
    )
    fake.installer('failure')
    expect(status()).toBe('Android could not install the update: ?')
  })

  it('does not count the installer as silent while the app is in the background', async () => {
    const fake = fakeUpdater({ cached: release.build })
    offer(release, fake.updater)
    await settle()
    button('Install').click()
    await settle()
    // Android's installer is in front: the app is hidden.
    visibility = 'hidden'
    await vi.advanceTimersByTimeAsync(10_000)
    expect(status()).toBe('Opening Android’s installer…')
  })

  it('sends the player to allow installing, and goes on once they come back', async () => {
    const fake = fakeUpdater({ cached: release.build, allowed: false })
    offer(release, fake.updater)
    await settle()
    button('Install').click()
    await settle()
    expect(status()).toMatch(/allow/i)
    expect(buttons()).toEqual(['Later', 'Install'])

    // Back from the setting without allowing it: still asking.
    setVisibility('hidden')
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(500)
    expect(fake.native.canInstall).toHaveBeenCalledOnce()
    expect(status()).toMatch(/allow/i)

    // Allowed this time: installing goes on by itself, once, without downloading.
    fake.state.allowed = true
    setVisibility('hidden')
    setVisibility('visible')
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(500)
    expect(fake.native.canInstall).toHaveBeenCalledTimes(2)
    expect(fake.native.install).toHaveBeenCalledTimes(2)
    expect(fake.native.download).not.toHaveBeenCalled()
    expect(status()).toBe('Opening Android’s installer…')
  })

  it('pauses a running download when the player chooses later, and keeps it', async () => {
    const fake = fakeUpdater()
    offer(release, fake.updater)
    await settle()
    button('Download').click()
    await settle()
    button('Later').click()
    expect(dialog()).toBeNull()
    expect(fake.native.pauseDownload).toHaveBeenCalledOnce()
  })

  it('closes with Android’s back button, as Later does', async () => {
    const fake = fakeUpdater()
    offer(release, fake.updater)
    await settle()
    handleBack(() => {})
    expect(dialog()).toBeNull()
    // Nothing was running: nothing to pause.
    expect(fake.native.pauseDownload).not.toHaveBeenCalled()
  })
})
