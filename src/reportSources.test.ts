// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ app: false }))
vi.mock('./native', () => ({ isApp: () => native.app }))
vi.mock('./updates', () => ({
  appBuild: async () => ({ build: 42, name: '42-abc1234' }),
}))
vi.mock('./bluetooth', () => ({
  bluetooth: () => ({ diagnostics: async () => ({ sdk: 34, log: ['+0s start host'] }) }),
}))

const { reportSources } = await import('./report')

/** Where the debug report reads from: the browser everywhere, the app's native side in the app. */
describe('reportSources', () => {
  it('reads the browser, and nothing native in a browser', async () => {
    native.app = false
    const sources = await reportSources()
    expect(sources.app).toBe(false)
    expect(sources.browser.userAgent).toBe(navigator.userAgent)
    expect(sources.browser.screen).toMatch(/^\d+×\d+ at [\d.]+x$/)
    expect(Object.keys(sources.browser.features)).toEqual([
      'WebRTC',
      'camera',
      'QR detector',
      'wake lock',
      'vibration',
      'service worker',
    ])
    expect(sources.appInfo).toBeUndefined()
    expect(sources.bluetooth).toBeUndefined()
  })

  it('asks the app for its build and Bluetooth for its state, in the app', async () => {
    native.app = true
    const sources = await reportSources()
    expect(sources.app).toBe(true)
    expect(await sources.appInfo?.()).toEqual({ build: 42, name: '42-abc1234' })
    expect(await sources.bluetooth?.()).toEqual({ sdk: 34, log: ['+0s start host'] })
  })
})
