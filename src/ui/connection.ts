import { type ConnectionViewTexts, connectionView } from '@fionapreroll/p2p/debug'
import { t } from '../i18n'
import type { Session } from '../session/session'
import { cancelOnBack, h } from './dom'
import { netColor, reportDialog } from './report'

/** The connection view's texts, in the player's language. */
export function connectionTexts(): ConnectionViewTexts {
  return {
    rows: {
      ping: t('connPing'),
      pingLoss: t('connPingLoss'),
      stalls: t('connStalls'),
      messages: t('connMessages'),
      data: t('connData'),
      transport: t('connTransport'),
      local: t('connLocal'),
      remote: t('connRemote'),
      offered: t('connOffered'),
      rtt: t('connRtt'),
      available: t('connAvailable'),
      packets: t('connPackets'),
      bytes: t('connBytes'),
      security: t('connSecurity'),
      channels: t('connChannels'),
      testPing: t('connTestPing'),
      testDown: t('connTestDown'),
      testUp: t('connTestUp'),
    },
    transports: {
      webrtc: t('connTransportWebrtc'),
      bluetooth: t('connTransportBluetooth'),
      memory: t('connTransportMemory'),
    },
    kinds: {
      'ipv4-local': t('connKindIpv4Local'),
      ipv4: t('connKindIpv4'),
      'ipv6-local': t('connKindIpv6Local'),
      ipv6: t('connKindIpv6'),
      mdns: t('connKindMdns'),
      mac: t('connKindMac'),
      loopback: t('connKindLoopback'),
      other: t('connKindOther'),
    },
    none: t('connNone'),
    lost: t('connLost'),
    more: t('connMore'),
    reveal: t('connReveal'),
    hide: t('connHide'),
    test: t('connTest'),
    testing: t('connTesting'),
    lastTest: t('connLastTest'),
    noAnswer: t('connNoAnswer'),
    now: t('now'),
  }
}

/**
 * How the connections of the game are doing, from the graph in the top line: the library's
 * connection view, with every connection's numbers and details, the addresses hidden until the
 * player shows them, and on the host's phone the connection test. The debug report is a tap away.
 * `name` names the other phone of a connection, by player id.
 */
export function connectionDialog(session: Session, name: (peer: number) => string): void {
  const test = session.testConnections?.bind(session)
  const view = connectionView({
    texts: connectionTexts(),
    net: session.net,
    connections: () =>
      session.peers().map((peer) => ({
        peer,
        name: name(peer),
        details: () => session.details(peer),
      })),
    color: netColor(session.net.self),
    test,
    lastTest: () => session.lastTest(),
  })
  const close = () => {
    view.stop()
    modal.remove()
  }
  const modal = h(
    'div',
    { class: 'modal' },
    h(
      'div',
      { class: 'card connection-card' },
      h('h2', {}, t('connTitle')),
      h('p', { class: 'muted' }, t('connNote')),
      view.element,
      h(
        'div',
        { class: 'buttons' },
        h('button', { type: 'button', textContent: t('close'), onclick: close }),
        h('button', {
          type: 'button',
          textContent: t('debugTitle'),
          onclick: () => {
            close()
            void reportDialog()
          },
        }),
      ),
    ),
  )
  document.body.append(modal)
  cancelOnBack(modal, close)
}
