import { t } from '../i18n'
import type { Signal } from '../net/signal'
import { qrElement } from '../qr/qr'
import { HostSession, type Pairing } from '../session/host'
import type { HostedGame } from '../session/saved'
import { settings } from '../settings'
import { joinLink, pastedSignal, textCodes } from './codes'
import { h, show, toast } from './dom'
import { gameScreen, result, roster } from './game'
import { scanPanel } from './scanPanel'

/**
 * Hosts a game: the arena at once, and between rounds the buttons to add players and start.
 * `saved` carries on a game this phone hosted before, with its players and scores.
 */
export function hostScreen(name: string, onLeave: () => void, saved?: HostedGame): void {
  const session = new HostSession(name, saved)
  session.onLeave = (left) => toast(t('playerLeft', { name: left }))
  const screen = gameScreen(
    session,
    (state) => [
      state.phase === 'over' ? result(state) : h('p', {}, t('lobby'), ' ', t('steer')),
      roster(state, session.selfId()),
      h(
        'div',
        { class: 'buttons' },
        h('button', {
          type: 'button',
          textContent: t('addPlayer'),
          onclick: () => pairingDialog(session, screen.element),
        }),
        h('button', {
          type: 'button',
          class: 'primary',
          textContent: state.phase === 'over' ? t('again') : t('start'),
          onclick: () => session.start(settings().roundSeconds),
        }),
      ),
    ],
    () => {
      screen.destroy()
      session.close()
      onLeave()
    },
  )
  show(screen.element)
}

/**
 * Adds one player. The host shows the offer as a QR code and at the same time watches the
 * camera for the player's answer: the player scans the host's screen, then the host turns
 * the phone round to the player's screen, and nobody has to press anything in between.
 *
 * The camera opens before the offer is made, so the offer carries the phone's real addresses
 * (see `startScanner`).
 */
function pairingDialog(session: HostSession, parent: HTMLElement): void {
  const qrBox = h('div', { class: 'qr-box' }, h('p', { class: 'muted' }, '…'))
  const status = h('p', { class: 'status', role: 'status' } as Partial<HTMLParagraphElement>)
  let pairing: Pairing | null = null
  let busy = false
  let closed = false

  const accept = async (signal: Signal) => {
    if (busy || pairing === null) return
    busy = true
    scan.stop()
    status.textContent = t('connecting')
    try {
      const { name, rejoined } = await pairing.accept(signal)
      pairing = null
      close()
      toast(t(rejoined ? 'rejoined' : 'connected', { name }))
    } catch (error) {
      status.textContent =
        error instanceof Error && error.message === 'full' ? t('full') : t('connectFailed')
      status.append(
        ' ',
        h('button', {
          type: 'button',
          textContent: t('tryAgain'),
          onclick: () => {
            close()
            pairingDialog(session, parent)
          },
        }),
      )
    }
  }

  const codes = textCodes(
    () => pairing?.code ?? null,
    (text) => {
      const signal = pastedSignal(text, 'answer')
      if (signal) void accept(signal)
      else status.textContent = t('badCode')
    },
  )

  const scan = scanPanel('answer', (signal) => {
    if (pairing === null) return false
    void accept(signal)
    return true
  })

  const close = () => {
    closed = true
    scan.stop()
    pairing?.cancel()
    modal.remove()
  }

  const modal = h(
    'div',
    { class: 'modal' },
    h(
      'div',
      { class: 'card' },
      h('h2', {}, t('addPlayer')),
      h('p', {}, t('pairStep1')),
      qrBox,
      h('p', {}, t('pairStep2')),
      scan.element,
      status,
      codes.element,
      h(
        'div',
        { class: 'buttons' },
        h('button', { type: 'button', textContent: t('cancel'), onclick: close }),
      ),
    ),
  )
  parent.append(modal)

  void (async () => {
    const camera = await scan.ready
    if (closed) return
    if (!camera) {
      status.textContent = t('noCamera')
      codes.element.open = true
    }
    pairing = await session.pair()
    if (closed) return pairing.cancel()
    qrBox.replaceChildren(qrElement(joinLink(pairing.code)))
    codes.refresh()
  })()
}
