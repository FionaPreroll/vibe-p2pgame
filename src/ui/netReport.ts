import { t } from '../i18n'
import { latestNetLog, type NetLog, netReport, samplesCsv } from '../net/netlog'
import { cancelOnBack, h } from './dom'
import { drawNetGraph } from './netGraph'

/**
 * The network report of the game played last, or now: a graph of the pings, and the report
 * to read, copy or download. Nothing leaves the phone by itself.
 */
export function netReportDialog(log: NetLog | null = latestNetLog()): void {
  const close = h('button', { type: 'button', textContent: t('cancel') })
  const card = h('div', { class: 'card' }, h('h2', {}, t('netTitle')))
  const modal = h('div', { class: 'modal' }, card)
  close.onclick = () => modal.remove()
  if (log === null || log.samples.length === 0) {
    card.append(h('p', { class: 'muted' }, t('netEmpty')), h('div', { class: 'buttons' }, close))
    document.body.append(modal)
    cancelOnBack(modal, () => modal.remove())
    return
  }
  const report = netReport(log, `${__BUILD__.commit}, built ${__BUILD__.time}`)
  const graph = h('canvas', { class: 'net-graph large' })
  const text = h('textarea', { readOnly: true, rows: 12, class: 'report', value: report })
  const copy = h('button', {
    type: 'button',
    textContent: t('copy'),
    onclick: async () => {
      text.select()
      const copied = await navigator.clipboard
        ?.writeText(report)
        .then(() => true)
        .catch(() => false)
      if (!copied) document.execCommand?.('copy')
      copy.textContent = t('copied')
    },
  })
  const download = h('a', {
    className: 'button',
    textContent: t('netDownload'),
    href: URL.createObjectURL(new Blob([samplesCsv(log)], { type: 'text/csv' })),
    download: `spark-hunt-network-${log.startedOn.toISOString().slice(0, 19).replace(/:/g, '-')}.csv`,
  })
  close.onclick = () => {
    URL.revokeObjectURL(download.href)
    modal.remove()
  }
  card.append(
    h('p', { class: 'muted' }, t('netNote')),
    h('p', { class: 'graph-label' }, t('netGraph')),
    graph,
    text,
    h('div', { class: 'buttons' }, close, download, copy),
  )
  document.body.append(modal)
  cancelOnBack(modal, () => close.click())
  // The canvas has its size only once it is on the page.
  const now = performance.now()
  const last = log.samples.at(-1)
  drawNetGraph(
    graph,
    log,
    last ? Math.min(now, log.startedAt + last.t * 1000 + 1000) : now,
    60,
    true,
  )
}
