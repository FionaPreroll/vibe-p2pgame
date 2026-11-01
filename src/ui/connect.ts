import { t } from '../i18n'
import { isApp } from '../native'
import { bluetoothJoinScreen } from './bluetoothUi'
import { cancelOnBack, h } from './dom'
import { type JoinOptions, joinScreen } from './join'

export type ConnectionChoice = 'qr' | 'bluetooth'

/**
 * How a player connects: by QR code over Wi-Fi, which every phone and browser can, or by
 * Bluetooth, which needs the Android app on both phones. Only the app asks; a browser always
 * takes the QR code. Null if the player backs out.
 */
export function chooseConnection(): Promise<ConnectionChoice | null> {
  if (!isApp()) return Promise.resolve('qr')
  return new Promise((resolve) => {
    const choose = (choice: ConnectionChoice | null) => () => {
      modal.remove()
      resolve(choice)
    }
    const option = (choice: ConnectionChoice, label: string, note: string) =>
      h(
        'button',
        { type: 'button', class: 'choice', onclick: choose(choice) },
        h('strong', {}, label),
        h('span', { class: 'muted' }, note),
      )
    const modal = h(
      'div',
      { class: 'modal' },
      h(
        'div',
        { class: 'card' },
        h('h2', {}, t('chooseConnection')),
        option('qr', t('viaQr'), t('viaQrNote')),
        option('bluetooth', t('viaBluetooth'), t('viaBluetoothNote')),
        h(
          'div',
          { class: 'buttons' },
          h('button', { type: 'button', textContent: t('cancel'), onclick: choose(null) }),
        ),
      ),
    )
    document.body.append(modal)
    cancelOnBack(modal, choose(null))
  })
}

/**
 * Joins a game the way the player chooses. A link with the host's code always means the QR way,
 * as it already carries the code.
 */
export function startJoin(name: string, onLeave: () => void, options: JoinOptions = {}): void {
  if (options.offer) {
    joinScreen(name, onLeave, options)
    return
  }
  void chooseConnection().then((choice) => {
    if (choice === 'bluetooth') bluetoothJoinScreen(name, onLeave, options.rejoin)
    else if (choice === 'qr') joinScreen(name, onLeave, options)
  })
}
