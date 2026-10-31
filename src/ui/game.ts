import { Painter, playerColor } from '../game/draw'
import { type Player, type Snapshot, winners } from '../game/sim'
import { t } from '../i18n'
import type { Session } from '../session/session'
import { settings } from '../settings'
import { h } from './dom'

const KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  w: [0, -1],
  s: [0, 1],
}

export interface GameScreen {
  readonly element: HTMLElement
  destroy(): void
}

/**
 * The game as every phone shows it: scores on top, the arena in the middle and, between
 * rounds, a sheet below with the players and what comes next. `sheet` fills that sheet; it is
 * built anew only when its content would change, not on every frame.
 */
export function gameScreen(
  session: Session,
  sheet: (state: Snapshot) => Node[],
  onLeave: () => void,
): GameScreen {
  const canvas = h('canvas', { class: 'arena' })
  const painter = new Painter(canvas)
  const timer = h('span', { class: 'timer' })
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
  const element = h(
    'div',
    { class: 'screen game' },
    h('div', { class: 'hud' }, leave, scores, timer),
    canvas,
    sheetBox,
  )

  // Steering: a touch or a pressed mouse button sets the target, the keys push it along.
  canvas.addEventListener('pointerdown', (event) => {
    // Capture keeps the drag on the canvas; a pointer the browser no longer tracks cannot be
    // captured, and steering still works without.
    try {
      canvas.setPointerCapture(event.pointerId)
    } catch {}
    session.setTarget(painter.toArena(event.clientX, event.clientY))
  })
  canvas.addEventListener('pointermove', (event) => {
    if (canvas.hasPointerCapture(event.pointerId)) {
      session.setTarget(painter.toArena(event.clientX, event.clientY))
    }
  })
  const pressed = new Set<string>()
  const onKey = (event: KeyboardEvent) => {
    if (!(event.key in KEYS) || event.target instanceof HTMLInputElement) return
    event.preventDefault()
    if (event.type === 'keydown') pressed.add(event.key)
    else pressed.delete(event.key)
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKey)

  const wakeLock = settings().keepScreenOn
    ? navigator.wakeLock?.request('screen').catch(() => null)
    : undefined
  let sheetKey = ''
  let scoresKey = ''
  // Unknown until the first snapshot, so a score kept from before rejoining does not buzz.
  let lastScore: number | null = null
  let frame = 0

  const render = () => {
    const state = session.snapshot()
    const me = state?.players.find((p) => p.id === session.selfId())
    if (me && pressed.size > 0) {
      let [dx, dy] = [0, 0]
      for (const key of pressed) {
        dx += KEYS[key]?.[0] ?? 0
        dy += KEYS[key]?.[1] ?? 0
      }
      session.setTarget({ x: me.x + dx * 120, y: me.y + dy * 120 })
    }
    painter.draw(state, session.selfId(), session.target())
    if (state) {
      if (me && lastScore !== null && me.score !== lastScore && settings().vibration) {
        // A short buzz for a spark, a longer one for gold, and a double one for a mine.
        const change = me.score - lastScore
        navigator.vibrate?.(change < 0 ? [70, 50, 70] : change > 1 ? 80 : 25)
      }
      lastScore = me?.score ?? null
      timer.textContent =
        state.phase === 'play' ? t('timeLeft', { s: Math.ceil(state.timeLeft) }) : ''
      const ranked = [...state.players].sort((a, b) => b.score - a.score)
      const nextScores = ranked.map((p) => `${p.id}:${p.score}`).join(' ')
      if (nextScores !== scoresKey) {
        scoresKey = nextScores
        scores.replaceChildren(
          ...ranked.map((p) => h('span', { class: 'chip' }, dot(p.id), `${p.name} ${p.score}`)),
        )
      }
      const nextSheet =
        state.phase === 'play'
          ? ''
          : `${state.phase}|${state.players.map((p) => `${p.id}:${p.name}:${p.score}:${pingBand(p)}`)}|${state.away?.map((p) => p.id)}`
      if (nextSheet !== sheetKey) {
        sheetKey = nextSheet
        sheetBox.hidden = state.phase === 'play'
        sheetBox.replaceChildren(...(state.phase === 'play' ? [] : sheet(state)))
      }
    }
    frame = requestAnimationFrame(render)
  }
  frame = requestAnimationFrame(render)

  return {
    element,
    destroy() {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      void wakeLock?.then((lock) => lock?.release())
    },
  }
}

/**
 * The players, best first, with their pings: what everyone sees between rounds. Players who
 * dropped out follow, marked away, as they may come back.
 */
export function roster(state: Snapshot, selfId: number | null): HTMLElement {
  const ranked = [...state.players].sort((a, b) => b.score - a.score || a.id - b.id)
  return h(
    'ul',
    { class: 'roster' },
    ...ranked.map((p) =>
      h(
        'li',
        {},
        dot(p.id),
        h('span', { class: 'name' }, p.name, p.id === selfId ? ` (${t('you')})` : ''),
        h(
          'span',
          { class: 'ping' },
          p.id === 0 ? t('host_') : p.ping === null ? '…' : t('pingMs', { ms: p.ping }),
        ),
        h('span', { class: 'score' }, String(p.score)),
      ),
    ),
    ...(state.away ?? []).map((p) =>
      h(
        'li',
        { class: 'away' },
        dot(p.id),
        h('span', { class: 'name' }, p.name),
        h('span', { class: 'ping' }, t('away')),
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

function dot(id: number): HTMLElement {
  const element = h('span', { class: 'dot' })
  element.style.background = playerColor(id)
  return element
}

/** Pings rounded to 5 ms, so the sheet is not rebuilt for every millisecond of jitter. */
function pingBand(player: Player): number {
  return player.ping === null ? -1 : Math.round(player.ping / 5)
}
