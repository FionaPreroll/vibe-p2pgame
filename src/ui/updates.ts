import { t } from '../i18n'
import { installUpdate, type Release, updateOnStart } from '../updates'
import { h } from './dom'

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
  })
}

/** A new version: install it now, or later. */
function offer(release: Release): void {
  const status = h('p', { class: 'status', role: 'status' } as Partial<HTMLParagraphElement>)
  const later = h('button', {
    type: 'button',
    textContent: t('updateLater'),
    onclick: () => modal.remove(),
  })
  const install = h('button', {
    type: 'button',
    class: 'primary',
    textContent: t('updateInstall'),
    onclick: async () => {
      install.disabled = true
      status.textContent = t('updateDownloading', { percent: 0 })
      const result = await installUpdate((percent) => {
        if (percent >= 0) status.textContent = t('updateDownloading', { percent })
      })
      install.disabled = result === 'installing'
      status.textContent = t(
        result === 'installing'
          ? 'updateInstalling'
          : result === 'permission'
            ? 'updatePermission'
            : 'updateFailed',
      )
    },
  })
  const modal = dialog(
    h('h2', {}, t('updatesTitle')),
    h('p', {}, t('updateReady', { build: release.build })),
    status,
    h('div', { class: 'buttons' }, later, install),
  )
}

function dialog(...children: Node[]): HTMLElement {
  const modal = h('div', { class: 'modal update' }, h('div', { class: 'card' }, ...children))
  document.body.append(modal)
  return modal
}
