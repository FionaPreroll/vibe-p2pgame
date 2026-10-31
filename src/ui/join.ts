import { t } from '../i18n'
import { answerOffer } from '../net/link'
import type { Signal } from '../net/signal'
import { qrElement } from '../qr/qr'
import { GuestSession } from '../session/guest'
import { pastedSignal, signalScanner, textCodes } from './codes'
import { h, show, toast } from './dom'
import { gameScreen, result, roster } from './game'

/**
 * Joins a game: scan the host's code, show the answer code until the host has scanned it,
 * then play. `offer` skips the scanning when the page was opened from the host's link.
 */
export function joinScreen(name: string, onLeave: () => void, offer?: Signal): void {
  const step = h('p', {}, t('joinStep1'))
  const video = h('video', { class: 'camera big' })
  const qrBox = h('div', { class: 'qr-box' })
  const status = h('p', { class: 'status', role: 'status' } as Partial<HTMLParagraphElement>)
  let answerCode: string | null = null
  let started = false
  let left = false
  let scanner: Awaited<ReturnType<typeof signalScanner>> = null

  const leave = () => {
    left = true
    scanner?.stop()
    onLeave()
  }

  const begin = async (signal: Signal) => {
    if (started) return
    started = true
    scanner?.stop()
    video.hidden = true
    codes.element.open = false
    status.textContent = t('connecting')
    try {
      const { link, code } = await answerOffer(signal)
      answerCode = code
      step.textContent = t('joinStep2')
      qrBox.replaceChildren(qrElement(code))
      codes.refresh()
      const session = await GuestSession.join(link, name).catch((error: unknown) => {
        link.pc.close()
        throw error
      })
      if (left) return session.close()
      play(session, onLeave)
    } catch (error) {
      if (left) return
      status.textContent =
        error instanceof Error && error.message === 'full' ? t('full') : t('connectFailed')
      status.append(
        ' ',
        h('button', {
          type: 'button',
          textContent: t('tryAgain'),
          onclick: () => joinScreen(name, onLeave),
        }),
      )
    }
  }

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
      video,
      qrBox,
      status,
      codes.element,
    ),
  )

  if (offer) {
    void begin(offer)
    return
  }
  void (async () => {
    scanner = await signalScanner(video, 'offer', (signal) => {
      void begin(signal)
      return true
    })
    if (left || started) return scanner?.stop()
    if (scanner === null) {
      video.hidden = true
      status.textContent = t('noCamera')
      codes.element.open = true
    }
  })()
}

function play(session: GuestSession, onLeave: () => void): void {
  const screen = gameScreen(
    session,
    (state) => [
      state.phase === 'over' ? result(state) : h('p', {}, t('steer')),
      roster(state, session.selfId()),
      h('p', { class: 'muted' }, t('waitHost')),
    ],
    () => {
      screen.destroy()
      session.close()
      onLeave()
    },
  )
  session.onLost = () => {
    screen.destroy()
    toast(t('lost'))
    onLeave()
  }
  show(screen.element)
}
