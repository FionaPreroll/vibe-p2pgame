import type { NetLog, NetSample } from './netlog.ts'

/** How the graph looks: `drawNetGraph` takes any of these. */
export interface NetGraphOptions {
  /** Adds the scale, for a large graph: the top in ms, 0, and the time from the left to now. */
  readonly axes?: boolean
  /** The line of each connection, by the other phone's player id. Default a warm yellow. */
  readonly color?: (peer: number) => string
  /** The mark of a second with a stall or lost pings. */
  readonly stallColor?: string
  /** The text at the right end of the time axis. Default `0 s`, as the game brings its words. */
  readonly nowLabel?: string
}

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
    if (worst === null || sample.stalled || (sample.ping ?? 0) > (worst.ping ?? 0)) worst = sample
  }
  return worst
}

/**
 * Draws the ping of every connection over the last `seconds` up to `now` (as
 * `performance.now()`), one line per connection, with faint lines at 60 and 150 ms, and a mark
 * below for every second with a stall or lost pings.
 */
export function drawNetGraph(
  canvas: HTMLCanvasElement,
  log: NetLog,
  now: number,
  seconds: number,
  options: NetGraphOptions = {},
): void {
  const {
    axes = false,
    color = () => '#ffc400',
    stallColor = '#ff5470',
    nowLabel = '0 s',
  } = options
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
    c.fillText(nowLabel, width, height)
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
    c.strokeStyle = color(peer)
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

  c.fillStyle = stallColor
  const barWidth = Math.max(ratio, (width - left) / seconds - ratio)
  for (const sample of recent) {
    if (sample.stalled || (sample.loss ?? 0) > 0) {
      c.fillRect(x(sample.t) - barWidth, plotHeight + ratio, barWidth, markHeight)
    }
  }
}
