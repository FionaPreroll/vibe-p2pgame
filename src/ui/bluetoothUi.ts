import { bluetooth, type JoinRequest, NearbyStartError, type Peer } from '../bluetooth'
import { t } from '../i18n'
import { describeError, log } from '../log'
import { GuestSession } from '../session/guest'
import type { HostSession } from '../session/host'
import { playerToken, rememberJoinedGame } from '../session/saved'
import { failureText, h, show, toast } from './dom'
import { joinScreen, play } from './join'

/**
 * Bluetooth in the Android app: the host's dialog for letting players in, and the player's
 * screen for finding a game nearby. Both phones show the same code for each connection; the
 * host lets a player in only after comparing it, so nobody else nearby slips in.
 */

/** Why Bluetooth did not start, for the player, with the code a debug report explains. */
export function startErrorText(error: unknown): string {
  if (!(error instanceof NearbyStartError)) return `${t('btOff')} (${describeError(error)})`
  const text = {
    permission: t('btPermission'),
    unavailable: t('btUnavailable'),
    'bluetooth-off': t('btBluetoothOff'),
    'location-off': t('btLocationOff'),
    radio: t('btOff'),
  }[error.kind]
  return `${text} (${error.code})`
}

/** The host advertises its game and lets in, one by one, the players who ask and show the code. */
export function bluetoothHostDialog(session: HostSession, name: string, parent: HTMLElement): void {
  const bt = bluetooth()
  const list = h('ul', { class: 'requests' })
  const status = h(
    'p',
    { class: 'status', role: 'status' } as Partial<HTMLParagraphElement>,
    t('btHostWaiting'),
  )
  const rows = new Map<string, HTMLElement>()
  let closed = false

  const close = () => {
    if (closed) return
    closed = true
    bt.onRequest = () => {}
    bt.onRequestGone = () => {}
    void bt.stop()
    modal.remove()
  }

  bt.onRequest = (request: JoinRequest) => {
    const note = h('span', { class: 'muted' })
    const row = h(
      'li',
      {},
      h(
        'span',
        { class: 'request' },
        t('btRequest', { name: request.name, digits: request.digits }),
      ),
      note,
      h(
        'div',
        { class: 'buttons' },
        h('button', {
          type: 'button',
          textContent: t('btReject'),
          onclick: () => {
            bt.reject(request)
            row.remove()
            rows.delete(request.endpointId)
          },
        }),
        h('button', {
          type: 'button',
          class: 'primary',
          textContent: t('btAccept'),
          onclick: async () => {
            const connection = bt.accept(request)
            if (!connection) return
            for (const button of row.querySelectorAll('button')) button.disabled = true
            note.textContent = t('connecting')
            try {
              const { player, rejoined } = await session.attach(connection).joined
              toast(t(rejoined ? 'rejoined' : 'connected', { name: player.name }))
              close()
            } catch (error) {
              log('bluetooth', `player ${request.endpointId} did not join: ${describeError(error)}`)
              note.textContent = failureText(error)
            }
          },
        }),
      ),
    )
    rows.set(request.endpointId, row)
    list.append(row)
  }
  bt.onRequestGone = (endpointId) => {
    rows.get(endpointId)?.remove()
    rows.delete(endpointId)
  }

  const modal = h(
    'div',
    { class: 'modal' },
    h(
      'div',
      { class: 'card' },
      h('h2', {}, t('addPlayer')),
      status,
      h('p', { class: 'muted' }, t('btCheckCode')),
      list,
      h(
        'div',
        { class: 'buttons' },
        h('button', { type: 'button', textContent: t('cancel'), onclick: close }),
      ),
    ),
  )
  parent.append(modal)
  bt.host(name).catch((error: unknown) => {
    if (!closed) status.textContent = startErrorText(error)
  })
}

/**
 * The player looks for games nearby and asks one to let them in. `rejoin`: the host of a game
 * this phone dropped out of, to say that the place and score come back.
 */
export function bluetoothJoinScreen(name: string, onLeave: () => void, rejoin?: string): void {
  const bt = bluetooth()
  const hosts = h('ul', { class: 'hosts' })
  const status = h(
    'p',
    { class: 'status', role: 'status' } as Partial<HTMLParagraphElement>,
    t('btSearching'),
  )
  const items = new Map<string, HTMLElement>()
  let left = false
  let dialing = false

  const leave = () => {
    left = true
    void bt.stop()
    onLeave()
  }

  const dial = async (host: Peer) => {
    if (dialing) return
    dialing = true
    await bt.stop()
    hosts.hidden = true
    status.textContent = t('connecting')
    const { connection, digits } = bt.dial(host, name)
    void digits.then((code) => {
      if (!left && connection.state !== 'closed')
        status.textContent = t('btWaitHost', { digits: code, host: host.name })
    })
    try {
      const session = await GuestSession.join(connection, name, playerToken())
      if (left) return session.close()
      rememberJoinedGame(session.host)
      play(session, name, onLeave)
    } catch (error) {
      log('bluetooth', `could not join ${host.endpointId}: ${describeError(error)}`)
      connection.close()
      if (left) return
      status.textContent =
        error instanceof Error && error.message === 'Connection failed'
          ? t('btRejected')
          : failureText(error)
      status.append(
        ' ',
        h('button', {
          type: 'button',
          textContent: t('tryAgain'),
          onclick: () => bluetoothJoinScreen(name, onLeave, rejoin),
        }),
      )
    }
  }

  bt.onFound = (host) => {
    if (items.has(host.endpointId)) return
    const item = h(
      'li',
      {},
      h('button', {
        type: 'button',
        class: 'host',
        textContent: host.name,
        onclick: () => dial(host),
      }),
    )
    items.set(host.endpointId, item)
    hosts.append(item)
  }
  bt.onLost = (endpointId) => {
    items.get(endpointId)?.remove()
    items.delete(endpointId)
  }

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
      rejoin ? h('p', { class: 'muted' }, t('btRejoinHint', { host: rejoin })) : null,
      status,
      hosts,
      h('button', {
        type: 'button',
        textContent: t('viaQrInstead'),
        onclick: () => {
          left = true
          void bt.stop()
          joinScreen(name, onLeave, { rejoin })
        },
      }),
    ),
    leave,
  )
  bt.look(name).catch((error: unknown) => {
    if (!left) status.textContent = startErrorText(error)
  })
}
