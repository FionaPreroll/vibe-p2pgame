import { t } from '../i18n'
import type { Signal } from '../net/signal'
import { qrElement } from '../qr/qr'
import type { Scanner } from '../qr/scanner'
import { HostSession, type Pairing } from '../session/host'
import { joinLink, pastedSignal, signalScanner, textCodes } from './codes'
import { h, show, toast } from './dom'
import { gameScreen, result, roster } from './game'

/** Hosts a game: the arena at once, and between rounds the buttons to add players and start. */
export function hostScreen(name: string, onLeave: () => void): void {
  const session = new HostSession(name)
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
          onclick: () => session.start(),
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
  const video = h('video', { class: 'camera' })
  const status = h('p', { class: 'status', role: 'status' } as Partial<HTMLParagraphElement>)
  let pairing: Pairing | null = null
  let scanner: Scanner | null = null
  let busy = false
  let closed = false

  const accept = async (signal: Signal) => {
    if (busy || pairing === null) return
    busy = true
    scanner?.stop()
    status.textContent = t('connecting')
    try {
      const joined = await pairing.accept(signal)
      pairing = null
      close()
      toast(t('connected', { name: joined }))
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

  const close = () => {
    closed = true
    scanner?.stop()
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
      video,
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
    scanner = await signalScanner(video, 'answer', (signal) => {
      if (pairing === null) return false
      void accept(signal)
      return true
    })
    if (closed) return scanner?.stop()
    if (scanner === null) {
      video.hidden = true
      status.textContent = t('noCamera')
      codes.element.open = true
    }
    pairing = await session.pair()
    if (closed) return pairing.cancel()
    qrBox.replaceChildren(qrElement(joinLink(pairing.code)))
    codes.refresh()
  })()
}
