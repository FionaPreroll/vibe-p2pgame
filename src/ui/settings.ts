import { setLanguage, t } from '../i18n'
import { isApp } from '../native'
import { forgetSettings, ROUND_CHOICES, settings, updateCamera, updateSettings } from '../settings'
import { clearAll } from '../storage'
import { h, show, toast } from './dom'

/** The settings, each stored as soon as it changes. */
export function settingsScreen(onBack: () => void): void {
  const current = settings()
  const name = h('input', { type: 'text', maxLength: 16, value: current.name })
  name.addEventListener('change', () => {
    if (name.value.trim()) updateSettings({ name: name.value.trim() })
  })

  const language = select(
    [
      ['auto', t('languageAuto')],
      ['en', 'English'],
      ['de', 'Deutsch'],
    ],
    current.language,
    (value) => {
      const choice = value as 'auto' | 'en' | 'de'
      updateSettings({ language: choice })
      setLanguage(choice)
      // Every text anew, in the language just chosen.
      settingsScreen(onBack)
    },
  )

  const rounds = select(
    ROUND_CHOICES.map((s) => [String(s), t('seconds', { s })]),
    String(current.roundSeconds),
    (value) => updateSettings({ roundSeconds: Number(value) }),
  )

  show(
    h(
      'div',
      { class: 'screen settings' },
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
        h('h2', {}, t('settings')),
      ),
      h('label', {}, t('yourName'), name),
      h('label', {}, t('languageLabel'), language),
      h('label', {}, t('roundLength'), rounds),
      toggle(t('vibration'), current.vibration, (on) => updateSettings({ vibration: on })),
      toggle(t('keepScreenOn'), current.keepScreenOn, (on) => updateSettings({ keepScreenOn: on })),
      isApp() &&
        toggle(t('updatesSetting'), current.checkUpdates, (on) =>
          updateSettings({ checkUpdates: on, updatesAsked: true }),
        ),
      isApp() && h('p', { class: 'muted' }, t('updatesNote')),
      h('p', { class: 'muted' }, t('cameraSaved')),
      h(
        'div',
        { class: 'buttons' },
        h('button', {
          type: 'button',
          textContent: t('resetCamera'),
          onclick: () => {
            updateCamera({ deviceId: null, zoom: null, exposure: null })
            toast(t('cameraForgotten'))
          },
        }),
        h('button', {
          type: 'button',
          class: 'danger',
          textContent: t('clearData'),
          onclick: () => {
            if (!confirm(t('clearConfirm'))) return
            clearAll()
            forgetSettings()
            setLanguage('auto')
            onBack()
          },
        }),
      ),
      h('p', { class: 'muted' }, t('savedLocally')),
    ),
  )
}

function select(
  options: readonly (readonly [string, string])[],
  value: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const element = h(
    'select',
    {},
    ...options.map(([v, label]) => h('option', { value: v, textContent: label })),
  )
  element.value = value
  element.addEventListener('change', () => onChange(element.value))
  return element
}

function toggle(label: string, on: boolean, onChange: (on: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', checked: on })
  input.addEventListener('change', () => onChange(input.checked))
  return h('label', { class: 'toggle' }, input, label)
}
