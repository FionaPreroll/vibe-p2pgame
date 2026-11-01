import { t } from '../i18n'
import { type HostedGame, hostedGame, type JoinedGame, joinedGame } from '../session/saved'
import { settings, updateSettings } from '../settings'
import { h, show } from './dom'

export interface HomeActions {
  host(name: string): void
  join(name: string): void
  /** Joins the game this phone dropped out of, to get the place and score back. */
  rejoin(name: string, game: JoinedGame): void
  /** Hosts the game this phone hosted before the page closed, with its players and scores. */
  resume(name: string, game: HostedGame): void
  settings(): void
}

/** The start: a name, and whether this phone hosts, joins, or goes back into a game. */
export function homeScreen(actions: HomeActions): void {
  const input = h('input', {
    type: 'text',
    maxLength: 16,
    autocomplete: 'on',
    value: playerName(),
  })
  const name = () => {
    const value = input.value.trim() || playerName()
    updateSettings({ name: value })
    return value
  }
  input.addEventListener('change', name)
  const hosted = hostedGame()
  const joined = joinedGame()
  const button = (label: string, onclick: () => void, primary = false) =>
    h('button', { type: 'button', class: primary ? 'primary' : '', textContent: label, onclick })
  show(
    h(
      'div',
      { class: 'screen home' },
      h(
        'header',
        { class: 'home-header' },
        h('h1', {}, t('title')),
        h('button', {
          type: 'button',
          class: 'icon',
          ariaLabel: t('settings'),
          title: t('settings'),
          textContent: '⚙',
          onclick: actions.settings,
        }),
      ),
      h('p', { class: 'tagline' }, t('tagline')),
      h('label', {}, t('yourName'), input),
      h(
        'div',
        { class: 'buttons column' },
        joined &&
          button(t('rejoin', { host: joined.host }), () => actions.rejoin(name(), joined), true),
        hosted &&
          button(
            hosted.players.length > 0
              ? t('resumeWith', { names: hosted.players.map((p) => p.name).join(', ') })
              : t('resume'),
            () => actions.resume(name(), hosted),
            !joined,
          ),
        button(t('host'), () => actions.host(name()), !joined && !hosted),
        button(t('join'), () => actions.join(name())),
      ),
      h('p', { class: 'muted' }, t('hotspotTip')),
      h('p', { class: 'muted' }, t('offline')),
    ),
    'exit',
  )
}

/** The name from the settings, or a new one such as "Player 42", kept from then on. */
export function playerName(): string {
  const saved = settings().name
  if (saved) return saved
  const name = t('defaultName', { n: Math.floor(10 + Math.random() * 90) })
  updateSettings({ name })
  return name
}
