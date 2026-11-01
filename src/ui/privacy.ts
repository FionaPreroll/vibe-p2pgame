import privacyDe from '../../PRIVACY.de.md?raw'
import privacyEn from '../../PRIVACY.md?raw'
import { currentLanguage, t } from '../i18n'
import { h, show } from './dom'
import { documentView } from './markdownView'

/** The privacy policy, in the player's language: the same as PRIVACY.md in the repository. */
export function privacyScreen(onBack: () => void): void {
  show(
    h(
      'div',
      { class: 'screen privacy' },
      h(
        'header',
        {},
        h('button', {
          type: 'button',
          class: 'icon',
          ariaLabel: t('back'),
          textContent: '←',
          onclick: onBack,
        }),
        h('h2', {}, t('privacyTitle')),
      ),
      documentView(currentLanguage() === 'de' ? privacyDe : privacyEn),
    ),
    onBack,
  )
}
