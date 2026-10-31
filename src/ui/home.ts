import { t } from '../i18n'
import { h, show } from './dom'

const NAME_KEY = 'vibe-p2pgame:name'

/** The start: a name, and whether this phone hosts or joins. */
export function homeScreen(onHost: (name: string) => void, onJoin: (name: string) => void): void {
  const input = h('input', {
    type: 'text',
    maxLength: 16,
    autocomplete: 'on',
    value: savedName(),
  })
  const name = () => {
    const value = input.value.trim() || savedName()
    localStorage.setItem(NAME_KEY, value)
    return value
  }
  show(
    h(
      'div',
      { class: 'screen home' },
      h('h1', {}, t('title')),
      h('p', { class: 'tagline' }, t('tagline')),
      h('label', {}, t('yourName'), input),
      h(
        'div',
        { class: 'buttons column' },
        h('button', {
          type: 'button',
          class: 'primary',
          textContent: t('host'),
          onclick: () => onHost(name()),
        }),
        h('button', { type: 'button', textContent: t('join'), onclick: () => onJoin(name()) }),
      ),
      h('p', { class: 'muted' }, t('hotspotTip')),
      h('p', { class: 'muted' }, t('offline')),
    ),
  )
}

/** The name from last time, or a new one such as "Player 42". */
export function savedName(): string {
  const saved = localStorage.getItem(NAME_KEY)
  if (saved) return saved
  const name = t('defaultName', { n: Math.floor(10 + Math.random() * 90) })
  localStorage.setItem(NAME_KEY, name)
  return name
}
