import { t } from '../i18n'
import { debugReport, issueLink, reportSources } from '../report'
import { h } from './dom'

/** Shows the debug report, to read, copy and send: nothing leaves the phone by itself. */
export async function reportDialog(): Promise<void> {
  const text = h('textarea', { readOnly: true, rows: 14, class: 'report' })
  const copy = h('button', { type: 'button', textContent: t('copy') })
  const github = h('a', {
    className: 'button primary',
    textContent: t('debugGithub'),
    target: '_blank',
    rel: 'noopener',
  })
  const note = h('p', { class: 'muted' })
  const close = h('button', { type: 'button', textContent: t('cancel') })
  const modal = h(
    'div',
    { class: 'modal' },
    h(
      'div',
      { class: 'card' },
      h('h2', {}, t('debugTitle')),
      h('p', { class: 'muted' }, t('debugRead')),
      text,
      note,
      h('div', { class: 'buttons' }, close, copy, github),
    ),
  )
  close.onclick = () => modal.remove()
  document.body.append(modal)
  text.value = '…'
  const report = await debugReport(await reportSources())
  text.value = report
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
