import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ app: false }))
const scanner = vi.hoisted(() => ({
  isGoogleBarcodeScannerModuleAvailable: vi.fn(),
  installGoogleBarcodeScannerModule: vi.fn(),
  scan: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.app },
}))
const app = vi.hoisted(() => ({ addListener: vi.fn(), exitApp: vi.fn() }))
vi.mock('@capacitor/app', () => ({ App: app }))
vi.mock('@capacitor-mlkit/barcode-scanning', () => ({
  BarcodeScanner: scanner,
  BarcodeFormat: { QrCode: 'QR_CODE' },
}))

const { exitApp, isApp, nativeScan, nativeScannerReady, onBackButton } = await import('./native')

beforeEach(() => {
  native.app = true
  vi.clearAllMocks()
  scanner.installGoogleBarcodeScannerModule.mockResolvedValue(undefined)
})

describe('the native scanner', () => {
  it('is never offered in a browser', async () => {
    native.app = false
    expect(isApp()).toBe(false)
    expect(await nativeScannerReady()).toBe(false)
    expect(scanner.isGoogleBarcodeScannerModuleAvailable).not.toHaveBeenCalled()
  })

  it('is offered in the app once Google’s module is there', async () => {
    scanner.isGoogleBarcodeScannerModuleAvailable.mockResolvedValue({ available: true })
    expect(await nativeScannerReady()).toBe(true)
    expect(scanner.installGoogleBarcodeScannerModule).not.toHaveBeenCalled()
  })

  it('starts fetching the module when it is missing, and is not offered meanwhile', async () => {
    scanner.isGoogleBarcodeScannerModuleAvailable.mockResolvedValue({ available: false })
    scanner.installGoogleBarcodeScannerModule.mockRejectedValue(new Error('offline'))
    expect(await nativeScannerReady()).toBe(false)
    expect(scanner.installGoogleBarcodeScannerModule).toHaveBeenCalledOnce()
  })

  it('is not offered when Google Play services are missing', async () => {
    scanner.isGoogleBarcodeScannerModuleAvailable.mockRejectedValue(new Error('no play services'))
    expect(await nativeScannerReady()).toBe(false)
  })

  it('gives the texts of the codes it read, for QR codes only', async () => {
    scanner.scan.mockResolvedValue({ barcodes: [{ rawValue: 'P1~o~x' }, { rawValue: '' }] })
    expect(await nativeScan()).toEqual(['P1~o~x'])
    expect(scanner.scan).toHaveBeenCalledWith({ formats: ['QR_CODE'], autoZoom: true })
  })

  it('gives null when the player goes back or the scanner fails', async () => {
    scanner.scan.mockRejectedValue(new Error('scan canceled'))
    expect(await nativeScan()).toBeNull()
  })
})

describe('the back button', () => {
  it('is left to the browser in a browser', async () => {
    native.app = false
    onBackButton(() => {})
    exitApp()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(app.addListener).not.toHaveBeenCalled()
    expect(app.exitApp).not.toHaveBeenCalled()
  })

  it('is taken over in the app, so it no longer closes it on every screen', async () => {
    const callback = vi.fn()
    onBackButton(callback)
    await vi.waitFor(() => expect(app.addListener).toHaveBeenCalledWith('backButton', callback))
    exitApp()
    await vi.waitFor(() => expect(app.exitApp).toHaveBeenCalledOnce())
  })
})
