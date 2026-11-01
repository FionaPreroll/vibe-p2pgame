import { playerColor } from '../game/draw'
import { type NetLog, type NetSample, STALL_MS } from '../net/netlog'

/** How a ping reads: under 60 ms players feel nothing, over 150 ms they do. */
export function pingQuality(
  ping: number | null,
  stalled = false,
): 'good' | 'fair' | 'poor' | 'none' {
  if (stalled) return 'poor'
  if (ping === null) return 'none'
  return ping < 60 ? 'good' : ping < 150 ? 'fair' : 'poor'
}

/**
 * The newest sample of every connection that still has one: what the small graph shows next
 * to the scores. The host sees the worst of its players, a player the host.
 */
export function worstLatest(log: NetLog, now: number): NetSample | null {
  const latest = new Map<number, NetSample>()
  for (const sample of log.samples) latest.set(sample.peer, sample)
  const t = (now - log.startedAt) / 1000
  let worst: NetSample | null = null
  for (const sample of latest.values()) {
    // Connections without a sample in the last few seconds have ended.
    if (t - sample.t > 3) continue
    if (worst === null || sample.gap >= STALL_MS || (sample.ping ?? 0) > (worst.ping ?? 0))
      worst = sample
  }
  return worst
}

/**
 * Draws the ping of every connection over the last `seconds`, one line per connection in the
 * player's colour, and a red mark below for every second with a stall or lost pings. `axes`
 * adds the scale, for the large graph.
 */
export function drawNetGraph(
  canvas: HTMLCanvasElement,
  log: NetLog,
  now: number,
  seconds: number,
  axes = false,
): void {
  const ratio = globalThis.devicePixelRatio || 1
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio))
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const c = canvas.getContext('2d')
  if (!c) return
  c.clearRect(0, 0, width, height)
  const end = (now - log.startedAt) / 1000
  const start = end - seconds
  const recent = log.samples.filter((s) => s.t >= start)
  const top = Math.max(100, ...recent.map((s) => s.ping ?? 0))
  const scaleTop = Math.ceil(top / 50) * 50
  const left = axes ? 48 * ratio : 0
  const markHeight = 3 * ratio
  const plotHeight = height - markHeight - (axes ? 14 * ratio : 1 * ratio)
  const x = (t: number) => left + ((t - start) / seconds) * (width - left)
  const y = (ping: number) => plotHeight - (ping / scaleTop) * (plotHeight - ratio) + ratio / 2

  c.fillStyle = 'rgba(255,255,255,0.06)'
  c.fillRect(left, 0, width - left, plotHeight)
  if (axes) {
    c.fillStyle = 'rgba(255,255,255,0.6)'
    c.font = `${11 * ratio}px system-ui, sans-serif`
    c.textAlign = 'right'
    c.textBaseline = 'top'
    c.fillText(`${scaleTop} ms`, left - 4 * ratio, 0)
    c.textBaseline = 'bottom'
    c.fillText('0', left - 4 * ratio, plotHeight)
    c.textAlign = 'left'
    c.textBaseline = 'bottom'
    c.fillText(`−${seconds} s`, left, height)
    c.textAlign = 'right'
    c.fillText('now', width, height)
  }
  // 60 ms and 150 ms: where players start to feel it, and where it hurts.
  c.strokeStyle = 'rgba(255,255,255,0.12)'
  c.lineWidth = ratio
  c.beginPath()
  for (const line of [60, 150]) {
    if (line >= scaleTop) continue
    c.moveTo(left, y(line))
    c.lineTo(width, y(line))
  }
  c.stroke()

  for (const peer of new Set(recent.map((s) => s.peer))) {
    c.strokeStyle = log.self === 0 ? playerColor(peer) : '#ffc400'
    c.lineWidth = 1.5 * ratio
    c.beginPath()
    let drawing = false
    let previous: number | null = null
    for (const sample of recent) {
      if (sample.peer !== peer) continue
      // A break in the samples, as when a player was away, is a break in the line.
      if (sample.ping === null || (previous !== null && sample.t - previous > 2.5)) drawing = false
      previous = sample.t
      if (sample.ping === null) continue
      if (drawing) c.lineTo(x(sample.t), y(sample.ping))
      else c.moveTo(x(sample.t), y(sample.ping))
      drawing = true
    }
    c.stroke()
  }

  c.fillStyle = '#ff5470'
  const barWidth = Math.max(ratio, (width - left) / seconds - ratio)
  for (const sample of recent) {
    if (sample.gap >= STALL_MS || (sample.loss ?? 0) > 0) {
      c.fillRect(x(sample.t) - barWidth, plotHeight + ratio, barWidth, markHeight)
    }
  }
}
