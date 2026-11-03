import type { AppUpdates, InstallResult, Progress, Release } from './index.ts'

/**
 * The dialogs of an app's updates, in the page: the question at the first start, and the offer
 * of a newer version, which downloads, pauses, resumes and installs it. Games bring their own
 * texts, in their own languages, and their own styles: the dialog is a `.modal.update` holding a
 * `.card`, with `.buttons` (the first one closes it), a `.warning`, a `progress` and a `.status`.
 */

/** Every text the dialogs show, by key; `{name}` marks where a value goes. */
export type UpdateTextKey =
  | 'updatesTitle'
  | 'updatesAsk'
  | 'updatesYes'
  | 'updatesNo'
  | 'updateReady'
  | 'updateInstall'
  | 'updateLater'
  | 'updateDownload'
  | 'updateDownloadAnyway'
  | 'updateSize'
  | 'updateContinues'
  | 'updateMobileData'
  | 'updateMetered'
  | 'updateProgress'
  | 'updatePause'
  | 'updateResume'
  | 'updatePaused'
  | 'updateInstalling'
  | 'updateConfirm'
  | 'updateInstalled'
  | 'updateAborted'
  | 'updateInstallFailed'
  | 'updateNoInstaller'
  | 'updatePermission'
  | 'updateFailed'

/**
 * The game's texts: `text(key, values)` gives the text in the player's language with the values
 * filled in. The values are `build` (updateReady), `size` (updateSize), `percent` and `size`
 * (updateContinues), `done`, `total` and `percent` (updateProgress), `percent` (updatePaused)
 * and `message` (updateInstallFailed).
 */
export type UpdateTexts = (key: UpdateTextKey, values?: Record<string, string | number>) => string

export interface DialogOptions {
  /** The player's language, for numbers: `12.6 MB` or `12,6 MB`. */
  readonly language?: string
  /**
   * Called with each dialog as it opens, and what closes it as its first button does: for the
   * game's back button, for example.
   */
  readonly opened?: (modal: HTMLElement, close: () => void) => void
}

/** How long Android's installer has to say something before the player may try again. */
export const INSTALLER_WAIT_MS = 6000

/** The question at the first start: look for updates at every start? */
export function askAboutUpdates(text: UpdateTexts, options: DialogOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const answer = (yes: boolean) => () => {
      modal.remove()
      resolve(yes)
    }
    const modal = dialog(
      element('h2', text('updatesTitle')),
      element('p', text('updatesAsk')),
      element(
        'div',
        '',
        'buttons',
        button(text('updatesNo'), answer(false)),
        button(text('updatesYes'), answer(true), 'primary'),
      ),
    )
    options.opened?.(modal, answer(false))
  })
}

/**
 * A new version: download and install it now, or later. The dialog says how large the download
 * is, and warns on mobile data or another metered connection. While it downloads, it shows the
 * progress; the download can be paused, and goes on where it stopped, also after the app was
 * closed. If Android first wants the app to be allowed to install apps, the player is sent to
 * that setting, and installing goes on by itself when they come back, without downloading again.
 * Android's installer then says how it goes; if it says nothing, as when its dialog did not
 * open, the player can try again after a few seconds.
 */
