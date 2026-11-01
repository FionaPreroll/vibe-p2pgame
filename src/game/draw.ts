import {
  ARENA,
  BLAST_SECONDS,
  type Blast,
  MINE_ARM_SECONDS,
  MINE_PENALTY,
  MINE_RADIUS,
  type Mine,
  PLAYER_RADIUS,
  type Snapshot,
  SPARK_RADIUS,
  type Target,
} from './sim'

export const COLORS = [
  '#ff5470',
  '#4da3ff',
  '#6be06b',
  '#ffcf3f',
  '#c47dff',
  '#ff9a3c',
  '#2fe0d0',
  '#ff8fc8',
]

/** How long the points won rise above a dot. */
const POPUP_SECONDS = 0.9

export function playerColor(id: number): string {
  return COLORS[id % COLORS.length] ?? '#ffffff'
}

/**
 * Draws snapshots on a canvas. Snapshots arrive about 30 times a second; in between, every dot
 * glides toward its newest position, so the picture runs at the screen's own frame rate.
 */
export class Painter {
  private readonly context: CanvasRenderingContext2D
  private readonly shown = new Map<number, { x: number; y: number }>()
  /** Every player's score in the last snapshot, to show points won where they were won. */
  private readonly scores = new Map<number, number>()
  private popups: { x: number; y: number; text: string; color: string; age: number }[] = []
  private scale = 1
  private left = 0
  private top = 0
  private last = performance.now()

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No 2D canvas')
    this.context = context
  }

  /** Arena coordinates of a point on the screen, such as a touch. */
  toArena(clientX: number, clientY: number): { x: number; y: number } {
    // The box may have changed since the last frame, as when the sheet below hides at the
    // start of a round: a touch before the next frame must not use the old size.
    this.fit()
    const rect = this.canvas.getBoundingClientRect()
    const ratio = this.canvas.width / Math.max(1, rect.width)
    return {
      x: ((clientX - rect.left) * ratio - this.left) / this.scale,
      y: ((clientY - rect.top) * ratio - this.top) / this.scale,
    }
  }

  draw(snapshot: Snapshot | null, selfId: number | null, target: Target): void {
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    this.fit()
    const c = this.context
    const { width, height } = this.canvas
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.fillStyle = '#0b0d1a'
    c.fillRect(0, 0, width, height)
    c.setTransform(this.scale, 0, 0, this.scale, this.left, this.top)
    this.drawArena()
    if (snapshot === null) return

    const pulse = 0.5 + 0.5 * Math.sin(now / 180)
    for (const spark of snapshot.sparks) {
      const radius = SPARK_RADIUS * (spark.gold ? 1.3 : 1) * (0.85 + 0.15 * pulse)
      const glow = c.createRadialGradient(spark.x, spark.y, 0, spark.x, spark.y, radius * 2.5)
      glow.addColorStop(0, spark.gold ? '#fff6c0' : '#ffffff')
      glow.addColorStop(0.35, spark.gold ? '#ffc400' : '#9fdcff')
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      c.fillStyle = glow
      c.beginPath()
      c.arc(spark.x, spark.y, radius * 2.5, 0, Math.PI * 2)
      c.fill()
    }

    // Snapshots of older hosts have no mines; the version check keeps them out, this is a guard.
    for (const mine of snapshot.mines ?? []) this.drawMine(mine, now)

    if (target !== null) {
      c.strokeStyle = 'rgba(255,255,255,0.35)'
      c.lineWidth = 3
      c.beginPath()
      c.arc(target.x, target.y, 14, 0, Math.PI * 2)
      c.stroke()
    }

    const smoothing = 1 - Math.exp(-dt * 18)
    const present = new Set<number>()
    for (const player of snapshot.players) {
      present.add(player.id)
      const shown = this.shown.get(player.id) ?? { x: player.x, y: player.y }
      shown.x += (player.x - shown.x) * smoothing
      shown.y += (player.y - shown.y) * smoothing
      this.shown.set(player.id, shown)
      const color = playerColor(player.id)
      c.shadowColor = color
      c.shadowBlur = 25
      c.fillStyle = color
      c.beginPath()
      c.arc(shown.x, shown.y, PLAYER_RADIUS, 0, Math.PI * 2)
      c.fill()
      c.shadowBlur = 0
      if (player.id === selfId) {
        c.strokeStyle = '#ffffff'
        c.lineWidth = 5
        c.stroke()
      }
      c.fillStyle = '#ffffff'
      c.font = '600 26px system-ui, sans-serif'
      c.textAlign = 'center'
      c.fillText(player.name, shown.x, shown.y + PLAYER_RADIUS + 30)
    }
    for (const id of this.shown.keys()) if (!present.has(id)) this.shown.delete(id)
    for (const blast of snapshot.blasts ?? []) this.drawBlast(blast, snapshot.phase !== 'lobby')
    this.drawPopups(snapshot, dt)
  }

  /**
   * Points won rise from the dot that won them: "+1", or "+3" for gold. Points lost show at
   * the mine (see `drawBlast`). Only in a round: a new round's reset or a player who rejoins
   * with their score is no win.
   */
  private drawPopups(snapshot: Snapshot, dt: number): void {
    for (const player of snapshot.players) {
      const before = this.scores.get(player.id)
      this.scores.set(player.id, player.score)
      if (snapshot.phase !== 'play' || before === undefined || player.score <= before) continue
      const shown = this.shown.get(player.id) ?? player
      this.popups.push({
        x: shown.x,
        y: shown.y - PLAYER_RADIUS - 10,
        text: `+${player.score - before}`,
        color: playerColor(player.id),
        age: 0,
      })
    }
    const present = new Set(snapshot.players.map((p) => p.id))
    for (const id of this.scores.keys()) if (!present.has(id)) this.scores.delete(id)
    const c = this.context
    c.textAlign = 'center'
    for (const popup of this.popups) {
      popup.age += dt
      const progress = Math.min(1, popup.age / POPUP_SECONDS)
      c.globalAlpha = 1 - progress
      c.font = `800 ${44 + 12 * (1 - progress)}px system-ui, sans-serif`
      c.lineWidth = 6
      c.strokeStyle = 'rgba(11,13,26,0.8)'
      c.strokeText(popup.text, popup.x, popup.y - 70 * progress)
      c.fillStyle = popup.color
      c.fillText(popup.text, popup.x, popup.y - 70 * progress)
    }
    c.globalAlpha = 1
    this.popups = this.popups.filter((popup) => popup.age < POPUP_SECONDS)
  }

  /**
   * A mine: a dark red ball with spikes and a light. While it arms, it fades in and its light
   * stays grey, so players see it is not live yet.
   */
  private drawMine(mine: Mine, now: number): void {
    const c = this.context
    const arming = mine.armIn > 0
    c.globalAlpha = arming ? 0.3 + 0.5 * (1 - mine.armIn / MINE_ARM_SECONDS) : 1
    c.strokeStyle = '#ff3b30'
    c.lineWidth = 5
    c.beginPath()
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      c.moveTo(
        mine.x + Math.cos(angle) * MINE_RADIUS * 0.6,
        mine.y + Math.sin(angle) * MINE_RADIUS * 0.6,
      )
      c.lineTo(
        mine.x + Math.cos(angle) * MINE_RADIUS * 1.35,
        mine.y + Math.sin(angle) * MINE_RADIUS * 1.35,
      )
    }
    c.stroke()
    c.fillStyle = '#5c0f14'
    c.shadowColor = '#ff3b30'
    c.shadowBlur = arming ? 0 : 20
    c.beginPath()
    c.arc(mine.x, mine.y, MINE_RADIUS, 0, Math.PI * 2)
    c.fill()
    c.shadowBlur = 0
    c.strokeStyle = '#ff3b30'
    c.lineWidth = 3
    c.stroke()
    const blink = Math.sin(now / 120) > 0
    c.fillStyle = arming ? '#8a8a8a' : blink ? '#ff6b5e' : '#a3171f'
    c.beginPath()
    c.arc(mine.x, mine.y, MINE_RADIUS * 0.35, 0, Math.PI * 2)
    c.fill()
    c.globalAlpha = 1
  }

  /**
   * A mine going off: a ring that spreads and fades, and the points lost rising above it,
   * if they `count`: in free play they do not.
   */
  private drawBlast(blast: Blast, count: boolean): void {
    const c = this.context
    const progress = Math.min(1, blast.age / BLAST_SECONDS)
    c.globalAlpha = 1 - progress
    c.strokeStyle = '#ff8a3c'
    c.lineWidth = 10 * (1 - progress) + 2
    c.beginPath()
    c.arc(blast.x, blast.y, MINE_RADIUS + 80 * progress, 0, Math.PI * 2)
    c.stroke()
    if (count) {
      c.fillStyle = playerColor(blast.playerId)
      c.font = '700 40px system-ui, sans-serif'
      c.textAlign = 'center'
      c.fillText(`−${MINE_PENALTY}`, blast.x, blast.y - MINE_RADIUS - 20 - 50 * progress)
    }
    c.globalAlpha = 1
  }

  private drawArena(): void {
    const c = this.context
    c.fillStyle = '#12152b'
    c.fillRect(0, 0, ARENA, ARENA)
    c.strokeStyle = 'rgba(255,255,255,0.05)'
    c.lineWidth = 2
    c.beginPath()
    for (let i = 100; i < ARENA; i += 100) {
      c.moveTo(i, 0)
      c.lineTo(i, ARENA)
      c.moveTo(0, i)
      c.lineTo(ARENA, i)
    }
    c.stroke()
    c.strokeStyle = 'rgba(255,255,255,0.25)'
    c.lineWidth = 4
    c.strokeRect(0, 0, ARENA, ARENA)
  }

  /** Sizes the canvas to its box in device pixels and fits the square arena into it. */
  private fit(): void {
    const ratio = window.devicePixelRatio || 1
    const width = Math.round(this.canvas.clientWidth * ratio)
    const height = Math.round(this.canvas.clientHeight * ratio)
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    const margin = 8 * ratio
    this.scale = Math.max(0.01, Math.min(width - 2 * margin, height - 2 * margin) / ARENA)
    this.left = (width - ARENA * this.scale) / 2
    this.top = (height - ARENA * this.scale) / 2
  }
}
