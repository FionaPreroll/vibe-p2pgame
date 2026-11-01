import { type BackAction, closeOnBack, setBackAction } from '../back'
import { t } from '../i18n'

type Child = Node | string | null | undefined | false

/** Builds an element: `h('button', { class: 'big', onclick }, 'Go')`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & { class?: string } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  const { class: className, ...rest } = props
  Object.assign(element, rest)
  if (className) element.className = className
  for (const child of children) if (child) element.append(child)
  return element
}

/**
 * Puts a screen in place of the current one. `back` is what Android's back button does there
 * (see src/back.ts): mostly the same as the screen's own back button.
 */
export function show(screen: HTMLElement, back: BackAction): void {
  const app = document.getElementById('app')
  if (!app) throw new Error('No #app element')
  app.replaceChildren(screen)
  setBackAction(back)
}

/** Lets Android's back button cancel a dialog, as its cancel button does, outside a game. */
export function cancelOnBack(modal: HTMLElement, cancel: () => void): void {
  closeOnBack(() => modal.isConnected, cancel)
}

/** A short message that fades away by itself. */
export function toast(text: string): void {
  const element = h('div', { class: 'toast', role: 'status' } as Partial<HTMLDivElement>, text)
  document.body.append(element)
  setTimeout(() => element.classList.add('gone'), 2500)
  setTimeout(() => element.remove(), 3000)
}

/** What went wrong while connecting, for players. */
export function failureText(error: unknown): string {
  const reason = error instanceof Error ? error.message : ''
  return reason === 'full'
    ? t('full')
    : reason === 'version'
      ? t('versionMismatch')
      : t('connectFailed')
}
