import { answerOffer, type Signal } from '@fionapreroll/p2p'
import { qrElement } from '@fionapreroll/p2p/qr'
import type { Snapshot } from '../game/sim'
import { t } from '../i18n'
import { describeError, log } from '../log'
import { GuestSession } from '../session/guest'
import { forgetJoinedGame, playerToken, rememberJoinedGame } from '../session/saved'
import { pastedSignal, textCodes } from './codes'
import { startJoin } from './connect'
import { failureText, h, show, toast } from './dom'
import { gameScreen, reportButton, result, roster } from './game'
import { reportDialog } from './report'
import { scanPanel } from './scanPanel'

export interface JoinOptions {
  /** The host's code from a link: no scanning needed. */
  readonly offer?: Signal
  /** The host of a game this phone dropped out of, to say how rejoining works. */
  readonly rejoin?: string
}

/**
 * Joins a game: scan the host's code, show the answer code until the host has scanned it,
 * then play. Rejoining works the same way: the host knows the player again by the browser's
 * token and gives back their place and score.
 */
export function joinScreen(name: string, onLeave: () => void, options: JoinOptions = {}): void {
  const { offer, rejoin } = options
  const step = h('p', {}, t('joinStep1'))
  const hint = rejoin ? h('p', { class: 'muted' }, t('rejoinHint', { host: rejoin })) : null
  const qrBox = h('div', { class: 'qr-box' })
  const status = h('p', { class: 'status', role: 'status' } as Partial<HTMLParagraphElement>)
  let answerCode: string | null = null
  let started = false
  let left = false

  const leave = () => {
    left = true
    scan.stop()
    onLeave()
  }

  const begin = async (signal: Signal) => {
    if (started) return
    started = true
    scan.stop()
    scan.element.hidden = true
    codes.element.open = false
    status.textContent = t('connecting')
    hint?.remove()
    try {
      const { link, code } = await answerOffer(signal)
      answerCode = code
      step.textContent = t('joinStep2')
      qrBox.replaceChildren(qrElement(code))
      codes.refresh()
      const session = await GuestSession.join(link, name, playerToken()).catch((error: unknown) => {
        link.pc.close()
        throw error
      })
      if (left) return session.close()
      log(
        'qr',
        `joined as player ${session.selfId()}${session.rejoined ? ', back in my place' : ''}`,
      )
      rememberJoinedGame(session.host)
      play(session, name, onLeave)
    } catch (error) {
      log('qr', `could not join: ${describeError(error)}`)
      if (left) return
      status.textContent = failureText(error)
      status.append(
        ' ',
        h('button', {
          type: 'button',
          textContent: t('tryAgain'),
          onclick: () => joinScreen(name, onLeave, { rejoin }),
        }),
      )
    }
  }

  const scan = scanPanel(
    'offer',
    (signal) => {
      void begin(signal)
      return true
    },
    true,
  )

  const codes = textCodes(
    () => answerCode,
    (text) => {
      const signal = pastedSignal(text, 'offer')
      if (signal) void begin(signal)
      else status.textContent = t('badCode')
    },
  )

  show(
    h(
      'div',
      { class: 'screen join' },
      h(
        'header',
        {},
        h('button', {
          type: 'button',
          class: 'icon',
          ariaLabel: t('back'),
          textContent: '←',
          onclick: leave,
        }),
        h('h2', {}, t('join')),
      ),
      step,
      hint,
      scan.element,
      qrBox,
      status,
      codes.element,
    ),
    leave,
  )

  if (offer) {
    void begin(offer)
    return
  }
  void scan.ready.then((camera) => {
    if (camera || left || started) return
    status.textContent = t('noCamera')
    codes.element.open = true
  })
}

/** Plays a game joined, however the player connected. */
export function play(session: GuestSession, name: string, onLeave: () => void): void {
  const screen = gameScreen(
    session,
    (state) => [
      state.phase === 'over' ? result(state) : h('p', {}, t('steer')),
      roster(state, session.selfId()),
      ...nextRound(session, state),
      reportButton(),
    ],
    () => {
      screen.destroy()
      session.close()
      onLeave()
    },
  )
  session.onLost = (ended) => {
    log('game', ended ? 'the host ended the game' : 'lost the host')
    screen.destroy()
    if (ended) {
      forgetJoinedGame()
      toast(t('ended', { host: session.host }))
      onLeave()
    } else {
      lostScreen(name, session.host, onLeave)
    }
  }
  show(screen.element, 'ignore')
  if (session.rejoined) toast(t('welcomeBack'))
  session.onTestStart = () => toast(t('connTestStarted'))
}

/** The host is out of reach: rejoin straight away, or go back to the start. */
function lostScreen(name: string, host: string, onLeave: () => void): void {
  show(
    h(
      'div',
      { class: 'screen lost' },
      h('h2', {}, t('lost')),
      h('p', {}, t('lostHelp')),
      h(
        'div',
        { class: 'buttons column' },
        h('button', {
          type: 'button',
          class: 'primary',
          textContent: t('rejoinNow'),
          onclick: () => startJoin(name, onLeave, { rejoin: host }),
        }),
        h('button', { type: 'button', textContent: t('home'), onclick: onLeave }),
        h('button', {
          type: 'button',
          class: 'link',
          textContent: t('debugTitle'),
          onclick: () => void reportDialog(),
        }),
      ),
    ),
    onLeave,
  )
}

/**
 * Between rounds, on a player's phone: ready for the next round, and only watching or playing
 * along. After a round, once every player is ready, the next one starts by itself.
 */
function nextRound(session: GuestSession, state: Snapshot): HTMLElement[] {
  if (session.watching()) {
    return [
      h('p', { class: 'muted' }, t('watchingNote')),
      h(
        'div',
        { class: 'buttons' },
        h('button', {
          type: 'button',
          class: 'primary',
          textContent: t('playAlong'),
          onclick: () => session.setWatching(false),
        }),
      ),
    ]
  }
  const ready = h('button', {
    type: 'button',
    class: session.ready() ? 'ready-on' : 'primary',
    textContent: t(session.ready() ? 'readyDone' : 'readyButton'),
    onclick: () => {
      session.setReady(!session.ready())
      ready.textContent = t(session.ready() ? 'readyDone' : 'readyButton')
      ready.className = session.ready() ? 'ready-on' : 'primary'
    },
  })
  return [
    h(
      'p',
      { class: 'muted' },
      state.phase === 'over' ? `${t('waitHost')} ${t('rematchNote')}` : t('freePlayGuest'),
    ),
    h(
      'div',
      { class: 'buttons' },
      ready,
      h('button', {
        type: 'button',
        textContent: t('watchOnly'),
        onclick: () => session.setWatching(true),
      }),
    ),
  ]
}
