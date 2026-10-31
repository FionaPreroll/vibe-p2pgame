import { ARENA, PLAYER_RADIUS, type Snapshot, SPARK_RADIUS, type Target } from './sim'

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
