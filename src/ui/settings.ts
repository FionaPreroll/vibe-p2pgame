import { setLanguage, type TextKey, t } from '../i18n'
import {
  ACTIONS,
  type Action,
  type Bindings,
  bindButton,
  bindKey,
  buttonLabel,
  DEFAULT_BINDINGS,
  KEYS_PER_ACTION,
  keyLabel,
} from '../input'
import { isApp } from '../native'
import {
  forgetSettings,
  JOYSTICK_CHOICES,
  type JoystickSide,
  ROUND_CHOICES,
  settings,
  updateCamera,
  updateSettings,
} from '../settings'
import { clearAll } from '../storage'
import { checkForUpdate } from '../updates'
import { aboutScreen } from './about'
import { h, show, toast } from './dom'
import { netReportDialog } from './netReport'
import { reportDialog } from './report'
import { offer } from './updates'

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

  const joystickSide = select(
    JOYSTICK_CHOICES.map((side) => [
      side,
      t(side === 'off' ? 'joystickOff' : side === 'left' ? 'joystickLeft' : 'joystickRight'),
    ]),
    current.joystick,
    (value) => updateSettings({ joystick: value as JoystickSide }),
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

      h('h3', {}, t('sectionGame')),
      h('label', {}, t('roundLength'), rounds),
      toggle(t('vibration'), current.vibration, (on) => updateSettings({ vibration: on })),
      toggle(t('keepScreenOn'), current.keepScreenOn, (on) => updateSettings({ keepScreenOn: on })),
      toggle(t('netGraphSetting'), current.netGraph, (on) => updateSettings({ netGraph: on })),

      h('h3', {}, t('sectionControls')),
      h('p', { class: 'muted' }, t('controlsNote')),
      h('label', {}, t('joystickSetting'), joystickSide),
      bindingsEditor(),

      isApp() && h('h3', {}, t('sectionApp')),
      isApp() &&
        toggle(t('updatesSetting'), current.checkUpdates, (on) =>
          updateSettings({ checkUpdates: on, updatesAsked: true }),
        ),
      isApp() && h('p', { class: 'muted' }, t('updatesNote')),
      isApp() && checkNowButton(),

      h('h3', {}, t('sectionData')),
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

      h('h3', {}, t('sectionHelp')),
      h('p', { class: 'muted' }, t('debugNote')),
      h(
        'div',
        { class: 'buttons' },
        h('button', {
          type: 'button',
          textContent: t('debugCreate'),
          onclick: () => void reportDialog(),
        }),
        h('button', {
          type: 'button',
          textContent: t('netTitle'),
          onclick: () => netReportDialog(),
        }),
        h('button', {
          type: 'button',
          textContent: t('aboutTitle'),
          onclick: () => aboutScreen(() => settingsScreen(onBack)),
        }),
      ),
    ),
    onBack,
  )
}

const ACTION_LABELS: Record<Action, TextKey> = {
  up: 'actionUp',
  down: 'actionDown',
  left: 'actionLeft',
  right: 'actionRight',
  start: 'actionStart',
}

/**
 * The keys and controller buttons, folded away until opened: tap a field, then press a key or
 * a button. Escape cancels, Delete or Backspace empties the field. A key or button moves from
 * any action it had before, so none is bound twice.
 */
function bindingsEditor(): HTMLElement {
  const table = h('table', { class: 'bindings' })
  let stopListening: (() => void) | null = null

  const render = () => {
    const bindings = settings().bindings
    table.replaceChildren(
      h(
        'tr',
        {},
        h('th', {}),
        h('th', { colSpan: KEYS_PER_ACTION }, t('keys')),
        h('th', {}, t('controller')),
      ),
      ...ACTIONS.map((action) =>
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, t(ACTION_LABELS[action])),
          ...Array.from({ length: KEYS_PER_ACTION }, (_, slot) => {
            const key = bindings.keys[action][slot]
            return h(
              'td',
              {},
              field(key ? keyLabel(key) : '—', (button) => listenKey(button, action, slot)),
            )
          }),
          h(
            'td',
            {},
            field(
              bindings.buttons[action] === null ? '—' : buttonLabel(bindings.buttons[action]),
              (button) => listenButton(button, action),
            ),
          ),
        ),
      ),
    )
  }

  const field = (label: string, onListen: (button: HTMLButtonElement) => void) => {
    const button = h('button', { type: 'button', textContent: label })
    button.onclick = () => {
      stopListening?.()
      button.classList.add('listening')
      onListen(button)
    }
    return button
  }

  const save = (bindings: Bindings) => {
    stopListening?.()
    updateSettings({ bindings })
    render()
  }

  function listenKey(button: HTMLButtonElement, action: Action, slot: number) {
    button.textContent = t('pressKey')
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') return cancel()
      const clear = event.code === 'Delete' || event.code === 'Backspace'
      if (!clear && !event.code) return
      save(bindKey(settings().bindings, action, slot, clear ? null : event.code))
    }
    const cancel = () => {
      stopListening?.()
      render()
    }
    window.addEventListener('keydown', onKey, true)
    stopListening = () => {
      window.removeEventListener('keydown', onKey, true)
      stopListening = null
    }
  }

  function listenButton(button: HTMLButtonElement, action: Action) {
    button.textContent = t('pressButton')
    // Buttons already down when listening starts do not count: only a new press does.
    const down = new Set(pressedButtons())
    let frame = 0
    const poll = () => {
      const now = pressedButtons()
      const pressed = now.find((b) => !down.has(b))
      if (pressed !== undefined) return save(bindButton(settings().bindings, action, pressed))
      for (const b of [...down]) if (!now.includes(b)) down.delete(b)
      frame = requestAnimationFrame(poll)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' && event.code !== 'Delete' && event.code !== 'Backspace') return
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') {
        stopListening?.()
        render()
      } else save(bindButton(settings().bindings, action, null))
    }
    window.addEventListener('keydown', onKey, true)
    frame = requestAnimationFrame(poll)
    stopListening = () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey, true)
      stopListening = null
    }
  }

  render()
  return h(
    'details',
    { class: 'bindings-editor' },
    h('summary', {}, t('bindingsTitle')),
    h('p', { class: 'muted' }, t('bindingsNote')),
    table,
    h(
      'div',
      { class: 'buttons' },
      h('button', {
        type: 'button',
        textContent: t('resetBindings'),
        onclick: () => {
          save(DEFAULT_BINDINGS)
          toast(t('bindingsReset'))
        },
      }),
    ),
  )
}

/** The buttons held down on every controller connected. */
function pressedButtons(): number[] {
  const pressed: number[] = []
  for (const pad of navigator.getGamepads?.() ?? []) {
    pad?.buttons.forEach((button, index) => {
      if (button.pressed) pressed.push(index)
    })
  }
  return pressed
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

/** In the app: looks for a new version now, and offers it, whatever the switch above says. */
function checkNowButton(): HTMLElement {
  const status = h('p', { class: 'status', role: 'status' } as Partial<HTMLParagraphElement>)
  const button = h('button', {
    type: 'button',
    textContent: t('updatesCheckNow'),
    onclick: async () => {
      button.disabled = true
      status.textContent = t('updatesChecking')
      const check = await checkForUpdate()
      button.disabled = false
      if (check.kind === 'newer') {
        status.textContent = ''
        offer(check.release)
      } else {
        status.textContent =
          check.kind === 'current'
            ? t('updatesCurrent', { build: check.installed })
            : t('updatesCheckFailed')
      }
    },
  })
  return h('div', { class: 'check-now' }, h('div', { class: 'buttons' }, button), status)
}
