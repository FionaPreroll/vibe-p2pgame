import { drawNetGraph } from '@fionapreroll/p2p/debug'
import { playerColor } from '../game/draw'
import { t } from '../i18n'
import { latestNet } from '../net/netlog'
import { debugReport, issueLink, reportSources } from '../report'
import { cancelOnBack, h } from './dom'

/**
 * Shows the debug report, to read, copy, download or send: nothing leaves the phone by itself.
 * After a game, a graph of its pings comes first; the report holds the connection's numbers,
 * second by second, beside the log.
 */
export async function reportDialog(): Promise<void> {
  const text = h('textarea', { readOnly: true, rows: 14, class: 'report' })
  const copy = h('button', { type: 'button', textContent: t('copy') })
  const download = h('a', { className: 'button', textContent: t('debugDownload') })
  const github = h('a', {
    className: 'button primary',
    textContent: t('debugGithub'),
    target: '_blank',
    rel: 'noopener',
  })
  const note = h('p', { class: 'muted' })
  const close = h('button', { type: 'button', textContent: t('cancel') })
  const net = latestNet()?.net ?? null
  const graph = h('canvas', { class: 'net-graph large' })
  const card = h(
    'div',
    { class: 'card' },
    h('h2', {}, t('debugTitle')),
    h('p', { class: 'muted' }, t('debugRead')),
    net && net.samples.length > 0 ? h('p', { class: 'graph-label' }, t('netGraph')) : null,
    net && net.samples.length > 0 ? graph : null,
    text,
    note,
    h('div', { class: 'buttons' }, close, download, copy, github),
  )
  const modal = h('div', { class: 'modal' }, card)
  close.onclick = () => {
    if (download.href) URL.revokeObjectURL(download.href)
    modal.remove()
  }
  document.body.append(modal)
  cancelOnBack(modal, () => close.click())
  if (net && net.samples.length > 0) {
    // The canvas has its size only once it is on the page; the minute up to the last sample.
    const last = net.samples.at(-1)
    const now = performance.now()
    drawNetGraph(graph, net, last ? Math.min(now, net.startedAt + last.t * 1000 + 1000) : now, 60, {
      axes: true,
      color: netColor(net.self),
      nowLabel: t('now'),
    })
  }
  text.value = '…'
  const report = await debugReport(await reportSources())
  text.value = report
  download.href = URL.createObjectURL(new Blob([report], { type: 'text/markdown' }))
  download.download = `spark-hunt-report-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.md`
  const toClipboard = async () => {
    text.select()
    const copied = await navigator.clipboard
      ?.writeText(report)
      .then(() => true)
      .catch(() => false)
    // Where the clipboard API is missing, the selected text is copied the old way.
    if (!copied) document.execCommand?.('copy')
    copy.textContent = t('copied')
  }
  copy.onclick = toClipboard
  github.href = issueLink(report, t('debugPaste'))
  github.onclick = () => {
    void toClipboard()
    note.textContent = t('debugCopiedForIssue')
  }
}

/** The line of each connection: the player's colour on the host's phone, the host's otherwise. */
export function netColor(self: number): (peer: number) => string {
  return (peer) => (self === 0 ? playerColor(peer) : '#ffc400')
}
