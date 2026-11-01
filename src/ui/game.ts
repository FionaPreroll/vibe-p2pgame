import { Painter, playerColor, playerShape } from '../game/draw'
import { type Player, type Snapshot, winners } from '../game/sim'
import { t } from '../i18n'
import { Controls } from '../input'
import { STALL_MS } from '../net/netlog'
import type { Session } from '../session/session'
import { settings, updateSettings } from '../settings'
import { play, scoreSound, unlockSound } from '../sound'
import { h } from './dom'
import { joystick } from './joystick'
import { drawNetGraph, pingQuality, worstLatest } from './netGraph'
import { reportDialog } from './report'

/** Keys, the stick and the joystick steer this far ahead of the dot, in arena units. */
const STEER_AHEAD = 120
/** The last seconds of a round, when the clock turns red. */
const URGENT_SECONDS = 10

export interface GameScreen {
  readonly element: HTMLElement
  destroy(): void
}

/**
 * The game as every phone shows it: a top line, the scores below it, the arena in the middle
 * and, between rounds, a sheet below with the players and what comes next. `sheet` fills that
 * sheet; it is built anew only when its content would change, not on every frame.
 *
 * In the middle of the top line, either the clock of a round, or a banner that says no round
 * is on: free play before the first, and the end of the last. The scores get a line of their
 * own, the whole width, so names are not cut off; with many players, it wraps. `onStart`, on the host's phone,
 * starts a round when the start key or button is pressed between rounds.
 */