export function offerUpdate(
  updates: AppUpdates,
  release: Release,
  text: UpdateTexts,
  options: DialogOptions = {},
): HTMLElement {
  const bytes = (count: number) => formatBytes(count, options.language)
  const note = element('p', '')
  const warning = element('p', '', 'warning')
  warning.hidden = true
  const bar = document.createElement('progress')
  bar.max = 100
  bar.value = 0
  bar.hidden = true
  const status = element('p', '', 'status')
  status.setAttribute('role', 'status')
  const later = button(text('updateLater'), () => close())
  const pause = button(text('updatePause'), () => {
    pause.disabled = true
    void updates.pause()
  })
  pause.hidden = true
  const install = button(text('updateDownload'), () => void start(), 'primary')
  let waiting: (() => void) | null = null
  let running = false
  let size = release.size

  const showProgress = ({ done, total }: Progress) => {
    if (total > 0) size = total
    bar.hidden = false
    bar.value = size ? Math.min(100, (done / size) * 100) : 0
    if (!size) bar.removeAttribute('value')
    status.textContent = size
      ? text('updateProgress', {
          done: bytes(done),
          total: bytes(size),
          percent: Math.floor((done / size) * 100),
        })
      : bytes(done)
  }

  const showResult = (result: InstallResult, done = 0) => {
    running = false
    pause.hidden = true
    install.hidden = result === 'installing'
    install.disabled = false
    install.textContent = text(result === 'permission' ? 'updateInstall' : 'updateResume')
    const percent = size ? Math.floor((done / size) * 100) : 0
    status.textContent =
      result === 'installing'
        ? text('updateInstalling')
        : result === 'permission'
          ? text('updatePermission')
          : result === 'paused'
            ? text('updatePaused', { percent })
            : text('updateFailed')
    if (result === 'installing' || result === 'permission') bar.hidden = true
    if (result === 'permission') waitForPermission()
    if (result === 'installing') void watchInstaller()
  }

  let stopWatching: (() => void) | null = null
  const offerAgain = (message: string) => {
    status.textContent = message
    install.textContent = text('updateInstall')
    install.hidden = false
    install.disabled = false
  }
  const watchInstaller = async () => {
    stopWatching?.()
    let heard = false
    const stop = await updates.onInstallEvent((event) => {
      heard = true
      if (event.status === 'confirm') status.textContent = text('updateConfirm')
      else if (event.status === 'success') status.textContent = text('updateInstalled')
      else if (event.status === 'aborted') offerAgain(text('updateAborted'))
      else offerAgain(text('updateInstallFailed', { message: event.message || '?' }))
    })
    const timer = setTimeout(() => {
      if (!heard && document.visibilityState === 'visible') offerAgain(text('updateNoInstaller'))
    }, INSTALLER_WAIT_MS)
    stopWatching = () => {
      clearTimeout(timer)
      stop()
      stopWatching = null
    }
  }

  // Back from the setting: go on, once, if the player allowed it.
  const waitForPermission = () => {
    if (waiting) return
    waiting = () => {
      if (document.visibilityState !== 'visible') return
      stopWaiting()
      // A moment for the app to be in front again: Android opens the installer's dialog only
      // over an app in front.
      setTimeout(() => void updates.continueInstall().then((result) => showResult(result)), 500)
    }
    document.addEventListener('visibilitychange', waiting)
  }
  const stopWaiting = () => {
    if (waiting) document.removeEventListener('visibilitychange', waiting)
    waiting = null
  }

  let lastDone = 0
  const start = async () => {
    install.disabled = true
    stopWaiting()
    stopWatching?.()
    if (await updates.isDownloaded(release)) {
      showResult(await updates.install(release, () => {}))
      return
    }
    running = true
    pause.hidden = false
    pause.disabled = false
    install.hidden = true
    warning.hidden = true
    note.hidden = true
    showProgress({ done: await updates.partialBytes(release), total: -1 })
    const result = await updates.install(release, (progress) => {
      lastDone = progress.done
      showProgress(progress)
    })
    showResult(result, lastDone)
  }
  const close = () => {
    stopWaiting()
    stopWatching?.()
    // What is downloaded stays, for the next time.
    if (running) void updates.pause()
    modal.remove()
  }

  const modal = dialog(
    element('h2', text('updatesTitle')),
    element('p', text('updateReady', { build: release.build })),
    note,
    warning,
    bar,
    status,
    element('div', '', 'buttons', later, pause, install),
  )
  options.opened?.(modal, close)

  // What there is to download, and what it costs.
  void (async () => {
    const [ready, partial, net] = await Promise.all([
      updates.isDownloaded(release),
      updates.partialBytes(release),
      updates.network(),
    ])
    if (ready) {
      install.textContent = text('updateInstall')
      return
    }
    if (size) note.textContent = text('updateSize', { size: bytes(size) })
    if (partial > 0 && size) {
      note.textContent = text('updateContinues', {
        percent: Math.floor((partial / size) * 100),
        size: bytes(size),
      })
      install.textContent = text('updateResume')
    }
    if (net.cellular || net.metered) {
      warning.hidden = false
      warning.textContent = text(net.cellular ? 'updateMobileData' : 'updateMetered')
      if (partial === 0) install.textContent = text('updateDownloadAnyway')
    }
  })()
  return modal
}

/** Bytes as players read them: "12.6 MB", "128 MB". */
export function formatBytes(bytes: number, language?: string): string {
  const mb = bytes / 1_000_000
  const digits = mb < 100 ? 1 : 0
  const number = new Intl.NumberFormat(language, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return `${number.format(mb)} MB`
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  content: string,
  className = '',
  ...children: Node[]
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag)
  if (content) made.textContent = content
  if (className) made.className = className
  made.append(...children)
  return made
}

function button(label: string, onclick: () => void, className = ''): HTMLButtonElement {
  const made = element('button', label, className)
  made.type = 'button'
  made.onclick = onclick
  return made
}

function dialog(...children: Node[]): HTMLElement {
  const modal = element('div', '', 'modal update', element('div', '', 'card', ...children))
  document.body.append(modal)
  return modal
}
