import { detailsLines, networkLines, testLines } from '@fionapreroll/p2p/debug'
import { ROOM_PROTOCOL } from '@fionapreroll/p2p/room'
import { currentLanguage } from './i18n'
import { describeError, logLines, redact } from './log'
import { latestNet } from './net/netlog'
import { PROTOCOL } from './net/protocol'
import { hostedGame, joinedGame } from './session/saved'
import { settings } from './settings'

/**
 * The debug report: what a developer needs to understand a problem, as Markdown to paste into a
 * GitHub issue. It says what device, versions and settings this is, what the phone can do, how
 * well the connections of the last game kept up, second by second, and what happened recently;
 * not who the player is: no name, token, code or address. The player reads it before sending it.
 */

/** Where the report reads from; the defaults are the real ones, tests give their own. */
export interface ReportSources {
  readonly now: Date
  readonly app: boolean
  readonly browser: {
    readonly userAgent: string
    readonly language: string
    readonly online: boolean
    readonly screen: string
    readonly features: Readonly<Record<string, boolean>>
  }
  /** The app's build, in the app. */
  readonly appInfo?: () => Promise<{ build: number; name: string }>
  /** Nearby's diagnostics, in the app (see `@fionapreroll/p2p-nearby`). */
  readonly bluetooth?: () => Promise<Record<string, unknown>>
}

export async function debugReport(sources: ReportSources): Promise<string> {
  const s = settings()
  const hosted = hostedGame()
  const joined = joinedGame()
  const lines: string[] = [
    '## Spark Hunt debug report',
    '',
    `- Created: ${sources.now.toISOString()}`,
    `- Running as: ${sources.app ? 'Android app' : 'website in a browser'}`,
    `- Version: ${__BUILD__.version}`,
    `- Web build: ${__BUILD__.commit}, built ${__BUILD__.time}`,
  ]
  if (sources.appInfo) {
    const info = await sources.appInfo().catch((error: unknown) => describeError(error))
    lines.push(
      `- App build: ${typeof info === 'string' ? `unknown (${info})` : `${info.build} (${info.name})`}`,
    )
  }
  lines.push(
    `- Protocols: game ${PROTOCOL}, room ${ROOM_PROTOCOL}`,
    `- Browser: ${sources.browser.userAgent}`,
    `- Language: ${sources.browser.language}, game in ${currentLanguage()}`,
    `- Screen: ${sources.browser.screen}`,
    `- Online: ${yes(sources.browser.online)}`,
    `- Can do: ${Object.entries(sources.browser.features)
      .map(([feature, ok]) => `${feature} ${yes(ok)}`)
      .join(', ')}`,
    `- Settings: language ${s.language}, vibration ${on(s.vibration)}, keep screen on ${on(s.keepScreenOn)}, round ${s.roundSeconds} s, camera remembered ${yes(s.camera.deviceId !== null)}, updates ${on(s.checkUpdates)} (asked ${yes(s.updatesAsked)}), joystick ${s.joystick}, connection graph ${on(s.netGraph)}, sound ${on(s.sound)}`,
    `- Saved: hosted game ${hosted ? `with ${hosted.players.length} other player(s)` : 'none'}, joined game ${yes(joined !== null)}`,
  )
  if (sources.bluetooth) {
    lines.push('', '### Bluetooth', '')
    try {
      lines.push(...bluetoothLines(await sources.bluetooth()))
    } catch (error) {
      lines.push(`- Could not read: ${describeError(error)}`)
    }
  }
  const net = latestNet()
  if (net) {
    lines.push('', '### Network, last game', '', ...networkLines(net.net))
    // What each connection's transport tells, while it lasts: kinds of address, never one.
    const peers = net.peers()
    if (peers.length > 0) {
      lines.push('', 'Connections now:', '')
      for (const peer of peers)
        lines.push(...detailsLines(peer, await net.details(peer).catch(() => null)))
    }
    lines.push('', 'Connection test:', '', ...testLines(net.lastTest()))
  }
  lines.push(
    '',
    '### Log',
    '',
    '```',
    ...(logLines().length > 0 ? logLines() : ['(empty)']),
    '```',
    '',
  )
  return lines.join('\n')
}

/** NearbyPlugin's diagnostics as lines, its log at the end. */
function bluetoothLines(d: Record<string, unknown>): string[] {
  const text = (value: unknown) => redact(String(value ?? 'unknown')).slice(0, 200)
  const permissions =
    typeof d.permissions === 'object' && d.permissions !== null
      ? Object.entries(d.permissions as Record<string, unknown>)
          .map(([name, state]) => `${text(name)} ${text(state)}`)
          .join(', ')
      : 'unknown'
  const log = Array.isArray(d.log) ? d.log.slice(-200).map(text) : []
  return [
    `- Phone: ${text(d.manufacturer)} ${text(d.model)}, Android ${text(d.android)} (SDK ${text(d.sdk)})`,
    `- Google Play services: ${text(d.playServices)}, version ${text(d.playServicesVersion)}`,
    `- Bluetooth: ${text(d.bluetooth)}, Location: ${text(d.location)}`,
    `- Permissions asked for: ${text(d.neededPermissions)}`,
    `- Permissions: ${permissions}`,
    `- Nearby: advertising ${text(d.advertising)}, discovering ${text(d.discovering)}, waiting ${text(d.waiting)}, connected ${text(d.connected)}`,
    `- Dropped by the plugin: ${text(d.droppedBusy)} fast messages while busy, ${text(d.droppedOverRate)} over the rate`,
    '',
    'Native log:',
    '',
    '```',
    ...(log.length > 0 ? log : ['(empty)']),
    '```',
  ]
}

function yes(value: boolean): string {
  return value ? 'yes' : 'no'
}

function on(value: boolean): string {
  return value ? 'on' : 'off'
}

/** Where the report reads from on this phone. */
export async function reportSources(): Promise<ReportSources> {
  const { isApp } = await import('./native')
  const app = isApp()
  const browser = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    online: navigator.onLine,
    screen: `${window.innerWidth}×${window.innerHeight} at ${window.devicePixelRatio}x`,
    features: {
      WebRTC: typeof RTCPeerConnection === 'function',
      camera: typeof navigator.mediaDevices?.getUserMedia === 'function',
      'QR detector': 'BarcodeDetector' in globalThis,
      'wake lock': 'wakeLock' in navigator,
      vibration: 'vibrate' in navigator,
      'service worker': Boolean(navigator.serviceWorker?.controller),
    },
  }
  if (!app) return { now: new Date(), app, browser }
  const [{ appBuild }, { bluetooth }] = await Promise.all([
    import('./updates'),
    import('./bluetooth'),
  ])
  return {
    now: new Date(),
    app,
    browser,
    appInfo: () => appBuild(),
    bluetooth: () => bluetooth().diagnostics(),
  }
}

/** A link that opens a new GitHub issue with the report, as far as a link can carry it. */
export function issueLink(report: string, placeholder: string): string {
  const base = 'https://github.com/FionaPreroll/vibe-p2pgame/issues/new'
  const title = encodeURIComponent('Debug report')
  const full = `${base}?title=${title}&body=${encodeURIComponent(report)}`
  // GitHub turns away links much longer than this: the report is then pasted by hand.
  return full.length <= 7500
    ? full
    : `${base}?title=${title}&body=${encodeURIComponent(placeholder)}`
}
