import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLog, log } from './log'
import { startNetLog } from './net/netlog'
import { debugReport, issueLink, type ReportSources } from './report'
import { forgetSettings, updateSettings } from './settings'

/** The browser's local storage, in memory, so settings and saved games are there to report. */
function memoryStorage() {
  const items = new Map<string, string>()
  return new Proxy(
    {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, String(v)),
      removeItem: (k: string) => void items.delete(k),
    },
    {
      ownKeys: () => [...items.keys()],
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    },
  )
}

const browser: ReportSources['browser'] = {
  userAgent: 'Mozilla/5.0 (Linux; Android 14) TestBrowser',
  language: 'de-DE',
  online: false,
  screen: '390×844 at 3x',
  features: { WebRTC: true, camera: true, 'QR detector': false },
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  forgetSettings()
  clearLog()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the debug report', () => {
  it('says where the game runs, which build, what the phone can do, and the settings', async () => {
    updateSettings({
      name: 'Ada Secretname',
      roundSeconds: 90,
      checkUpdates: true,
      updatesAsked: true,
    })
    log('bluetooth', 'could not start as player: radio (nearby-8007: 8007 STATUS_RADIO_ERROR)')
    const report = await debugReport({ now: new Date('2026-10-31T12:00:00Z'), app: false, browser })
    expect(report).toContain('## Spark Hunt debug report')
    expect(report).toContain('- Created: 2026-10-31T12:00:00.000Z')
    expect(report).toContain('- Running as: website in a browser')
    expect(report).toMatch(/- Version: \d+\.\d+\.\d+\n- Web build: \S+, built /)
    expect(report).toContain('- Protocols: game 4, room 2')
    expect(report).toContain('TestBrowser')
    expect(report).toContain('- Online: no')
    expect(report).toContain('WebRTC yes, camera yes, QR detector no')
    expect(report).toContain('round 90 s')
    expect(report).toContain('updates on (asked yes)')
    expect(report).toContain('nearby-8007: 8007 STATUS_RADIO_ERROR')
    expect(report).not.toContain('### Bluetooth')
    // The player's name is no business of a report.
    expect(report).not.toContain('Secretname')
  })

  it('carries the network of the last game, summed up and second by second, before the log', async () => {
    const net = startNetLog(2, 0)
    const traffic = (n: number) => ({
      sent: n,
      sentChars: n * 40,
      received: n,
      receivedChars: n * 400,
      pings: n / 30,
      pongs: n / 30,
    })
    net.sample(0, 0, { ping: null, traffic: traffic(0) })
    net.sample(0, 1000, { ping: 23, traffic: traffic(30) })
    const report = await debugReport({ now: new Date(), app: false, browser })
    expect(report).toContain('### Network, last game')
    expect(report).toContain('median 23 ms')
    expect(report).toContain('t_s,peer,ping_ms')
    expect(report).toContain('\n1,0,23,')
    expect(report.indexOf('### Network')).toBeLessThan(report.indexOf('### Log'))
  })

  it('adds the app build and Bluetooth in the app, with the native log', async () => {
    const report = await debugReport({
      now: new Date(),
      app: true,
      browser,
      appInfo: async () => ({ build: 9, name: '9-abc' }),
      bluetooth: async () => ({
        manufacturer: 'Fairphone',
        model: 'FP5',
        android: '14',
        sdk: 34,
        playServices: '0 SUCCESS',
        playServicesVersion: '24.40.33',
        bluetooth: 'on',
        location: 'off',
        neededPermissions: 'bluetooth, wifi',
        permissions: { BLUETOOTH_SCAN: 'granted', NEARBY_WIFI_DEVICES: 'denied' },
        advertising: false,
        discovering: false,
        waiting: 0,
        connected: 0,
        log: [
          '+3s start player (Android 34)',
          '+3s could not discover: 8034 MISSING_PERMISSION from 192.168.1.20',
        ],
      }),
    })
    expect(report).toContain('- Running as: Android app')
    expect(report).toContain('- App build: 9 (9-abc)')
    expect(report).toContain('- Phone: Fairphone FP5, Android 14 (SDK 34)')
    expect(report).toContain('- Bluetooth: on, Location: off')
    expect(report).toContain('BLUETOOTH_SCAN granted, NEARBY_WIFI_DEVICES denied')
    expect(report).toContain('+3s could not discover: 8034 MISSING_PERMISSION from <ip>')
  })

  it('still comes out when the app cannot say something', async () => {
    const report = await debugReport({
      now: new Date(),
      app: true,
      browser,
      appInfo: async () => {
        throw new Error('no plugin')
      },
      bluetooth: async () => {
        throw Object.assign(new Error('not implemented'), { code: 'UNIMPLEMENTED' })
      },
    })
    expect(report).toContain('- App build: unknown (no plugin)')
    expect(report).toContain('- Could not read: UNIMPLEMENTED: not implemented')
    expect(report).toContain('(empty)')
  })

  it('holds no token, code or address, even when the log or the saved games do', async () => {
    localStorage.setItem('vibe-p2pgame:token', '"0123456789abcdef01234567"')
    localStorage.setItem(
      'vibe-p2pgame:hosted',
      JSON.stringify({
        savedAt: Date.now(),
        hostScore: 1,
        nextId: 2,
        players: [{ token: 'token-secret-1', id: 1, name: 'Bo Secretname', score: 3 }],
      }),
    )
    log(
      'qr',
      'could not join: answer P1~a~a~Xk3Y~pwd~fp~10.0.0.7,5000 from 0123456789abcdef01234567',
    )
    const report = await debugReport({ now: new Date(), app: false, browser })
    expect(report).toContain('hosted game with 1 other player(s)')
    for (const secret of [
      '0123456789abcdef01234567',
      'token-secret-1',
      'Secretname',
      'P1~',
      '10.0.0.7',
    ]) {
      expect(report).not.toContain(secret)
    }
  })
})

describe('issueLink', () => {
  it('carries a short report, and asks for a long one to be pasted', () => {
    const short = issueLink('## Report\n- a', 'Paste it here')
    expect(short).toBe(
      'https://github.com/FionaPreroll/vibe-p2pgame/issues/new?title=Debug%20report&body=%23%23%20Report%0A-%20a',
    )
    const long = issueLink('x'.repeat(10_000), 'Paste it here')
    expect(long).toBe(
      'https://github.com/FionaPreroll/vibe-p2pgame/issues/new?title=Debug%20report&body=Paste%20it%20here',
    )
  })
})
