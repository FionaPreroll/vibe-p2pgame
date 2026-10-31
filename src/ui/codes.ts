import { t } from '../i18n'
import { type Signal, unpack } from '../net/signal'
import { type Scanner, startScanner } from '../qr/scanner'
import { h } from './dom'

/**
 * The fallback for phones or laptops without a camera: this phone's code as text to copy, and
 * a field for the other phone's code. Calls `onCode` with what was pasted.
 */
export function textCodes(
  ownCode: () => string | null,
  onCode: (text: string) => void,
): { element: HTMLDetailsElement; refresh(): void } {
  const own = h('textarea', { readOnly: true, rows: 3, class: 'own-code' })
  const copy = h('button', {
    type: 'button',
    textContent: t('copy'),
    onclick: async () => {
      own.select()
      await navigator.clipboard?.writeText(own.value).catch(() => {})
      copy.textContent = t('copied')
    },
  })
  const paste = h('textarea', { rows: 3, placeholder: t('pasteHere'), class: 'paste-code' })
  const use = h('button', {
    type: 'button',
    textContent: t('useCode'),
    onclick: () => onCode(paste.value),
  })
  const ownRow = h('div', { class: 'row' }, own, copy)
  const refresh = () => {
    const code = ownCode()
    own.value = code ?? ''
    ownRow.hidden = code === null
    copy.textContent = t('copy')
  }
  refresh()
  const element = h(
    'details',
    { class: 'text-codes' },
    h('summary', {}, t('textCodes')),
    ownRow,
    h('div', { class: 'row' }, paste, use),
  )
  return { element, refresh }
}

/**
 * A camera view that reads codes of one kind, offer or answer. Codes of the other kind, or QR
 * codes of other things, are ignored, so a camera that still sees the phone's own code or a
 * poster on the wall does no harm. `onSignal` returns true to stop scanning.
 */
export async function signalScanner(
  video: HTMLVideoElement,
  type: Signal['type'],
  onSignal: (signal: Signal) => boolean,
): Promise<Scanner | null> {
  try {
    return await startScanner(video, (text) => {
      const signal = unpack(text)
      return signal?.type === type ? onSignal(signal) : false
    })
  } catch {
    return null
  }
}

/** Reads a pasted code of the expected kind. */
export function pastedSignal(text: string, type: Signal['type']): Signal | undefined {
  const signal = unpack(text)
  return signal?.type === type ? signal : undefined
}

/** A link that opens the game and joins at once, for players who scan with their camera app. */
export function joinLink(code: string): string {
  return `${location.origin}${location.pathname}#o=${code}`
}
