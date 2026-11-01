import type { Signal } from '@fionapreroll/p2p'
import { qrElement } from '@fionapreroll/p2p/qr'
import { HOST_ID } from '@fionapreroll/p2p/room'
import type { Snapshot } from '../game/sim'
import { t } from '../i18n'
import { describeError, log } from '../log'
import { HostSession, type Pairing } from '../session/host'
import type { HostedGame } from '../session/saved'
import { settings } from '../settings'
import { bluetoothHostDialog } from './bluetoothUi'
import { joinLink, pastedSignal, textCodes } from './codes'
import { chooseConnection } from './connect'
import { failureText, h, show, toast } from './dom'
import { gameScreen, networkButton, result, roster } from './game'
import { scanPanel } from './scanPanel'

/**
 * Hosts a game: the arena at once, and between rounds the buttons to add players and start.
 * `saved` carries on a game this phone hosted before, with its players and scores.
 */
export function hostScreen(name: string, onLeave: () => void, saved?: HostedGame): void {
  const session = new HostSession(name, saved)
  session.onLeave = (left) => {
    log('game', 'a player left')
    toast(t('playerLeft', { name: left }))
  }
  session.onStalling = (player) => toast(t('stalling', { name: player }))
  const start = () => session.start(settings().roundSeconds)
  const screen = gameScreen(
    session,
    (state) => {
      // Alone, adding a player is what comes next: that button leads, and starting follows.
      const alone = state.players.length === 1
      return [
        state.phase === 'over'
          ? result(state)
          : h('p', {}, alone ? t('alone') : t('lobby'), ' ', t('steer')),
        roster(state, session.selfId()),
        alone ? null : readiness(state),
        h(
          'div',
          { class: 'buttons' },
          h('button', {
            type: 'button',
            class: alone ? 'primary attention' : '',
            textContent: t('addPlayer'),
            onclick: async () => {
              const choice = await chooseConnection()
              if (choice === 'bluetooth') bluetoothHostDialog(session, name, screen.element)
              else if (choice === 'qr') pairingDialog(session, screen.element)
            },
          }),
          h('button', {
            type: 'button',
            class: alone ? '' : 'primary',
            textContent: state.phase === 'over' ? t('again') : t('start'),
            onclick: start,
          }),
        ),
        // Alone, there is no connection to report on, unless there was one before.
        alone && session.net.samples.length === 0 ? null : networkButton(session),
      ]
    },
    () => {
      screen.destroy()
      session.close()
      onLeave()
    },
    start,
  )
  show(screen.element, 'ignore')
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
      const { player, rejoined } = await pairing.accept(signal)
      pairing = null
      close()
      log('qr', `player ${player.id} joined${rejoined ? ', back in their place' : ''}`)
      toast(t(rejoined ? 'rejoined' : 'connected', { name: player.name }))
    } catch (error) {
      log('qr', `a player did not join: ${describeError(error)}`)
      status.textContent = failureText(error)
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

/** How many players are ready, and after a round that the next one starts once all are. */
function readiness(state: Snapshot): HTMLElement {
  const others = state.players.filter((p) => p.id !== HOST_ID)
  const ready = others.filter((p) => p.ready).length
  return h(
    'p',
    { class: 'muted' },
    t('readyCount', { ready, all: others.length }),
    state.phase === 'over' ? ` ${t('rematchNote')}` : '',
  )
}