export function gameScreen(
  session: Session,
  sheet: (state: Snapshot) => (Node | null)[],
  onLeave: () => void,
  onStart?: () => void,
): GameScreen {
  const options = settings()
  const canvas = h('canvas', { class: 'arena' })
  const painter = new Painter(canvas)
  const scores = h('div', { class: 'scores' })
  const sheetBox = h('div', { class: 'sheet' })
  const leave = h('button', {
    type: 'button',
    class: 'icon',
    ariaLabel: t('back'),
    textContent: '×',
    onclick: () => {
      if (!session.isHost || confirm(t('leaveHost'))) onLeave()
    },
  })

  // The connection at a glance: a small graph of the ping, and its newest value.
  const netCanvas = h('canvas', { class: 'net-graph' })
  const netText = h('span', { class: 'net-ping' })
  const net = h(
    'button',
    {
      type: 'button',
      class: 'net',
      ariaLabel: t('debugTitle'),
      hidden: true,
      onclick: () => void reportDialog(),
    },
    netCanvas,
    netText,
  )

  const clockText = h('span', { class: 'clock-time' })
  const clockBar = h('span', { class: 'clock-bar' })
  const clock = h(
    'div',
    { class: 'clock', hidden: true, role: 'timer', ariaLabel: t('timeLeftLabel') },
    clockText,
    h('span', { class: 'clock-track' }, clockBar),
  )
  const bannerTitle = h('strong', {})
  const banner = h('div', { class: 'banner', hidden: true }, bannerTitle)
  const flash = h('div', { class: 'flash', hidden: true, ariaHidden: 'true' })
  const mute = h('button', {
    type: 'button',
    class: 'icon mute',
    onclick: () => {
      updateSettings({ sound: !settings().sound })
      showMute()
    },
  })
  const showMute = () => {
    const on = settings().sound
    mute.textContent = on ? '🔊' : '🔇'
    mute.ariaLabel = t(on ? 'soundOff' : 'soundOn')
    mute.title = mute.ariaLabel
  }
  showMute()
  // Clock or banner in the top line, always as high, so the arena keeps its size as a round
  // starts.
  const status = h('div', { class: 'status' }, clock, banner)
  const field = h('div', { class: 'field' }, canvas, flash)
  const pad = options.joystick === 'off' ? null : joystick(t('joystick'))
  const stage = h('div', { class: 'stage' }, field, pad?.element)
  const element = h(
    'div',
    { class: `screen game${pad ? ` joystick-${options.joystick}` : ''}` },
    h('div', { class: 'hud' }, leave, status, options.netGraph && net, mute),
    scores,
    stage,
    sheetBox,
  )

  // Steering: a touch or a pressed mouse button sets the target; keys, controllers and the
  // joystick steer a little ahead of the dot, and letting go of them stops it.
  canvas.addEventListener('pointerdown', (event) => {
    // Capture keeps the drag on the canvas; a pointer the browser no longer tracks cannot be
    // captured, and steering still works without.
    try {
      canvas.setPointerCapture(event.pointerId)
    } catch {}
    steering = false
    session.setTarget(painter.toArena(event.clientX, event.clientY))
  })
  canvas.addEventListener('pointermove', (event) => {
    if (canvas.hasPointerCapture(event.pointerId)) {
      session.setTarget(painter.toArena(event.clientX, event.clientY))
    }
  })
  const controls = new Controls(() => settings().bindings)
  // Browsers allow sound only after a touch or a key.
  const unlock = () => unlockSound()
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
  let steering = false

  const wakeLock = options.keepScreenOn
    ? navigator.wakeLock?.request('screen').catch(() => null)
    : undefined
  let sheetKey = ''
  let scoresKey = ''
  let bannerKey = ''
  let netSamples = -1
  let lastPhase: Snapshot['phase'] | null = null
  let countdownShown = 0
  let roundSeconds = 0
  // Unknown until the first snapshot, so a score kept from before rejoining does not buzz.
  let lastScore: number | null = null
  let frame = 0

  const render = () => {
    const state = session.snapshot()
    const me = state?.players.find((p) => p.id === session.selfId())
    const input = controls.poll()
    const direction = input.direction ?? pad?.direction() ?? null
    if (me && direction) {
      steering = true
      session.setTarget({
        x: me.x + direction.x * STEER_AHEAD,
        y: me.y + direction.y * STEER_AHEAD,
      })
    } else if (steering) {
      steering = false
      session.setTarget(null)
    }
    if (input.start && onStart && state && (state.phase === 'lobby' || state.phase === 'over'))
      onStart()
    painter.draw(state, session.selfId(), session.target())
    if (state) {
      if (me && lastScore !== null && me.score !== lastScore && state.phase === 'play') {
        // A short buzz for a spark, a longer one for gold, and a double one for a mine.
        const change = me.score - lastScore
        if (settings().vibration)
          navigator.vibrate?.(change < 0 ? [70, 50, 70] : change > 1 ? 80 : 25)
        const sound = scoreSound(change)
        if (sound) play(sound, settings().sound)
      }
      lastScore = me?.score ?? null
      showPhase(state)
      const ranked = [...state.players].sort((a, b) => b.score - a.score)
      const nextScores = ranked.map((p) => `${p.id}:${p.score}`).join(' ')
      if (nextScores !== scoresKey) {
        scoresKey = nextScores
        scores.replaceChildren(
          ...ranked.map((p) =>
            h(
              'span',
              { class: p.id === session.selfId() ? 'chip self' : 'chip' },
              dot(p.id),
              `${p.name} ${p.score}`,
            ),
          ),
        )
      }
      const inRound = state.phase === 'play' || state.phase === 'countdown'
      const nextSheet = inRound
        ? ''
        : `${state.phase}|${state.players.map((p) => `${p.id}:${p.name}:${p.score}:${pingBand(p)}:${p.ready}`)}|${state.away?.map((p) => p.id)}|${state.watching?.map((p) => p.id)}`
      if (nextSheet !== sheetKey) {
        sheetKey = nextSheet
        sheetBox.hidden = inRound
        sheetBox.replaceChildren(...(inRound ? [] : sheet(state).filter((node) => node !== null)))
      }
    }
    if (options.netGraph && session.net.samples.length !== netSamples) {
      netSamples = session.net.samples.length
      showNet()
    }
    frame = requestAnimationFrame(render)
  }

  /** Shows a big word or number over the arena, for a moment. */
  function flashText(text: string) {
    flash.textContent = text
    flash.hidden = false
    flash.classList.remove('show')
    void flash.offsetWidth
    flash.classList.add('show')
  }

  /**
   * The countdown, the clock in a round, the banner between rounds, and "Go!" as a round
   * starts, with their sounds.
   */
  function showPhase(state: Snapshot) {
    const on = settings().sound
    if (state.phase === 'countdown') {
      const number = Math.ceil(state.timeLeft)
      if (lastPhase !== 'countdown' || number !== countdownShown) {
        countdownShown = number
        if (number > 0) {
          flashText(String(number))
          play('tick', on)
        }
      }
    }
    if (state.phase === 'over' && lastPhase === 'play') play('end', on)
    if (state.phase === 'play') {
      if (lastPhase !== 'play') {
        // The round's length, for the bar: the time left at its start.
        roundSeconds = Math.max(1, Math.ceil(state.timeLeft))
        if (lastPhase !== null) {
          flashText(t('go'))
          play('go', on)
        }
      }
      const seconds = Math.ceil(state.timeLeft)
      const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
      if (clockText.textContent !== text) clockText.textContent = text
      clockBar.style.transform = `scaleX(${Math.min(1, state.timeLeft / roundSeconds)})`
      clock.classList.toggle('urgent', seconds <= URGENT_SECONDS)
    }
    clock.hidden = state.phase !== 'play'
    const nextBanner = state.phase === 'play' || state.phase === 'countdown' ? '' : state.phase
    if (nextBanner !== bannerKey) {
      bannerKey = nextBanner
      banner.hidden = nextBanner === ''
      banner.classList.toggle('over', state.phase === 'over')
      bannerTitle.textContent = state.phase === 'over' ? t('roundOver') : t('freePlay')
    }
    lastPhase = state.phase
  }

  /** The small graph and the newest ping, for the host the worst of its players. */
  function showNet() {
    const now = performance.now()
    const latest = worstLatest(session.net, now)
    net.hidden = latest === null
    if (latest === null) return
    drawNetGraph(netCanvas, session.net, now, 30)
    netText.textContent = latest.ping === null ? '…' : t('pingMs', { ms: latest.ping })
    net.dataset.quality = pingQuality(latest.ping, latest.gap >= STALL_MS)
  }

  frame = requestAnimationFrame(render)

  return {
    element,
    destroy() {
      cancelAnimationFrame(frame)
      controls.destroy()
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      void wakeLock?.then((lock) => lock?.release())
    },
  }
}

