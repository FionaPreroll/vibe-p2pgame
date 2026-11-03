import { bluetooth, NearbyHosting, NearbySearch, NearbyStartError } from '../bluetooth'
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
 * host lets a player in only after comparing it, so nobody else nearby slips in. The flow is
 * `@fionapreroll/p2p-nearby`'s (`NearbyHosting`, `NearbySearch`); these are its screens.
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
  const hosting = new NearbyHosting(
    bluetooth(),
    name,
    (connection) => session.attach(connection).joined,
  )
  const list = h('ul', { class: 'requests' })
  const status = h(
    'p',
    { class: 'status', role: 'status' } as Partial<HTMLParagraphElement>,
    t('btHostWaiting'),
  )

  const close = () => {
    void hosting.close()
    modal.remove()
  }

  hosting.onChange = () => {
    list.replaceChildren(
      ...hosting.requests().map(({ request, status: progress, error }) => {
        const busy = progress === 'joining'
        return h(
          'li',
          {},
          h(
            'span',
            { class: 'request' },
            t('btRequest', { name: request.name, digits: request.digits }),
          ),
          h(
            'span',
            { class: 'muted' },
            busy ? t('connecting') : progress === 'failed' ? failureText(error) : '',
          ),
          h(
            'div',
            { class: 'buttons' },
            h('button', {
              type: 'button',
              textContent: t('btReject'),
              disabled: busy,
              onclick: () => hosting.reject(request.endpointId),
            }),
            progress === 'failed'
              ? null
              : h('button', {
                  type: 'button',
                  class: 'primary',
                  textContent: t('btAccept'),
                  disabled: busy,
                  onclick: () => hosting.accept(request.endpointId),
                }),
          ),
        )
      }),
    )
    for (const { request, status: progress, error } of hosting.requests()) {
      if (progress === 'failed')
        log('bluetooth', `player ${request.endpointId} did not join: ${describeError(error)}`)
    }
  }
  hosting.onJoined = ({ player, rejoined }) => {
    toast(t(rejoined ? 'rejoined' : 'connected', { name: player.name }))
    close()
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
  hosting.started.catch((error: unknown) => {
    if (!hosting.closed) status.textContent = startErrorText(error)
  })
}

/**
 * The player looks for games nearby and asks one to let them in. `rejoin`: the host of a game
 * this phone dropped out of, to say that the place and score come back.
 */
export function bluetoothJoinScreen(name: string, onLeave: () => void, rejoin?: string): void {
  const search = new NearbySearch(
    bluetooth(),
    name,
    (connection) => GuestSession.join(connection, name, playerToken()),
    { discard: (session) => session.close() },
  )
  const hosts = h('ul', { class: 'hosts' })
  const status = h('p', { class: 'status', role: 'status' } as Partial<HTMLParagraphElement>)

  const leave = () => {
    void search.leave()
    onLeave()
  }

  search.onChange = () => {
    const state = search.state()
    hosts.hidden = state.phase !== 'looking' && state.phase !== 'starting'
    hosts.replaceChildren(
      ...search.hosts().map((host) =>
        h(
          'li',
          {},
          h('button', {
            type: 'button',
            class: 'host',
            textContent: host.name,
            onclick: () => void search.choose(host),
          }),
        ),
      ),
    )
    const again = () =>
      h('button', { type: 'button', textContent: t('tryAgain'), onclick: () => search.again() })
    switch (state.phase) {
      case 'starting':
      case 'looking':
        status.textContent = t('btSearching')
        break
      case 'unavailable':
        status.textContent = startErrorText(state.error)
        break
      case 'asking':
        status.textContent =
          state.digits === null
            ? t('connecting')
            : t('btWaitHost', { digits: state.digits, host: state.host.name })
        break
      case 'refused':
        log('bluetooth', `${state.host.endpointId} did not let this phone in`)
        status.replaceChildren(t('btRejected'), ' ', again())
        break
      case 'failed':
        log('bluetooth', `could not join ${state.host.endpointId}: ${describeError(state.error)}`)
        status.replaceChildren(failureText(state.error), ' ', again())
        break
      default:
        break
    }
  }
  search.onJoined = (session) => {
    rememberJoinedGame(session.host)
    play(session, name, onLeave)
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
          void search.leave()
          joinScreen(name, onLeave, { rejoin })
        },
      }),
    ),
    leave,
  )
  search.onChange()
}
