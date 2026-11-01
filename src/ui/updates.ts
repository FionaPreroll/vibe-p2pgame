import { currentLanguage, t } from '../i18n'
import {
  AppUpdater,
  continueInstall,
  type InstallResult,
  installUpdate,
  isDownloaded,
  network,
  type Progress,
  partialBytes,
  pauseUpdate,
  type Release,
  type Updater,
  updateOnStart,
} from '../updates'
import { cancelOnBack, h } from './dom'

/** At the app's start, with this module's dialogs: see `updateOnStart`. */
export function offerUpdates(): Promise<void> {
  return updateOnStart({ ask: askOnce, offer })
}

/** The question at the first start: look for updates at every start? */
function askOnce(): Promise<boolean> {
  return new Promise((resolve) => {
    const answer = (yes: boolean) => () => {
      modal.remove()
      resolve(yes)
    }
    const modal = dialog(
      h('h2', {}, t('updatesTitle')),
      h('p', {}, t('updatesAsk')),
      h(
        'div',
        { class: 'buttons' },
        h('button', { type: 'button', textContent: t('updatesNo'), onclick: answer(false) }),
        h('button', {
          type: 'button',
          class: 'primary',
          textContent: t('updatesYes'),
          onclick: answer(true),
        }),
      ),
    )
    cancelOnBack(modal, answer(false))
  })
}

/**
 * A new version: download and install it now, or later. The dialog says how large the download
 * is, and warns on mobile data or another metered connection. While it downloads, it shows the
 * progress; the download can be paused, and goes on where it stopped, also after the app was
 * closed. If Android first wants the app to be allowed to install apps, the player is sent to
 * that setting, and installing goes on by itself when they come back, without downloading again.
 */
export function offer(release: Release, updater: Updater = AppUpdater): void {
  const note = h('p', {})
  const warning = h('p', { class: 'warning', hidden: true })
  const bar = h('progress', { max: 100, value: 0, hidden: true })
  const status = h('p', { class: 'status', role: 'status' } as Partial<HTMLParagraphElement>)
  const later = h('button', { type: 'button', textContent: t('updateLater') })
  const pause = h('button', { type: 'button', textContent: t('updatePause'), hidden: true })
  const install = h('button', {
    type: 'button',
    class: 'primary',
    textContent: t('updateDownload'),
  })
  let waiting: (() => void) | null = null
  let running = false
  let size = release.size

  const showProgress = ({ done, total }: Progress) => {
    if (total > 0) size = total
    bar.hidden = false
    bar.value = size ? Math.min(100, (done / size) * 100) : 0
    if (!size) bar.removeAttribute('value')
    status.textContent = size
      ? t('updateProgress', {
          done: formatBytes(done),
          total: formatBytes(size),
          percent: Math.floor((done / size) * 100),
        })
      : formatBytes(done)
  }

  const showResult = (result: InstallResult, done = 0) => {
    running = false
    pause.hidden = true
    install.hidden = result === 'installing'
    install.disabled = false
    install.textContent = t(result === 'permission' ? 'updateInstall' : 'updateResume')
    const percent = size ? Math.floor((done / size) * 100) : 0
    status.textContent =
      result === 'installing'
        ? t('updateInstalling')
        : result === 'permission'
          ? t('updatePermission')
          : result === 'paused'
            ? t('updatePaused', { percent })
            : t('updateFailed')
    if (result === 'installing' || result === 'permission') bar.hidden = true
    if (result === 'permission') waitForPermission()
  }

  // Back from the setting: go on, once, if the player allowed it.
  const waitForPermission = () => {
    if (waiting) return
    waiting = () => {
      if (document.visibilityState !== 'visible') return
      stopWaiting()
      void continueInstall(updater).then((result) => {
        if (result === 'installing') showResult(result)
      })
    }
    document.addEventListener('visibilitychange', waiting)
  }
  const stopWaiting = () => {
    if (waiting) document.removeEventListener('visibilitychange', waiting)
    waiting = null
  }

  let lastDone = 0
  install.onclick = async () => {
    install.disabled = true
    stopWaiting()
    if (await isDownloaded(release, updater)) {
      showResult(await installUpdate(release, () => {}, updater))
      return
    }
    running = true
    pause.hidden = false
    pause.disabled = false
    install.hidden = true
    warning.hidden = true
    note.hidden = true
    showProgress({ done: await partialBytes(release, updater), total: -1 })
    const result = await installUpdate(
      release,
      (progress) => {
        lastDone = progress.done
        showProgress(progress)
      },
      updater,
    )
    showResult(result, lastDone)
  }
  pause.onclick = () => {
    pause.disabled = true
    void pauseUpdate(updater)
  }
  later.onclick = () => {
    stopWaiting()
    // What is downloaded stays, for the next time.
    if (running) void pauseUpdate(updater)
    modal.remove()
  }

  const modal = dialog(
    h('h2', {}, t('updatesTitle')),
    h('p', {}, t('updateReady', { build: release.build })),
    note,
    warning,
    bar,
    status,
    h('div', { class: 'buttons' }, later, pause, install),
  )
  cancelOnBack(modal, () => later.click())

  // What there is to download, and what it costs.
  void (async () => {
    const [ready, partial, net] = await Promise.all([
      isDownloaded(release, updater),
      partialBytes(release, updater),
      network(updater),
    ])
    if (ready) {
      install.textContent = t('updateInstall')
      return
    }
    if (size) note.textContent = t('updateSize', { size: formatBytes(size) })
    if (partial > 0 && size) {
      note.textContent = t('updateContinues', {
        percent: Math.floor((partial / size) * 100),
        size: formatBytes(size),
      })
      install.textContent = t('updateResume')
    }
    if (net.cellular || net.metered) {
      warning.hidden = false
      warning.textContent = t(net.cellular ? 'updateMobileData' : 'updateMetered')
      if (partial === 0) install.textContent = t('updateDownloadAnyway')
    }
  })()
}

/** Bytes as players read them: "12.6 MB", "128 MB". */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1_000_000
  const digits = mb < 100 ? 1 : 0
  const number = new Intl.NumberFormat(currentLanguage(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return `${number.format(mb)} MB`
}

function dialog(...children: Node[]): HTMLElement {
  const modal = h('div', { class: 'modal update' }, h('div', { class: 'card' }, ...children))
  document.body.append(modal)
  return modal
}