/** A small button below the roster, between rounds, for the debug report with the connection. */
export function reportButton(): HTMLElement {
  return h('button', {
    type: 'button',
    class: 'link',
    textContent: t('debugTitle'),
    onclick: () => void reportDialog(),
  })
}

/**
 * The players, best first: what everyone sees between rounds. Before the first round, with
 * their pings; after a round, with what each caught and touched. Who is ready for the next
 * round says so. Players who dropped out follow, marked away, as they may come back, and those
 * who only watch.
 */
export function roster(state: Snapshot, selfId: number | null): HTMLElement {
  const ranked = [...state.players].sort((a, b) => b.score - a.score || a.id - b.id)
  const others = [
    ...(state.away ?? []).map((p) => ({ ...p, label: t('away') })),
    ...(state.watching ?? []).map((p) => ({ ...p, label: t('watchingLabel') })),
  ]
  const name = (p: Player) =>
    h(
      'span',
      { class: 'name' },
      p.name,
      p.id === selfId ? ` (${t('you')})` : '',
      p.ready ? h('span', { class: 'badge' }, `✓ ${t('readyLabel')}`) : null,
    )
  if (state.phase === 'over') {
    const cell = (text: string | number, label = '') =>
      h('td', { class: 'num', title: label }, String(text))
    return h(
      'table',
      { class: 'roster stats' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}),
          h('th', { class: 'num' }, t('statsCaught')),
          h('th', { class: 'num' }, t('statsGold')),
          h('th', { class: 'num' }, t('statsHits')),
          h('th', { class: 'num' }, t('statsScore')),
        ),
      ),
      h(
        'tbody',
        {},
        ...ranked.map((p) =>
          h(
            'tr',
            {},
            h('td', {}, h('span', { class: 'who' }, dot(p.id), name(p))),
            cell(p.caught),
            cell(p.gold),
            cell(p.hits),
            h('td', { class: 'num score' }, String(p.score)),
          ),
        ),
        ...others.map((p) =>
          h(
            'tr',
            { class: 'away' },
            h('td', {}, h('span', { class: 'who' }, dot(p.id), p.name)),
            h('td', { colSpan: 4, class: 'num' }, p.label),
          ),
        ),
      ),
    )
  }
  return h(
    'ul',
    { class: 'roster' },
    ...ranked.map((p) =>
      h(
        'li',
        {},
        dot(p.id),
        name(p),
        h(
          'span',
          { class: 'ping' },
          p.id === 0 ? t('host_') : p.ping === null ? '…' : t('pingMs', { ms: p.ping }),
        ),
        h('span', { class: 'score' }, String(p.score)),
      ),
    ),
    ...others.map((p) =>
      h(
        'li',
        { class: 'away' },
        dot(p.id),
        h('span', { class: 'name' }, p.name),
        h('span', { class: 'ping' }, p.label),
      ),
    ),
  )
}

/** The result line after a round. */
export function result(state: Snapshot): HTMLElement {
  const best = winners(state.players)
  const names = best.map((p) => p.name).join(', ')
  const text =
    best.length === 0
      ? t('noWinner')
      : best.length === 1
        ? t('winner', { names })
        : t('tie', { names })
  return h('p', { class: 'result' }, text)
}

/** A player's colour and shape, as small as a letter. */
export function dot(id: number): Element {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '-1 -1 2 2')
  svg.setAttribute('class', 'dot')
  svg.setAttribute('aria-hidden', 'true')
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  circle.setAttribute('r', '1')
  circle.setAttribute('fill', playerColor(id))
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  shape.setAttribute('d', playerShape(id))
  shape.setAttribute('fill', 'rgba(11, 13, 26, 0.6)')
  shape.setAttribute('fill-rule', 'evenodd')
  shape.setAttribute('transform', 'scale(0.8)')
  svg.append(circle, shape)
  return svg
}

/** Pings rounded to 5 ms, so the sheet is not rebuilt for every millisecond of jitter. */
function pingBand(player: Player): number {
  return player.ping === null ? -1 : Math.round(player.ping / 5)
}
