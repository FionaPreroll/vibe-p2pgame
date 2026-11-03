// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }))

const { AppUpdates } = await import('./index.ts')
const { askAboutUpdates, formatBytes, offerUpdate } = await import('./dialog.ts')
const { FakeUpdater } = await import('./testing.ts')
type UpdateTextKey = import('./dialog.ts').UpdateTextKey
type Network = import('./index.ts').Network

/**
 * The update dialogs, played through with FakeUpdater: what the offer says before a download,
 * while it runs, when it is paused, and what Android's installer answers.
 */

const TEXTS: Record<UpdateTextKey, string> = {
  updatesTitle: 'Updates',
  updatesAsk: 'Should the game look for updates whenever it starts?',
  updatesYes: 'Yes, look',
  updatesNo: 'No',
  updateReady: 'A new version is ready (build {build}).',
  updateInstall: 'Install',
  updateLater: 'Later',
  updateDownload: 'Download',
  updateDownloadAnyway: 'Download anyway',
  updateSize: 'The download is {size}.',
  updateContinues: 'An earlier download stopped at {percent} % of {size}: it goes on from there.',
  updateMobileData: 'You are on mobile data.',
  updateMetered: 'This connection is metered.',
  updateProgress: '{done} of {total} · {percent} %',
  updatePause: 'Pause',
  updateResume: 'Resume',
  updatePaused: 'Paused at {percent} %. It goes on from there, also after closing the app.',
  updateInstalling: 'Opening Android’s installer…',
  updateConfirm: 'Confirm the update in Android’s dialog.',
  updateInstalled: 'Installed. The app starts again in its new version.',
  updateAborted: 'The update was not installed. Tap Install to try again.',
  updateInstallFailed: 'Android could not install the update: {message}',
  updateNoInstaller: 'Android’s installer did not open. Tap Install to try again.',
  updatePermission: 'Allow the game to install apps in the settings, then come back.',
  updateFailed: 'The download stopped. Try again: it goes on where it stopped.',
}
const text = (key: UpdateTextKey, values: Record<string, string | number> = {}) =>
  TEXTS[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''))

const MB = 1_000_000
const release = { build: 9, commit: 'abc1234', size: 20 * MB }

/** The game's back button: closes the dialog opened last, as its first button does. */
let closers: (() => void)[] = []
const opened = (_: HTMLElement, close: () => void) => void closers.push(close)
const back = () => closers.pop()?.()

/** The native side, played by FakeUpdater: the download runs until the test ends it. */
function setup(
  start: { partial?: number; cached?: number; network?: Partial<Network>; allowed?: boolean } = {},
) {
  const native = new FakeUpdater()
  native.partialBytes = start.partial ?? 0
  native.cached = start.cached ?? -1
  native.allowed = start.allowed ?? true
  native.connection = { online: true, metered: false, cellular: false, ...start.network }
  for (const method of ['install', 'download', 'pauseDownload', 'canInstall'] as const) {
    vi.spyOn(native, method)
  }
  return {
    updates: new AppUpdates(
      { releases: 'https://github.com/example/game/releases/latest/download/', apk: 'game.apk' },
      native,
    ),
    native,
    state: native,
    progress: (done: number, total = release.size) => native.progress(done, total),
    installer: (status: string, message = '') => native.installer(status, message),
    finish: () => native.finish(release.build),
    fail: (error: unknown) => native.fail(error),
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
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  document.body.replaceChildren()
  closers = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the question at the first start', () => {
  it('answers yes or no, and the back button says no', async () => {
    for (const [choice, yes] of [
      ['Yes, look', true],
      ['No', false],
      ['back', false],
    ] as const) {
      const asking = askAboutUpdates(text, { opened })
      expect(document.querySelector('.modal')?.textContent).toContain('look for updates')
      if (choice === 'back') back()
      else [...document.querySelectorAll('button')].find((b) => b.textContent === choice)?.click()
      expect(await asking).toBe(yes)
      expect(document.querySelector('.modal')).toBeNull()
    }
  })
})

describe('formatBytes', () => {
  it('shows megabytes with one digit below 100, and none above', () => {
    expect(formatBytes(12_600_000, 'en')).toBe('12.6 MB')
    expect(formatBytes(128_400_000, 'en')).toBe('128 MB')
    expect(formatBytes(0, 'en')).toBe('0.0 MB')
    expect(formatBytes(12_600_000, 'de')).toBe('12,6 MB')
  })
})

describe('the update dialog', () => {
  it('tells the size, shows the progress, and follows Android’s installer to the end', async () => {
    const fake = setup()
    offerUpdate(fake.updates, release, text, { opened })
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
    const fake = setup()
    offerUpdate(fake.updates, { ...release, size: null }, text, { opened })
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
    offerUpdate(setup({ network: { cellular: true, metered: true } }).updates, release, text)
    await settle()
    expect(warning()?.hidden).toBe(false)
    expect(warning()?.textContent).toMatch(/mobile data/i)
    expect(buttons()).toEqual(['Later', 'Download anyway'])

    document.body.replaceChildren()
    offerUpdate(setup({ network: { metered: true } }).updates, release, text)
    await settle()
    expect(warning()?.hidden).toBe(false)
    expect(warning()?.textContent).not.toMatch(/mobile data/i)
    expect(buttons()).toEqual(['Later', 'Download anyway'])
  })

  it('goes on from an earlier download, which it says, also on mobile data', async () => {
    const fake = setup({ partial: 8 * MB, network: { cellular: true } })
    offerUpdate(fake.updates, release, text, { opened })
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
    const fake = setup()
    offerUpdate(fake.updates, release, text, { opened })
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
    const fake = setup()
    offerUpdate(fake.updates, release, text, { opened })
    await settle()
    button('Download').click()
    await settle()
    fake.fail(new Error('connection lost'))
    await settle()
    expect(status()).toBe('The download stopped. Try again: it goes on where it stopped.')
    expect(buttons()).toEqual(['Later', 'Resume'])
  })

  it('installs a build that is downloaded already, without downloading', async () => {
    const fake = setup({ cached: release.build, network: { cellular: true } })
    offerUpdate(fake.updates, release, text, { opened })
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
    const fake = setup({ cached: release.build })
    offerUpdate(fake.updates, release, text, { opened })
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
    const fake = setup({ cached: release.build })
    offerUpdate(fake.updates, release, text, { opened })
    await settle()
    button('Install').click()
    await settle()
    // Android's installer is in front: the app is hidden.
    visibility = 'hidden'
    await vi.advanceTimersByTimeAsync(10_000)
    expect(status()).toBe('Opening Android’s installer…')
  })

  it('sends the player to allow installing, and goes on once they come back', async () => {
    const fake = setup({ cached: release.build, allowed: false })
    offerUpdate(fake.updates, release, text, { opened })
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
    const fake = setup()
    offerUpdate(fake.updates, release, text, { opened })
    await settle()
    button('Download').click()
    await settle()
    button('Later').click()
    expect(dialog()).toBeNull()
    expect(fake.native.pauseDownload).toHaveBeenCalledOnce()
  })

  it('closes with Android’s back button, as Later does', async () => {
    const fake = setup()
    offerUpdate(fake.updates, release, text, { opened })
    await settle()
    back()
    expect(dialog()).toBeNull()
    // Nothing was running: nothing to pause.
    expect(fake.native.pauseDownload).not.toHaveBeenCalled()
  })
})
