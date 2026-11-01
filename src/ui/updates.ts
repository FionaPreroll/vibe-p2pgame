import { t } from '../i18n'
import {
  continueInstall,
  type InstallResult,
  installUpdate,
  type Release,
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
 * A new version: install it now, or later. If Android first wants the app to be allowed to
 * install apps, the player is sent to that setting, and installing goes on by itself when they
 * come back, without downloading again.
 */
export function offer(release: Release): void {
  const status = h('p', { class: 'status', role: 'status' } as Partial<HTMLParagraphElement>)
  const later = h('button', { type: 'button', textContent: t('updateLater') })
  const install = h('button', { type: 'button', class: 'primary', textContent: t('updateInstall') })
  let waiting: (() => void) | null = null

  const show = (result: InstallResult) => {
    install.disabled = result === 'installing'
    status.textContent = t(
      result === 'installing'
        ? 'updateInstalling'
        : result === 'permission'
          ? 'updatePermission'
          : 'updateFailed',
    )
    if (result === 'permission') waitForPermission()
  }

  // Back from the setting: go on, once, if the player allowed it.
  const waitForPermission = () => {
    if (waiting) return
    waiting = () => {
      if (document.visibilityState !== 'visible') return
      stopWaiting()
      void continueInstall().then((result) => {
        if (result === 'installing') show(result)
      })
    }
    document.addEventListener('visibilitychange', waiting)
  }
  const stopWaiting = () => {
    if (waiting) document.removeEventListener('visibilitychange', waiting)
    waiting = null
  }

  install.onclick = async () => {
    install.disabled = true
    stopWaiting()
    status.textContent = t('updateDownloading', { percent: 0 })
    show(
      await installUpdate(release, (percent) => {
        if (percent >= 0) status.textContent = t('updateDownloading', { percent })
      }),
    )
  }
  later.onclick = () => {
    stopWaiting()
    modal.remove()
  }
  const modal = dialog(
    h('h2', {}, t('updatesTitle')),
    h('p', {}, t('updateReady', { build: release.build })),
    status,
    h('div', { class: 'buttons' }, later, install),
  )
  cancelOnBack(modal, () => later.click())
}

function dialog(...children: Node[]): HTMLElement {
  const modal = h('div', { class: 'modal update' }, h('div', { class: 'card' }, ...children))
  document.body.append(modal)
  return modal
}
